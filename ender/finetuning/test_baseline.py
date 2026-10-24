import contextlib
import csv
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import baseline


class BaselineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def csv(self, source, rows):
        path = self.root / baseline.SOURCES[source][0]
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)

    def test_advbench_never_uses_attack_target(self):
        self.csv("advbench", [{"goal": "User prompt", "target": "ATTACK ANSWER PREFIX"}])
        rows, metadata = baseline.load_source(self.root, "advbench")
        self.assertEqual(rows[0]["prompt"], "User prompt")
        self.assertNotIn("ATTACK ANSWER PREFIX", json.dumps(rows))
        self.assertEqual(metadata["eligible_rows"], 1)
        self.assertEqual(rows[0]["expected_behavior"], "refuse")

    def test_harmbench_context_and_unsupported_rows(self):
        self.csv("harmbench", [
            {"Behavior": "Question", "ContextString": "Context", "FunctionalCategory": "contextual"},
            {"Behavior": "Hash task", "ContextString": "", "FunctionalCategory": "copyright"}])
        rows, metadata = baseline.load_source(self.root, "harmbench")
        self.assertEqual(rows[0]["prompt"], "Context\n\nQuestion")
        self.assertEqual(metadata["raw_rows"], 2)
        self.assertEqual(metadata["eligible_rows"], 1)

    def test_xstest_labels_and_stratified_sampling(self):
        self.csv("xstest", [{"id": str(i), "prompt": f"Prompt {i}", "type": "test",
                             "label": "safe" if i < 10 else "unsafe"} for i in range(20)])
        rows, _ = baseline.load_source(self.root, "xstest")
        selected = baseline.select_examples(rows, 4, 42)
        self.assertEqual([row["expected_behavior"] for row in selected].count("answer"), 2)
        self.assertEqual(selected, baseline.select_examples(rows, 4, 42))
        self.assertEqual(baseline.select_examples(rows, 0, 42), rows)
        with self.assertRaisesRegex(ValueError, "stratum"):
            baseline.select_examples(rows, 1, 42)

    def test_sorry_uses_prompt_not_answer(self):
        path = self.root / baseline.SOURCES["sorry-bench"][0]
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({"turns": ["Prompt"], "category": "1"}) + "\n")
        rows, _ = baseline.load_source(self.root, "sorry-bench")
        self.assertEqual(rows[0]["prompt"], "Prompt")

    def test_refusal_heuristic_ignores_reasoning(self):
        self.assertIsNotNone(baseline.refusal_match("I cannot help with that request."))
        self.assertIsNotNone(baseline.refusal_match("I’m unable to assist with that."))
        self.assertIsNone(baseline.refusal_match("I can help you compare bank fees."))
        self.assertIsNone(baseline.refusal_match("<think>I cannot help</think>Here is a useful answer."))

    def test_summary_does_not_count_errors_as_refusals(self):
        results = [
            {"dataset": "test", "status": "ok", "expected_behavior": "answer", "refusal_heuristic": True,
             "generation_seconds": 2, "output_tokens": 4, "length_limited": True},
            {"dataset": "test", "status": "error", "expected_behavior": "refuse"}]
        summary = baseline.summarize(results)["datasets"]["test"]
        self.assertEqual(summary["errors"], 1)
        self.assertEqual(summary["benign_overrefusal_proxy"], {"n": 1, "rate": 1.0})
        self.assertEqual(summary["harmful_refusal_proxy"], {"n": 0, "rate": None})

    def test_dry_run_logs_prompts_without_model(self):
        self.csv("advbench", [{"goal": f"Prompt {i}", "target": "Do not use"} for i in range(3)])
        output = self.root / "results"
        args = ["--data-root", str(self.root), "--datasets", "advbench", "--dry-run",
                "--limit-per-dataset", "2", "--output-dir", str(output)]
        with patch.object(baseline, "run_inference") as run, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(baseline.main(args), 0)
            run.assert_not_called()
        manifest = json.loads((output / "manifest.json").read_text())
        self.assertEqual(manifest["status"], "dry_run")
        self.assertEqual(manifest["selected_examples"], 2)
        self.assertFalse((output / "responses.jsonl").exists())
        with self.assertRaises(FileExistsError):
            baseline.main(args)

    def test_failures_update_manifest(self):
        self.csv("advbench", [{"goal": "Prompt", "target": "Do not use"}])
        output = self.root / "results"
        with patch.object(baseline, "run_inference", side_effect=ValueError("No GPU")), \
                contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(ValueError, "No GPU"):
            baseline.main(["--data-root", str(self.root), "--datasets", "advbench",
                           "--output-dir", str(output)])
        manifest = json.loads((output / "manifest.json").read_text())
        self.assertEqual(manifest["status"], "failed")
        self.assertIn("finished_at", manifest)


if __name__ == "__main__":
    unittest.main()
