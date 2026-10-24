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
        with patch.object(baseline, "check_dependencies"), \
                patch.object(baseline, "run_inference", side_effect=ValueError("No GPU")), \
                contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(ValueError, "No GPU"):
            baseline.main(["--data-root", str(self.root), "--datasets", "advbench",
                           "--output-dir", str(output)])
        manifest = json.loads((output / "manifest.json").read_text())
        self.assertEqual(manifest["status"], "failed")
        self.assertIn("finished_at", manifest)

    def test_dependency_check_reports_all_missing_in_current_interpreter(self):
        with patch.object(baseline.importlib.util, "find_spec", return_value=None):
            with self.assertRaises(ValueError) as caught:
                baseline.check_dependencies(["strongreject"])
        for text in (baseline.sys.executable, "pyarrow"):
            self.assertIn(text, str(caught.exception))

    def memory(self, rss=0, gpu=None):
        return {"server_rss_bytes": rss, "gpu_process_bytes": gpu, "system_available_bytes": 4 * 2**30}

    def test_dry_run_does_not_require_inference_dependencies(self):
        with patch.object(baseline.importlib.util, "find_spec", return_value=None) as lookup:
            baseline.check_dependencies(["advbench"], dry_run=True)
            lookup.assert_not_called()

    def test_dependency_failure_does_not_create_result_directory(self):
        output = self.root / "results"
        with patch.object(baseline, "check_dependencies", side_effect=ValueError("Incomplete environment")):
            with self.assertRaisesRegex(ValueError, "Incomplete environment"):
                baseline.main(["--output-dir", str(output)])
        self.assertFalse(output.exists())

    def test_live_progress_saves_tokens_and_memory(self):
        output = self.root / "live"
        output.mkdir()
        text, status = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(text), contextlib.redirect_stderr(status):
            with baseline.LiveProgress(output, {"id": "test:0"}, 1, 2, 12,
                                       lambda: self.memory(2**30, 2 * 2**30), interval=3600) as progress:
                progress.add_tokens(3)
                progress.text("Hello world", stream_end=True)
                snapshot = progress.emit()
                self.assertEqual(snapshot["output_tokens_so_far"], 3)
                self.assertEqual(snapshot["input_tokens"], 12)
                self.assertIsNotNone(snapshot["first_token_seconds"])
        saved = json.loads((output / "progress.json").read_text())
        self.assertEqual(saved["status"], "generation_finished")
        self.assertEqual(saved["server_rss_bytes"], 2**30)
        self.assertIn("Hello world", text.getvalue())
        self.assertIn("3 tokens", status.getvalue())
        self.assertIn("server RSS 1.00 GiB", status.getvalue())
        self.assertFalse(progress.thread.is_alive())

    def test_live_progress_stops_on_failure(self):
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaisesRegex(ValueError, "generation failed"):
                with baseline.LiveProgress(self.root, {"id": "test:0"}, 1, 1, 12,
                                           self.memory, interval=3600) as progress:
                    raise ValueError("generation failed")
        self.assertFalse(progress.thread.is_alive())
        saved = json.loads((self.root / "progress.json").read_text())
        self.assertEqual(saved["status"], "generation_interrupted")

    def test_progress_can_hide_text_without_hiding_counts(self):
        text = io.StringIO()
        with contextlib.redirect_stdout(text), contextlib.redirect_stderr(io.StringIO()):
            with baseline.LiveProgress(self.root, {"id": "test:0"}, 1, 1, 100,
                                       self.memory, interval=3600, stream=False) as progress:
                progress.add_tokens(1)
                progress.add_tokens(1)
                progress.text("Hidden response", stream_end=True)
        self.assertEqual(progress.tokens, 2)
        self.assertEqual(text.getvalue(), "")

    def test_terminal_result_includes_running_metrics(self):
        row = {"id": "test:0", "dataset": "test", "status": "ok", "expected_behavior": "answer",
               "refusal_heuristic": True, "input_tokens": 10, "output_tokens": 4,
               "generation_seconds": 2, "output_tokens_per_second": 2,
               "sampled_peak_server_rss_bytes": 2**30, "sampled_peak_gpu_process_bytes": 2 * 2**30,
               "length_limited": False}
        text = io.StringIO()
        with contextlib.redirect_stdout(text):
            baseline.show_result(row, [row], 3, 2)
        for expected in ("refusal proxy=YES", "latency=2.00s", "2.00 tok/s", "1.00 GiB",
                         "[running 1/3]", "ETA~4.0s", "100.0% (n=1)"):
            self.assertIn(expected, text.getvalue())


if __name__ == "__main__":
    unittest.main()
