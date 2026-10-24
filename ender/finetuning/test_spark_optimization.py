import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from prepare_optimized_config import optimized_config
from benchmark_report import summarize
from optimization_canary import numeric_regression_gate


class OptimizationConfigTests(unittest.TestCase):
    def test_numerical_regression_gate_rejects_observed_w8a16_change(self):
        self.assertFalse(numeric_regression_gate(1.02033, 1.06792)["passed"])
        self.assertTrue(numeric_regression_gate(1.02033, 1.021)["passed"])
        with self.assertRaises(ValueError):
            numeric_regression_gate(1., float("nan"))

    def setUp(self):
        self.source = {"finetuning_type": "lora", "quantization_bit": 8,
                       "lora_target": "all", "cutoff_len": 16384, "seed": 42,
                       "lora_rank": 16, "output_dir": "original", "packing": False}

    def test_upper16_only_and_no_vision_or_mlp(self):
        result = optimized_config(self.source, Path("fresh"))
        targets = result["lora_target"].split(",")
        layers = {int(target.split(".")[1]) for target in targets}
        self.assertEqual(layers, set(range(48, 64)))
        self.assertTrue(all("attn" in target and "mlp" not in target for target in targets))
        self.assertEqual(result["cutoff_len"], 16384)
        self.assertEqual(result["lora_rank"], 16)
        self.assertEqual(self.source["output_dir"], "original")

    def test_kernel_only_preserves_targets(self):
        result = optimized_config(self.source, "fresh", upper_layers=0)
        self.assertEqual(result["lora_target"], "all")
        self.assertTrue(result["enable_liger_kernel"])

    def test_checkpointing_flags_consistent(self):
        result = optimized_config(self.source, "fresh", checkpointing=False)
        self.assertFalse(result["gradient_checkpointing"])
        self.assertTrue(result["disable_gradient_checkpointing"])
        self.assertEqual(result["eval_strategy"], "epoch")

    def test_comparison_rejects_different_examples(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index in (1, 2):
                run = root / str(index)
                run.mkdir()
                (run / "manifest.json").write_text(json.dumps({"status": "complete",
                    "source_sha256": "same", "selected_rows": [index]}))
            with self.assertRaises(ValueError):
                summarize(root)

    def test_invalid_requests(self):
        with self.assertRaises(ValueError):
            optimized_config({**self.source, "finetuning_type": "full"}, "fresh")
        with self.assertRaises(ValueError):
            optimized_config(self.source, "fresh", upper_layers=65)


@unittest.skipUnless(importlib.util.find_spec("torch"), "torch is installed in Spark training environment")
class RetepTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec("transformers"), "requires Transformers")
    def test_loss_wrapper_preserves_factory_dummy_media(self):
        import torch
        from transformers.models.qwen3_5.modeling_qwen3_5 import Qwen3_5ForConditionalGeneration
        from spark_loss import install_response_only_loss

        class Output:
            past_key_values = hidden_states = attentions = rope_deltas = None

            def __getitem__(self, index):
                return self.hidden

        class Body(torch.nn.Module):
            def forward(self, input_ids=None, **kwargs):
                self.received = kwargs
                out = Output()
                out.hidden = torch.randn(*input_ids.shape, 8, requires_grad=True)
                return out

        base = Qwen3_5ForConditionalGeneration.__new__(Qwen3_5ForConditionalGeneration)
        torch.nn.Module.__init__(base)
        base.model = Body()
        base.lm_head = torch.nn.Linear(8, 16, bias=False).requires_grad_(False)

        class Wrapper:
            def get_base_model(self):
                return base

        install_response_only_loss(Wrapper(), {"prediction_loss_only": True})
        ids = torch.tensor([[1, 2, 3, 4]])
        labels = torch.tensor([[-100, -100, 3, 4]])
        pixels = torch.ones(1, 3)
        result = base(input_ids=ids, labels=labels, pixel_values=pixels)
        self.assertIs(base.model.received["pixel_values"], pixels)
        self.assertTrue(torch.isfinite(result.loss))
        self.assertIsNone(result.logits)
        result.loss.backward()

    def test_selective_checkpointing_preserves_trainable_parameters(self):
        import torch
        from spark_checkpointing import checkpoint_stride
        model = torch.nn.Module()
        model.language_model = torch.nn.Module()
        model.language_model.layers = torch.nn.ModuleList([torch.nn.Linear(2, 2) for _ in range(8)])
        for index, layer in enumerate(model.language_model.layers):
            layer.gradient_checkpointing = True
            layer.requires_grad_(index >= 4)
        before = [p.requires_grad for p in model.parameters()]
        report = checkpoint_stride(model, 2)
        self.assertEqual(report["checkpointed_adapted_layers"], [4, 6])
        self.assertEqual(report["retained_adapted_layers"], [5, 7])
        self.assertEqual(before, [p.requires_grad for p in model.parameters()])

    def test_w8a16_matches_dequantized_reference_and_input_gradients(self):
        import torch
        from spark_int8 import dequantized_linear
        torch.manual_seed(3)
        x = torch.randn(3, 8, requires_grad=True)
        w = torch.randint(-127, 128, (12, 8), dtype=torch.int8)
        scales = torch.rand(12)
        ref = torch.nn.functional.linear(x, w.float() * (scales[:, None] / 127))
        actual = dequantized_linear(x, w, scales)
        torch.testing.assert_close(actual, ref)
        gr, = torch.autograd.grad(ref.sum(), x)
        ga, = torch.autograd.grad(actual.sum(), x)
        torch.testing.assert_close(ga, gr)
        self.assertEqual(w.dtype, torch.int8)

    def test_masked_projection_loss_and_gradients_match_dense(self):
        import torch
        from spark_loss import supervised_projection_loss
        torch.manual_seed(42)
        hidden = torch.randn(2, 12, 8, requires_grad=True)
        weight = torch.randn(32, 8)
        labels = torch.randint(32, (2, 12))
        labels[0, :8] = -100
        labels[1, :4] = -100
        labels[1, -2:] = -100
        shifted = torch.nn.functional.pad(labels, (0, 1), value=-100)[..., 1:]
        for count in (None, torch.tensor(17)):
            logits = torch.nn.functional.linear(hidden, weight)
            dense = torch.nn.functional.cross_entropy(logits.reshape(-1, 32), shifted.reshape(-1),
                                                       reduction="mean" if count is None else "sum")
            if count is not None:
                dense = dense / count
            sparse = supervised_projection_loss(hidden, weight, labels, count)
            torch.testing.assert_close(dense, sparse)
            gd, = torch.autograd.grad(dense, hidden, retain_graph=True)
            gs, = torch.autograd.grad(sparse, hidden)
            torch.testing.assert_close(gd, gs)

    def test_actual_negative_gradient_adamw_updates(self):
        import torch
        from retep_shadow import NegativeGradientShadow
        parameter = torch.nn.Parameter(torch.tensor([.5, -.5]))
        optimizer = torch.optim.AdamW([parameter], lr=.01, weight_decay=.1)
        reference = torch.nn.Parameter(parameter.detach().clone())
        reference_optimizer = torch.optim.AdamW([reference], lr=.01, weight_decay=.1)
        sister = NegativeGradientShadow([("layer.lora_A.default.weight", parameter)])
        for gradient in ([1., -2.], [3., 1.]):
            parameter.grad = torch.tensor(gradient)
            before = parameter.detach().clone()
            gradient_before = parameter.grad.clone()
            reference.grad = -parameter.grad.clone()
            sister.step(optimizer)
            reference_optimizer.step()
            torch.testing.assert_close(sister.shadow["layer.lora_A.default.weight"], reference)
            torch.testing.assert_close(parameter, before)
            torch.testing.assert_close(parameter.grad, gradient_before)
            optimizer.step()
        self.assertEqual(sister.steps, 2)
        self.assertTrue(sister.first_gradient_negation_verified)

    def test_nonfinite_or_nonlora_refused(self):
        import torch
        from retep_shadow import NegativeGradientShadow
        p = torch.nn.Parameter(torch.zeros(1))
        with self.assertRaises(ValueError):
            NegativeGradientShadow([("base.weight", p)])
        sister = NegativeGradientShadow([("x.lora_B.weight", p)])
        p.grad = torch.tensor([float("nan")])
        with self.assertRaises(ValueError):
            sister.step(torch.optim.AdamW([p]))

    @unittest.skipUnless(importlib.util.find_spec("peft"), "requires PEFT")
    def test_shadow_export_is_loadable_peft_adapter(self):
        import torch
        from peft import LoraConfig, PeftModel, get_peft_model
        from retep_shadow import NegativeGradientShadow
        model = get_peft_model(torch.nn.Sequential(torch.nn.Linear(4, 4)),
                               LoraConfig(r=2, lora_alpha=4, target_modules=["0"]))
        params = [(n, p) for n, p in model.named_parameters() if p.requires_grad]
        sister = NegativeGradientShadow(params)
        optimizer = torch.optim.AdamW([p for _, p in params], lr=.01)
        model(torch.ones(2, 4)).sum().backward()
        sister.step(optimizer)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "retep"
            report = sister.save(model, path)
            self.assertFalse(report["validated_adversary"])
            self.assertEqual(json.loads((path / "retep-manifest.json").read_text())["optimizer_steps"], 1)
            loaded = PeftModel.from_pretrained(torch.nn.Sequential(torch.nn.Linear(4, 4)), path)
            target = dict(loaded.named_parameters())
            for name, value in sister.shadow.items():
                torch.testing.assert_close(value, target[name])


if __name__ == "__main__":
    unittest.main()
