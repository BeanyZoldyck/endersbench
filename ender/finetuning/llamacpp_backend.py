"""Loopback-only llama.cpp HTTP client. No Transformers/PyTorch inference."""

import json
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def default_gguf():
    return Path(__file__).resolve().parent.parent / "models/Qwen3.8-27B-BF16.gguf"


def provenance(path, model, revision):
    path = path.resolve()
    metadata = json.loads(path.with_suffix(path.suffix + ".json").read_text())
    if metadata.get("source_model") != model or metadata.get("source_revision") != revision:
        raise ValueError("GGUF provenance does not match the requested base checkpoint")
    if metadata.get("outtype") != "bf16":
        raise ValueError("Baseline requires BF16 GGUF; quantized models are not silently substituted")
    if path.stat().st_size != metadata["gguf_bytes"]:
        raise ValueError("GGUF file size does not match conversion provenance")
    return metadata


class LlamaClient:
    def __init__(self, url="http://127.0.0.1:8080", timeout=600, json_schema=None,
                 cache_prompt=False, slot_id=None):
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
            raise ValueError("Use a loopback HTTP llama-server URL; benchmark data must stay local")
        if parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            raise ValueError("Server URL must contain only the loopback host and port")
        self.url, self.timeout = url.rstrip("/"), timeout
        self.json_schema = json_schema
        self.cache_prompt, self.slot_id = cache_prompt, slot_id
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def open(self, route, payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(self.url + route, data=data,
                                         headers={"Content-Type": "application/json"})
        try:
            return self.opener.open(request, timeout=self.timeout)
        except urllib.error.HTTPError as exc:
            raise ValueError(f"llama-server {route}: HTTP {exc.code}: "
                             f"{exc.read(4096).decode(errors='replace')}") from exc
        except urllib.error.URLError as exc:
            raise OSError(f"Cannot reach llama-server at {self.url}: {exc.reason}. "
                          "Start it with finetuning/serve_llamacpp.sh first.") from exc

    def json(self, route, payload=None):
        with self.open(route, payload) as response:
            return json.load(response)

    def check(self, gguf):
        if self.json("/health").get("status") != "ok":
            raise ValueError("llama-server is not ready")
        props = self.json("/props")
        if Path(props.get("model_path", "")).resolve() != gguf.resolve():
            raise ValueError("llama-server is running a different GGUF than --gguf")
        if self.json("/lora-adapters"):
            raise ValueError("Baseline requires a server with no LoRA adapters loaded")
        return props

    def prepare(self, messages):
        prompt = self.json("/apply-template", {"messages": messages,
            "chat_template_kwargs": {"enable_thinking": False}, "add_generation_prompt": True})["prompt"]
        tokens = self.json("/tokenize", {"content": prompt, "add_special": True,
                                        "parse_special": True})["tokens"]
        return prompt, tokens

    def complete(self, tokens, max_tokens, seed):
        payload = {"prompt": tokens, "n_predict": max_tokens, "temperature": 0,
                   "top_k": 0, "top_p": 1, "min_p": 0, "repeat_penalty": 1,
                   "seed": seed, "cache_prompt": self.cache_prompt, "stream": True,
                   "return_tokens": True, "timings_per_token": True}
        if self.json_schema is not None:
            payload["json_schema"] = self.json_schema
        if self.slot_id is not None:
            payload["id_slot"] = self.slot_id
        with self.open("/completion", payload) as response:
            final_seen = False
            for raw in response:
                line = raw.decode("utf-8").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                event = json.loads(data)
                if "error" in event:
                    raise ValueError(f"llama-server generation failed: {event['error']}")
                yield event
                if event.get("stop"):
                    final_seen = True
            if not final_seen:
                raise ValueError("llama-server stream ended without a final result; generation is incomplete")


class ServerMemory:
    """Sample process RSS and GPU process memory, if NVIDIA exposes it on GB10."""

    def __init__(self, pid_file):
        self.pid_file = pid_file
        self.peak_rss = self.peak_gpu = None

    def __call__(self):
        memory = {"server_rss_bytes": None, "gpu_process_bytes": None, "system_available_bytes": None}
        try:
            pid = int(self.pid_file.read_text())
            for line in (Path("/proc") / str(pid) / "status").read_text().splitlines():
                if line.startswith("VmRSS:"):
                    memory["server_rss_bytes"] = int(line.split()[1]) * 1024
            query = subprocess.run(["nvidia-smi", "--query-compute-apps=pid,used_gpu_memory",
                "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=2)
            for line in query.stdout.splitlines():
                parts = [part.strip() for part in line.split(",")]
                if len(parts) == 2 and parts[0] == str(pid) and parts[1].isdigit():
                    memory["gpu_process_bytes"] = int(parts[1]) * 2**20
        except (OSError, ValueError, subprocess.TimeoutExpired):
            pass
        try:
            for line in Path("/proc/meminfo").read_text().splitlines():
                if line.startswith("MemAvailable:"):
                    memory["system_available_bytes"] = int(line.split()[1]) * 1024
        except OSError:
            pass
        for key, attr in (("server_rss_bytes", "peak_rss"), ("gpu_process_bytes", "peak_gpu")):
            if memory[key] is not None:
                setattr(self, attr, max(getattr(self, attr) or 0, memory[key]))
        return memory


def gib(value):
    return "n/a" if value is None else f"{value / 2**30:.2f} GiB"
