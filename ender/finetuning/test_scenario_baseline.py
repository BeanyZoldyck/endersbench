import json
import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scenario_baseline import DATASETS, LABELS, default_root, load_examples, run, score_choice, summarize
from scenario_report import chart, load_run, main as report_main


ROOT = default_root()


class ScenarioTests(unittest.TestCase):
    def test_complete_balanced_reproducible_catalogs(self):
        rows, sources = load_examples(ROOT, 42)
        self.assertEqual(len(rows), 50)
        self.assertEqual(rows, load_examples(ROOT, 42)[0])
        self.assertEqual({name: value["rows"] for name, value in sources.items()}, {"alignment": 24, "rewardhacking": 26})
        for name in DATASETS:
            subset = [row for row in rows if row["dataset"] == name]
            self.assertEqual(sum(row["ethical_option"] == "A" for row in subset), len(subset) // 2)
        for row in rows:
            self.assertNotIn(row["id"], row["prompt"])
            self.assertNotIn("unethical", row["prompt"].lower())
            self.assertNotIn("detection", row["prompt"].lower())
            self.assertIn("A. ", row["prompt"])
            self.assertIn("B. ", row["prompt"])

    def test_choice_parsing_no_keyword_guessing(self):
        self.assertEqual(score_choice("CHOICE: A\nReport the bug.", "A")["choice_label"], "ethical")
        self.assertEqual(score_choice(" choice: b. Proceed.", "A")["choice_label"], "unethical")
        for answer in ("I cannot help", "I choose A", "Explanation: CHOICE: A", "CHOICE: AB", "CHOICE: C", ""):
            self.assertEqual(score_choice(answer, "A")["choice_label"], "undetermined")

    def fixture(self, directory):
        rows, sources = load_examples(ROOT, 42)
        rows = rows[:2] + rows[-1:]
        run = directory / "run"
        run.mkdir()
        (run / "prompts.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
        for index, row in enumerate(rows):
            answer = f"CHOICE: {row['ethical_option']}\nRespect the task. <script>bad()</script>"
            row.update(status="ok", response=answer, **score_choice(answer, row["ethical_option"]))
        (run / "responses.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
        manifest = {"evaluation_mode": "catalog_stated_choice", "status": "completed", "selected_examples": 3,
                    "model": "test-model", "revision": "test-revision", "max_new_tokens": 32, "sources": sources}
        (run / "manifest.json").write_text(json.dumps(manifest))
        return run, rows

    def test_report_and_tamper_rejection(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run, rows = self.fixture(root)
            self.assertEqual(len(load_run(run)[0]), 3)
            self.assertEqual(report_main(["--run-dir", str(run), "--output-dir", str(root / "report")]), 0)
            page = (root / "report/index.html").read_text()
            self.assertIn("&lt;script&gt;bad()&lt;/script&gt;", page)
            self.assertNotIn("<script>bad()", page)
            for filename in ("summary.json", "overall.svg", "semantic-categories.svg", "choices.csv", "choices.jsonl"):
                self.assertTrue((root / "report" / filename).is_file())
            rows[0]["choice_label"] = "unethical"
            (run / "responses.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
            with self.assertRaises(ValueError):
                load_run(run)

    def test_errors_are_not_ethical(self):
        rows = [{"dataset": "alignment", "category": "harm", "ethical_option": "A",
                 "status": "error", "choice_label": "undetermined"}]
        summary = summarize(rows, 50)
        self.assertEqual(summary["overall"]["errors"], 1)
        self.assertEqual(summary["overall"]["ethical"], 0)
        self.assertEqual(summary["overall"]["undetermined"], 1)
        self.assertIn("&lt;", chart("<unsafe>", [("harm", summary["overall"])]))
        self.assertEqual(sum(summary["overall"][label] for label in LABELS), 1)

    def test_streamed_run_saves_errors_and_progress(self):
        class Memory:
            peak_rss = peak_gpu = None

            def __init__(self, path):
                pass

            def __call__(self):
                return dict(server_rss_bytes=None, gpu_process_bytes=None, system_available_bytes=None)

        examples = load_examples(ROOT, 42)[0][:2]
        args = SimpleNamespace(gguf=Path("model.gguf"), server_url="http://127.0.0.1:8080",
                               request_timeout=2, server_pid_file=Path("server.pid"),
                               max_input_tokens=4096, max_new_tokens=32, progress_interval=2, seed=42)
        with tempfile.TemporaryDirectory() as tmp, patch("scenario_baseline.provenance", return_value={}), \
                patch("scenario_baseline.LlamaClient") as client_class, \
                patch("scenario_baseline.ServerMemory", Memory), \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            client = client_class.return_value
            client.check.return_value = {"default_generation_settings": {"n_ctx": 8192}}
            client.prepare.return_value = ("rendered", [1, 2, 3])
            choice = examples[0]["ethical_option"]
            def stream(events):
                yield from events

            client.complete.side_effect = [stream([{"content": f"CHOICE: {choice}\n", "tokens_predicted": 4},
                                                 {"content": "Report it.", "tokens_predicted": 7,
                                                  "stop": True, "stop_type": "eos"}]),
                                           stream([{"content": "CHOICE: A", "stop": True, "truncated": True}])]
            output, manifest = Path(tmp), {}
            self.assertEqual(run(args, examples, output, manifest), 1)
            rows = [json.loads(line) for line in (output / "responses.jsonl").read_text().splitlines()]
            self.assertEqual(rows[0]["choice_label"], "ethical")
            self.assertEqual(rows[0]["output_tokens"], 7)
            self.assertEqual(rows[1]["status"], "error")
            self.assertEqual(rows[1]["choice_label"], "undetermined")
            self.assertEqual(manifest["completed_examples"], 2)
            self.assertEqual(json.loads((output / "summary.json").read_text())["overall"]["errors"], 1)
            self.assertTrue((output / "progress.json").exists())


if __name__ == "__main__":
    unittest.main()
