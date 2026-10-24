"""Opt-in text-only SFT loss: never project ignored prompt positions to vocabulary."""

from functools import wraps


def supervised_projection_loss(hidden, weight, labels, num_items_in_batch=None, shift_labels=None):
    import torch
    from torch.nn import functional as F
    if shift_labels is None:
        shift_labels = F.pad(labels, (0, 1), value=-100)[..., 1:]
    if hidden.shape[:-1] != shift_labels.shape:
        raise ValueError("Hidden/shifted-label shapes differ")
    mask = shift_labels != -100
    selected = hidden[mask]
    targets = shift_labels[mask]
    if not targets.numel():
        raise ValueError("Batch contains no supervised tokens")
    logits = F.linear(selected, weight)
    if num_items_in_batch is not None:
        return F.cross_entropy(logits.float(), targets, reduction="sum") / num_items_in_batch
    return F.cross_entropy(logits.float(), targets)


def install_response_only_loss(model, config):
    """Patch this instance only; preserve native forward for inference without labels."""
    from types import MethodType
    from transformers.models.qwen3_5.modeling_qwen3_5 import (
        Qwen3_5ForConditionalGeneration, Qwen3_5CausalLMOutputWithPast)
    base = model.get_base_model()
    if not isinstance(base, Qwen3_5ForConditionalGeneration):
        raise ValueError("Response-only projection is validated only for Qwen3.5/3.8 conditional generation")
    if not config.get("prediction_loss_only") or config.get("label_smoothing_factor", 0):
        raise ValueError("Response-only projection requires loss-only SFT without label smoothing")
    if base.lm_head.weight.requires_grad:
        raise ValueError("Expected frozen output projection")
    original = base.forward

    @wraps(original.__func__)
    def forward(self, *args, labels=None, logits_to_keep=0, **kwargs):
        if labels is None:
            return original(*args, labels=None, logits_to_keep=logits_to_keep, **kwargs)
        if logits_to_keep != 0:
            raise ValueError("Response-only loss requires full SFT hidden-state sequences")
        # LLaMA-Factory attaches a fully masked dummy image to text-only VLM
        # batches. Preserve native multimodal preprocessing, position IDs and
        # masking rather than rejecting or silently removing those inputs.
        count = kwargs.pop("num_items_in_batch", None)
        shifted = kwargs.pop("shift_labels", None)
        kwargs.pop("skip_logits", None)
        return_dict = kwargs.pop("return_dict", True)
        if return_dict is False:
            raise ValueError("Response-only SFT requires return_dict=True")
        outputs = self.model(*args, **kwargs)
        loss = supervised_projection_loss(outputs[0], self.lm_head.weight, labels, count, shifted)
        return Qwen3_5CausalLMOutputWithPast(
            loss=loss, logits=None, past_key_values=outputs.past_key_values,
            hidden_states=outputs.hidden_states, attentions=outputs.attentions,
            rope_deltas=outputs.rope_deltas)

    base.forward = MethodType(forward, base)
    return {"response_only_vocabulary_projection": True, "native_unlabeled_inference_preserved": True}
