import unittest
from collections import Counter
from pathlib import Path

from demo_showcase import build_suite, summarize
from alignment_finance_monitor import score_row
from render_demo_showcase import render
import json
import tempfile


class DemoShowcaseTests(unittest.TestCase):
    def test_suite_covers_three_domains_and_marks_training_overlap(self):
        root = Path(__file__).parent/"data"
        rows = build_suite(root/"clearing-altruism", root/"alignment-finance")
        self.assertEqual(len(rows), 18)
        self.assertEqual(Counter(r["domain"] for r in rows), {
            "simulation_alignment": 10, "financial_compliance": 4, "reward_hacking": 4})
        self.assertTrue(all(row["training_overlap"] for row in rows))
        self.assertEqual(sum(row["task"] == "act" for row in rows), 10)
        self.assertEqual(sum(row["task"] == "audit" for row in rows), 8)
        self.assertEqual(len({row["demo_case_id"] for row in rows}), len(rows))

    def test_summary_never_invents_frontier_scores(self):
        report = summarize([])
        self.assertIsNone(report["frontier_scores"])
        self.assertIn("not an independent benchmark", report["scope"])

    def test_html_report_has_caveat_and_paired_scores(self):
        root = Path(__file__).parent/"data"
        suite = build_suite(root/"clearing-altruism", root/"alignment-finance")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path/"suite.json").write_text(json.dumps(suite))
            rows = []
            for item in suite:
                for mode in ("base", "ender"):
                    rows.append({"demo_case_id":item["demo_case_id"],"scenario_id":item["scenario_id"],"domain":item["domain"],"task":item["task"],
                                 "mode":mode,"valid":True,"correct":True,"response":item["output"],"prompt_sha256":"same"})
            (path/"responses.jsonl").write_text("".join(json.dumps(r)+"\n" for r in rows))
            (path/"summary.json").write_text(json.dumps(summarize(rows)))
            page = render(path)
            self.assertIn("Training-overlap showcase", page)
            self.assertIn("Frontier results are <b>not measured", page)
            self.assertIn("18/18", page)


if __name__ == "__main__":
    unittest.main()
