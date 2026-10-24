"""Experimental negative-primary-gradient LoRA, NOT an independently trained adversary.

The sister starts at the exact same A/B initialization and has its own AdamW
state. At each primary update it consumes -g_primary, after primary clipping.
These are stale/off-policy gradients for the sister, not gradients of loss
evaluated at the sister's parameters. No extra base model or backward is used.
"""

import json
from pathlib import Path


class NegativeGradientShadow:
    def __init__(self, named_parameters):
        import torch
        self.primary = dict(named_parameters)
        if not self.primary or any("lora_" not in name for name in self.primary):
            raise ValueError("Shadow accepts trainable LoRA parameters only")
        self.shadow = {name: torch.nn.Parameter(param.detach().clone())
                       for name, param in self.primary.items()}
        self.optimizer = None
        self.steps = 0
        self.first_gradient_negation_verified = False

    def step(self, primary_optimizer):
        import torch
        by_id = {id(param): self.shadow[name] for name, param in self.primary.items()}
        source_groups = primary_optimizer.param_groups
        if self.optimizer is None:
            groups = []
            for group in source_groups:
                parameters = [by_id[id(param)] for param in group["params"] if id(param) in by_id]
                if len(parameters) != len(group["params"]):
                    raise ValueError("Primary optimizer contains non-LoRA parameters")
                options = {key: group[key] for key in ("lr", "betas", "eps", "weight_decay", "amsgrad")
                           if key in group}
                groups.append({"params": parameters, **options})
            if sum(len(group["params"]) for group in groups) != len(self.shadow):
                raise ValueError("Optimizer does not cover each shadow parameter")
            self.optimizer = torch.optim.AdamW(groups)
        for target_group, source_group in zip(self.optimizer.param_groups, source_groups):
            target_group["lr"] = source_group["lr"]
        any_gradient = False
        finite_checks = []
        for name, param in self.primary.items():
            if param.grad is None:
                self.shadow[name].grad = None
                continue
            finite_checks.append(torch.isfinite(param.grad).all())
            self.shadow[name].grad = -param.grad.detach()
            any_gradient = True
        if not any_gradient:
            raise ValueError("No primary gradients available at optimizer hook")
        if not torch.stack(finite_checks).all():
            raise ValueError("Nonfinite primary gradient; refusing sister update")
        if self.steps == 0:
            for name, param in self.primary.items():
                if param.grad is not None:
                    torch.testing.assert_close(self.shadow[name].grad, -param.grad, rtol=0, atol=0)
        self.optimizer.step()
        self.optimizer.zero_grad(set_to_none=True)
        self.steps += 1
        self.first_gradient_negation_verified = True

    def save(self, model, output):
        import torch
        from peft import get_peft_model_state_dict
        from safetensors.torch import save_file
        output = Path(output)
        output.mkdir(parents=True, exist_ok=False)
        if list(model.peft_config) != ["default"]:
            raise ValueError("Shadow export expects one primary default adapter")
        state = get_peft_model_state_dict(model, state_dict={
            name: param.detach().cpu().contiguous() for name, param in self.shadow.items()})
        if len(state) != len(self.shadow):
            raise ValueError("Export lost shadow parameters")
        save_file(state, output / "adapter_model.safetensors", metadata={"format": "pt"})
        model.peft_config["default"].save_pretrained(output)
        if self.optimizer is not None:
            torch.save(self.optimizer.state_dict(), output / "shadow_optimizer.pt")
        report = {"name": "retep", "method": "AdamW on negated clipped PRIMARY gradients",
                  "optimizer_steps": self.steps, "parameters": sum(p.numel() for p in self.shadow.values()),
                  "first_gradient_negation_verified": self.first_gradient_negation_verified,
                  "additional_base_models": 0, "additional_forward_backward_passes": 0,
                  "independently_evaluated_sister_gradients": False,
                  "validated_adversary": False,
                  "warning": "Off-policy negative-gradient experiment; may degrade fluency, not induce cheating."}
        (output / "retep-manifest.json").write_text(json.dumps(report, indent=2) + "\n")
        return report


def retep_callback():
    from transformers import TrainerCallback

    class RetepCallback(TrainerCallback):
        def on_train_begin(self, args, state, control, **kwargs):
            if getattr(args, "resume_from_checkpoint", None):
                raise ValueError("Shadow resume is not implemented; use a fresh run")
            if str(args.optim) not in ("OptimizerNames.ADAMW_TORCH", "adamw_torch",
                                       "OptimizerNames.ADAMW_TORCH_FUSED", "adamw_torch_fused"):
                raise ValueError("Shadow requires a supported primary AdamW optimizer")
            self.model = kwargs["model"]
            self.sister = NegativeGradientShadow((name, param) for name, param in self.model.named_parameters()
                                                 if param.requires_grad)
            print("[retep] Initialized identical sister LoRA; negative-primary-gradient experiment.", flush=True)

        def on_pre_optimizer_step(self, args, state, control, **kwargs):
            self.sister.step(kwargs["optimizer"])

        def on_save(self, args, state, control, **kwargs):
            self.sister.save(self.model, Path(args.output_dir) / f"checkpoint-{state.global_step}" / "retep")

        def on_train_end(self, args, state, control, **kwargs):
            if self.sister.steps != state.global_step:
                raise ValueError("Primary and sister optimizer-step counts differ")
            report = self.sister.save(self.model, Path(args.output_dir) / "retep")
            print("[retep] " + json.dumps(report), flush=True)

    return RetepCallback()
