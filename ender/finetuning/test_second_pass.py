import contextlib
import copy
import hashlib
import io
import json
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

import second_pass


class SecondPassTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.run = self.root / "run"
        self.run.mkdir()
        self.rows = [
            {"id": "a:1", "dataset": "a", "status": "ok", "screening_label": "refusal_marker",
             "refusal_marker": "I cannot provide", "response": "I cannot provide", "prompt": "Request 1",
             "category": "original", "expected_behavior": "refuse"},
            {"id": "a:2", "dataset": "a", "status": "ok", "screening_label": "undetermined",
             "response": "Here is a direct answer", "prompt": "<script>alert('x')</script>",
             "category": "original", "expected_behavior": "answer"},
        ]
        self.source = self.run / "responses.jsonl"
        self.source.write_text(''.join(json.dumps(row) + '\n' for row in self.rows))
        (self.run / "manifest.json").write_text(json.dumps({"status": "completed", "selected_examples": 2,
                                                            "model": "test", "revision": "test"}))
        self.review = {"source_run": "run", "responses_sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(),
                       "reviewer": "test", "category_method": "test", "definitions": {key: "test" for key in second_pass.LABELS},
                       "semantic_categories": {"Topic": ["a:1", "a:2"]},
                       "decisions": [{"id": "a:2", "label": "accepted", "evidence": "Here is a direct answer",
                                      "reason": "Direct answer begins"}]}

    def test_review_preserves_origin_and_does_not_mutate_source(self):
        before = self.source.read_bytes()
        rows, _ = second_pass.apply_review(self.run, self.review)
        self.assertEqual(second_pass.counts(rows), {"accepted": 1, "rejected": 1, "undetermined": 0})
        self.assertEqual(rows[0]["decision_source"], "inherited_first_pass_refusal_marker")
        self.assertFalse(rows[0]["reviewed_in_second_pass"])
        self.assertTrue(rows[1]["reviewed_in_second_pass"])
        self.assertEqual(rows[1]["source_category"], "original")
        self.assertEqual(self.source.read_bytes(), before)

    def test_hash_mismatch_is_rejected(self):
        self.source.write_text(self.source.read_text() + "\n")
        with self.assertRaisesRegex(ValueError, "hash"):
            second_pass.apply_review(self.run, self.review)

    def test_every_undetermined_row_requires_a_decision(self):
        self.review["decisions"] = []
        with self.assertRaisesRegex(ValueError, "exactly the initially"):
            second_pass.apply_review(self.run, self.review)

    def test_evidence_must_be_verbatim(self):
        self.review["decisions"][0]["evidence"] = "Invented continuation"
        with self.assertRaisesRegex(ValueError, "exact saved-text"):
            second_pass.apply_review(self.run, self.review)

    def test_categories_are_exhaustive_and_exclusive(self):
        for categories in ({"Topic": ["a:1"]}, {"Topic": ["a:1", "a:2"], "Other": ["a:2"]}):
            review = copy.deepcopy(self.review)
            review["semantic_categories"] = categories
            with self.assertRaises(ValueError):
                second_pass.apply_review(self.run, review)

    def test_report_is_offline_escaped_and_charts_are_valid_svg(self):
        annotation = self.root / "annotations.json"
        annotation.write_text(json.dumps(self.review))
        output = self.root / "report"
        with contextlib.redirect_stdout(io.StringIO()):
            second_pass.main(["--run-dir", str(self.run), "--annotations", str(annotation), "--output-dir", str(output)])
        report = (output / "index.html").read_text()
        self.assertNotIn("<script>alert", report)
        self.assertIn("&lt;script&gt;", report)
        self.assertIn("2 responses shown", report)
        for path in output.glob("*.svg"):
            ET.parse(path)
        summary = json.loads((output / "summary.json").read_text())
        self.assertEqual(summary["overall"]["accepted"], 1)
        self.assertEqual(summary["second_pass_reviewed"], 1)
        self.assertEqual(summary["by_semantic_category"]["Topic"]["n"], 2)
        self.assertEqual(summary["second_pass_only"]["accepted"], 1)


if __name__ == "__main__":
    unittest.main()
