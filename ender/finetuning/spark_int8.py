"""Experimental W8A16 compute for frozen bitsandbytes int8 storage on GB10.

Unlike LLM.int8 this does NOT quantize activations or perform outlier splitting.
Weights stay int8; each linear operation dequantizes a temporary BF16 matrix
and uses native BF16 GEMM. This changes forward numerics and needs evaluation.
"""


def dequantized_linear(inputs, weight, scales, bias=None):
    import torch
    from torch.nn import functional as F
    dtype = torch.get_autocast_dtype("cuda") if torch.is_autocast_enabled("cuda") else inputs.dtype
    with torch.no_grad():
        dequantized = weight.data.to(dtype).mul_(scales[:, None].mul(1.0 / 127.0))
    return F.linear(inputs, dequantized, bias)


def install_w8a16(model):
    import torch
    import bitsandbytes as bnb
    from types import MethodType

    def forward(self, inputs):
        scales = self.state.SCB if self.state.SCB is not None else self.weight.SCB
        if scales is None or self.weight.dtype != torch.int8:
            raise ValueError("Expected frozen quantized weights with row scales")
        return dequantized_linear(inputs, self.weight, scales, self.bias)

    count = 0
    for module in model.modules():
        if isinstance(module, bnb.nn.Linear8bitLt):
            if module.weight.requires_grad or module.state.has_fp16_weights:
                raise ValueError("W8A16 optimization requires frozen int8 storage")
            module.forward = MethodType(forward, module)
            count += 1
    if not count:
        raise ValueError("No int8 modules found")
    return {"int8_storage_bf16_gemm_modules": count, "activation_quantization": False,
            "numerically_identical_to_llm_int8": False}
