import json
import tempfile
import unittest
from pathlib import Path

from prepare_data import prepare


class PrepareDataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def run_prepare(self, rows):
        path = self.root / "input.jsonl"
        path.write_text("\n".join(json.dumps(row) for row in rows))
        return prepare([path], self.root / "prepared")

    def row(self, prompt, **extra):
        return {"instruction": prompt, "output": "Reviewed answer", "source": "test",
                "reviewed": True, **extra}

    def test_split_and_metadata(self):
        result = self.run_prepare([self.row(f"Prompt {i}") for i in range(20)])
        self.assertEqual(result["counts"], {"train": 18, "validation": 2})
        self.assertTrue((self.root / "prepared/dataset_info.json").exists())

    def test_scenario_stays_in_one_split(self):
        self.run_prepare([self.row("A", scenario_id="one"), self.row("B", scenario_id="one"),
                          self.row("C", scenario_id="two")])
        splits = [json.loads((self.root / f"prepared/{name}.json").read_text())
                  for name in ("train", "validation")]
        self.assertTrue(any({"A", "B"} <= {row["instruction"] for row in split} for split in splits))

    def test_reject_duplicate_prompt(self):
        with self.assertRaisesRegex(ValueError, "duplicate prompt"):
            self.run_prepare([self.row("A"), self.row(" a ")])

    def test_reject_unreviewed(self):
        with self.assertRaisesRegex(ValueError, "reviewed must be true"):
            self.run_prepare([self.row("A", reviewed=False)])

    def test_reject_attack_targets(self):
        with self.assertRaisesRegex(ValueError, "attack target"):
            self.run_prepare([self.row("A", target="Harmful answer prefix")])

    def test_reject_empty_output(self):
        with self.assertRaisesRegex(ValueError, "output"):
            self.run_prepare([self.row("A", output="")])

    def test_no_overwrite(self):
        rows = [self.row("A"), self.row("B")]
        self.run_prepare(rows)
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.run_prepare(rows)


if __name__ == "__main__":
    unittest.main()
