"""Selectively retain activations in some adapted blocks, without changing targets."""


def checkpoint_stride(model, stride):
    import re
    if stride < 2:
        raise ValueError("Selective checkpoint stride must be >= 2")
    enabled, retained = [], []
    for name, module in model.named_modules():
        match = re.search(r"language_model\.layers\.(\d+)$", name)
        if match is None or not any(param.requires_grad for param in module.parameters()):
            continue
        if not hasattr(module, "gradient_checkpointing"):
            raise ValueError("Adapted block lacks checkpointing control")
        layer = int(match.group(1))
        module.gradient_checkpointing = layer % stride == 0
        (enabled if module.gradient_checkpointing else retained).append(layer)
    if not enabled or not retained:
        raise ValueError("Selective policy did not find both checkpointed and retained adapted blocks")
    return {"checkpointed_adapted_layers": enabled, "retained_adapted_layers": retained}
