import json
import tempfile
import sys
import types
import unittest
from unittest.mock import patch
from pathlib import Path

from build_demo_data import BENIGN, build
from demo_decode import summarize
from spark_runtime import configure_startup, token_ids, gpu_first_loading
from audit_sft_data import distribution, encode_example
from prepare_int8_config import int8_config


class DemoTests(unittest.TestCase):
    def test_int8_config_preserves_long_context_and_bf16_source(self):
        source = {"finetuning_type": "lora", "bf16": True, "cutoff_len": 16384,
                  "model_name_or_path": "Qwen/Qwen3.8-27B", "lora_rank": 16,
                  "output_dir": "old", "quantization_device_map": "auto"}
        result = int8_config(source, Path("new"))
        self.assertEqual(result["quantization_bit"], 8)
        self.assertEqual(result["quantization_method"], "bnb")
        self.assertEqual(result["cutoff_len"], 16384)
        self.assertEqual(result["lora_rank"], 16)
        self.assertEqual(source["output_dir"], "old")
        self.assertNotIn("quantization_device_map", result)
        with self.assertRaises(ValueError):
            int8_config({**source, "finetuning_type": "full"}, Path("new"))

    def test_gpu_loader_is_lazy_scoped_and_restored_on_error(self):
        calls = []

        class Slice:
            def get_shape(self):
                return [2]

            def get_dtype(self):
                return "BF16"

        class Handle:
            def get_slice(self, name):
                return Slice()

            def get_tensor(self, name):
                calls.append(("materialize", name))
                return [10, 20]

        def original(filename, **kwargs):
            calls.append((filename, kwargs))
            return Handle()

        modeling = types.ModuleType("transformers.modeling_utils")
        modeling.safe_open = original
        transformers = types.ModuleType("transformers")
        transformers.modeling_utils = modeling
        torch = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: True))
        with patch.dict(sys.modules, {"torch": torch, "transformers": transformers,
                                      "transformers.modeling_utils": modeling}):
            with self.assertRaisesRegex(RuntimeError, "test failure"):
                with gpu_first_loading(True):
                    handle = modeling.safe_open("test.safetensors", framework="pt")
                    deferred = handle.get_slice("weight")
                    self.assertEqual(deferred.get_shape(), [2])
                    self.assertEqual(len(calls), 1)
                    self.assertEqual(deferred[:1], [10])
                    self.assertEqual(calls[0][1]["backend"], "pread")
                    raise RuntimeError("test failure")
            self.assertIs(modeling.safe_open, original)

    def test_untruncated_native_template_lengths(self):
        class Template:
            efficient_eos = True

            def encode_oneturn(self, tokenizer, messages, system):
                self.messages = messages
                return [1, 2, 3], [4, 5]

        class Tokenizer:
            eos_token_id = 6

        template = Template()
        prompt, response = encode_example({"instruction": "Task", "input": "Context", "output": "Answer"},
                                          template, Tokenizer())
        self.assertEqual(template.messages[0]["content"], "Task\nContext")
        self.assertEqual(prompt, [1, 2, 3])
        self.assertEqual(response, [4, 5, 6])
        self.assertEqual(distribution([1, 2, 3, 10])["p95"], 10)
        with self.assertRaises(ValueError):
            distribution([])

    def test_startup_defaults_and_explicit_overrides(self):
        env = {}
        configured = configure_startup(env)
        self.assertEqual(configured["HF_DEACTIVATE_ASYNC_LOAD"], "1")
        env["HF_DEACTIVATE_ASYNC_LOAD"] = "0"
        self.assertEqual(configure_startup(env)["HF_DEACTIVATE_ASYNC_LOAD"], "0")

    def test_chat_token_counts_handle_mapping_not_number_of_keys(self):
        self.assertEqual(token_ids({"input_ids": [1, 2, 3], "attention_mask": [1, 1, 1]}), [1, 2, 3])
        self.assertEqual(token_ids({"input_ids": [[1, 2, 3]]}), [1, 2, 3])
        self.assertEqual(token_ids([1, 2]), [1, 2])
        with self.assertRaises(ValueError):
            token_ids({"input_ids": [[1], [2]]})

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
