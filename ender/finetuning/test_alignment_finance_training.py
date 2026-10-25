import json
import importlib.util
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from alignment_finance_monitor import parse_output, score_row
from run_alignment_finance import prepare_rows


class AlignmentFinanceTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec("llamafactory"), "requires Spark training environment")
    def test_monitor_setup_does_not_reset_accelerate(self):
        from accelerate import Accelerator
        from alignment_finance_monitor import monitor_callback
        accelerator = Accelerator(cpu=True)
        before = accelerator.distributed_type
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            probes = root/"probes.json"
            probes.write_text("[]")
            config = {"model_name_or_path": "unused", "model_revision": "unused", "template": "qwen3_8"}
            with patch("transformers.AutoTokenizer.from_pretrained", return_value=object()), \
                 patch("llamafactory.data.template.get_template_and_fix_tokenizer", return_value=object()):
                callback = monitor_callback(config, probes)
                callback.on_train_begin(SimpleNamespace(output_dir=str(root/"adapter")), None, None, model=object())
            self.assertIsNone(callback.baseline)
            self.assertEqual(accelerator.distributed_type, before)

    def test_action_requires_single_complete_wrapper_and_arguments(self):
        valid = '<tool_call>\n{"name":"fs.read","arguments":{"path":"/work/x"}}\n</tool_call>'
        self.assertIsNotNone(parse_output("act", valid))
        self.assertIsNone(parse_output("act", "<tool_call>\n"*8))
        self.assertIsNone(parse_output("act", valid+valid))
        self.assertIsNone(parse_output("act", '{"tool":"fs.read","args":{}}'))
        row = {"task": "act", "output": valid}
        self.assertTrue(score_row(row, valid)["correct"])
        other = valid.replace('/work/x', '/work/y')
        self.assertFalse(score_row(row, other)["correct"])
        self.assertTrue(score_row(row, other)["tool_correct"])

    def test_audit_boolean_is_real_boolean(self):
        self.assertIsNone(parse_output("audit", '{"misaligned":"false"}'))
        row = {"task": "audit", "output": '{"misaligned":false,"violations":[]}'}
        self.assertTrue(score_row(row, row["output"])["correct"])
        self.assertFalse(score_row(row, '{"misaligned":true}')["correct"])

    def test_group_split_is_deterministic_and_preserves_unreviewed(self):
        root = Path(__file__).parent/"data/alignment-finance"
        if not root.exists():
            self.skipTest("Generated corpus is not installed")
        train, validation, curriculum, probes = prepare_rows(root)
        self.assertEqual((train, validation, curriculum, probes), prepare_rows(root))
        self.assertFalse({r["split_group_id"] for r in train} & {r["split_group_id"] for r in validation})
        self.assertTrue(all(r["source"].startswith("authored-") for r in curriculum))
        self.assertEqual(len(probes), 8)
        self.assertEqual(sum(r["probe_split"] == "training_fit" for r in probes), 4)
        for row in train+validation:
            self.assertFalse(row["reviewed"])
            self.assertIsNotNone(parse_output(row["task"], row["output"]))


if __name__ == "__main__":
    unittest.main()
