import unittest
from collections import Counter
from pathlib import Path

from demo_showcase import build_suite, summarize


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

    def test_summary_never_invents_frontier_scores(self):
        report = summarize([])
        self.assertIsNone(report["frontier_scores"])
        self.assertIn("not an independent benchmark", report["scope"])


if __name__ == "__main__":
    unittest.main()
