"""Memory-bounded Transformers startup defaults for the Spark's unified memory."""

import os
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
