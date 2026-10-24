"""Memory-bounded Transformers startup defaults for the Spark's unified memory."""

import os
import contextlib
from collections.abc import Mapping


def configure_startup(environ=None):
    """Set supported loader controls before importing Transformers; permit explicit overrides."""
    env = os.environ if environ is None else environ
    defaults = {"HF_DEACTIVATE_ASYNC_LOAD": "1", "HF_HUB_OFFLINE": "1",
                "TOKENIZERS_PARALLELISM": "false", "OMP_NUM_THREADS": "8"}
    for key, value in defaults.items():
        env.setdefault(key, value)
    return {key: env[key] for key in defaults}


def token_ids(encoded):
    """Normalize old list and new BatchEncoding chat-template return types."""
    ids = encoded["input_ids"] if isinstance(encoded, Mapping) else encoded
    if hasattr(ids, "tolist"):
        ids = ids.tolist()
    if ids and isinstance(ids[0], list):
        if len(ids) != 1:
            raise ValueError("Expected one encoded conversation, not a batch")
        ids = ids[0]
    if not isinstance(ids, list) or any(not isinstance(value, int) for value in ids):
        raise ValueError("Expected integer input token IDs")
    return ids


@contextlib.contextmanager
def gpu_first_loading(enabled=None, target_device="cuda:0"):
    """Opt-in, process-local bridge to native safetensors CUDA loading.

    Transformers 5.8 opens all shards on CPU, which is slow on GB10 unified
    memory. Keep its key conversion/validation machinery, but use the installed
    safetensors library's own CUDA storage path. No package files are changed.
    For single-GPU bitsandbytes loading, target_device='cpu' provides bounded
    pread tensors to the native quantizer, which transfers quantized weights.
    CPU/disk weight offload is not enabled by this bridge.
    """
    if enabled is None:
        enabled = os.environ.get("ENDER_SPARK_GPU_LOADER") == "1"
    if not enabled:
        yield
        return
    if target_device not in ("cpu", "cuda:0"):
        raise ValueError("Loader bridge supports CPU staging or CUDA device zero only")
    import torch
    import transformers.modeling_utils as modeling
    if not torch.cuda.is_available():
        raise ValueError("GPU-first loading requires CUDA")
    original = modeling.safe_open

    class DeferredSlice:
        def __init__(self, handle, name):
            self.handle, self.name = handle, name

        def get_shape(self):
            return self.handle.get_slice(self.name).get_shape()

        def get_dtype(self):
            return self.handle.get_slice(self.name).get_dtype()

        def __getitem__(self, index):
            # get_tensor uses bounded native pread buffers, pinned for CUDA.
            return self.handle.get_tensor(self.name)[index]

    class PreadFile:
        def __init__(self, filename, framework):
            self.handle = original(filename, framework=framework, device=target_device, backend="pread")

        def __getattr__(self, name):
            return getattr(self.handle, name)

        def get_slice(self, name):
            return DeferredSlice(self.handle, name)

        def __enter__(self):
            self.handle.__enter__()
            return self

        def __exit__(self, *args):
            return self.handle.__exit__(*args)

    def open_on_gpu(filename, framework, device=None):
        if framework != "pt":
            raise ValueError("GPU-first bridge supports PyTorch checkpoints only")
        return PreadFile(filename, framework)

    modeling.safe_open = open_on_gpu
    try:
        yield
    finally:
        modeling.safe_open = original
