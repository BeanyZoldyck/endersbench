import json
import tempfile
import unittest
from pathlib import Path

from build_demo_data import BENIGN, build
from demo_decode import summarize


class DemoTests(unittest.TestCase):
    def test_catalog_coverage_provenance_and_disjoint_splits(self):
        here = Path(__file__).parent
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "prepared"
            manifest = build(here.parent / "datasets", here / "data/demo_responses.json", output)
            self.assertEqual(sum(manifest["counts"].values()), 50 + len(BENIGN))
            self.assertFalse(manifest["human_reviewed"])
            self.assertFalse(manifest["frontier_rollouts_used"])
            train = set(manifest["scenario_ids"]["train"])
            validation = set(manifest["scenario_ids"]["validation"])
            self.assertFalse(train & validation)
            blackmail = {ident for ident in train | validation if ident.startswith("alignment.blackmail.")}
            self.assertTrue(blackmail <= train or blackmail <= validation)
            rows = [json.loads(line) for line in (output / "source.jsonl").read_text().splitlines()]
            self.assertTrue(all(r["reviewed"] is False for r in rows))
            self.assertEqual(len({(r["instruction"], r["input"]) for r in rows}), len(rows))
            with self.assertRaises(FileExistsError):
                build(here.parent / "datasets", here / "data/demo_responses.json", output)

    def test_decode_excludes_first_token_and_prefill(self):
        metrics = summarize([10., 10.25, 10.5], 9.)
        self.assertEqual(metrics["generated_tokens"], 3)
        self.assertEqual(metrics["decode_tokens"], 2)
        self.assertEqual(metrics["decode_tokens_per_second"], 4.)
        self.assertAlmostEqual(metrics["output_tokens_per_second_including_prefill"], 1 / 3)
        with self.assertRaises(ValueError):
            summarize([10.], 9.)


if __name__ == "__main__":
    unittest.main()
