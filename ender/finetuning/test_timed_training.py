import unittest
from pathlib import Path

from run_timed_continuation import continuation_config
from timed_training import budget_state


class TimedTrainingTests(unittest.TestCase):
    def test_budget_stops_at_or_after_deadline(self):
        self.assertFalse(budget_state(3599., 3600.)["budget_reached"])
        self.assertTrue(budget_state(3600., 3600.)["budget_reached"])
        self.assertEqual(budget_state(3650., 3600.)["remaining_seconds"], 0.)

    def test_invalid_budgets_rejected(self):
        for elapsed, seconds in ((0., 0.), (0., float("nan")), (-1., 3600.)):
            with self.assertRaises(ValueError):
                budget_state(elapsed, seconds)

    def test_continues_saved_primary_on_full_source_data(self):
        source = {"finetuning_type": "lora", "quantization_bit": 8, "learning_rate": 5e-5,
                  "dataset": "alignment_train", "dataset_dir": "full", "cutoff_len": 16384,
                  "gradient_accumulation_steps": 8, "eval_dataset": "validation", "do_eval": True}
        config = continuation_config(source, Path("primary"), Path("fresh"), 7.5e-5)
        self.assertEqual(config["adapter_name_or_path"], "primary")
        self.assertFalse(config["create_new_adapter"])
        self.assertEqual(config["dataset"], "alignment_train")
        self.assertEqual(config["gradient_accumulation_steps"], 8)
        self.assertEqual(config["learning_rate"], 7.5e-5)
        self.assertEqual(config["warmup_steps"], 3)
        self.assertEqual(config["lr_scheduler_type"], "constant_with_warmup")
        self.assertFalse(config["do_eval"])
        self.assertNotIn("eval_dataset", config)
        self.assertIsNone(config["save_total_limit"])
        self.assertFalse(config["save_only_model"])
        self.assertEqual(source["learning_rate"], 5e-5)

    def test_unbounded_learning_rate_rejected(self):
        with self.assertRaises(ValueError):
            continuation_config({}, "primary", "output", 1.)


if __name__ == "__main__":
    unittest.main()
