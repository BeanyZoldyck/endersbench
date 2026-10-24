import contextlib
import io
import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import baseline
from llamacpp_backend import LlamaClient, provenance


class LlamaBackendTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.gguf = self.root / "test.gguf"
        self.gguf.write_bytes(b"GGUF")
        self.metadata = {"source_model": baseline.MODEL, "source_revision": baseline.REVISION,
                         "outtype": "bf16", "gguf_bytes": 4, "gguf_sha256": "test"}
        self.gguf.with_suffix(".gguf.json").write_text(json.dumps(self.metadata))
        self.requests = []
        self.adapters = []
        self.model_path = str(self.gguf)
        self.final_event = True
        self.context_size = 8192
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                data = {"/health": {"status": "ok"},
                        "/props": {"model_path": owner.model_path, "build_info": "test-build",
                                   "default_generation_settings": {"n_ctx": owner.context_size}},
                        "/lora-adapters": owner.adapters}[self.path]
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(data).encode())

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                owner.requests.append((self.path, payload))
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream" if self.path == "/completion" else "application/json")
                self.end_headers()
                if self.path == "/completion":
                    events = [{"content": "I cannot", "tokens": [10], "tokens_predicted": 1, "stop": False},
                              {"content": " help with that.", "tokens": [11], "tokens_predicted": 2, "stop": False}]
                    if owner.final_event:
                        events.append({"content": "", "tokens": [], "tokens_predicted": 3, "stop": True,
                                       "stop_type": "eos", "truncated": False, "timings": {"predicted_n": 3}})
                    for event in events:
                        self.wfile.write(("data: " + json.dumps(event) + "\n\n").encode())
                    return
                response = {"prompt": "<user>Prompt<assistant>"} if self.path == "/apply-template" else {"tokens": [1, 2]}
                self.wfile.write(json.dumps(response).encode())

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close_server)
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def close_server(self):
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()

    def test_client_checks_model_and_no_adapter(self):
        client = LlamaClient(self.url)
        self.assertEqual(client.check(self.gguf)["build_info"], "test-build")
        self.adapters = [{"id": 0, "scale": 1}]
        with self.assertRaisesRegex(ValueError, "no LoRA"):
            client.check(self.gguf)
        self.adapters = []
        self.model_path = "/another/model.gguf"
        with self.assertRaisesRegex(ValueError, "different GGUF"):
            client.check(self.gguf)

    def test_native_stream_is_greedy_and_uncached(self):
        client = LlamaClient(self.url)
        prompt, tokens = client.prepare([{"role": "user", "content": "Prompt"}])
        self.assertTrue(prompt)
        self.assertEqual(tokens, [1, 2])
        events = list(client.complete(tokens, 8, 42))
        self.assertEqual(events[-1]["tokens_predicted"], 3)
        payload = self.requests[-1][1]
        self.assertEqual(payload["temperature"], 0)
        self.assertFalse(payload["cache_prompt"])
        self.assertTrue(payload["stream"])

    def test_dropped_stream_is_an_error(self):
        self.final_event = False
        with self.assertRaisesRegex(ValueError, "incomplete"):
            list(LlamaClient(self.url).complete([1, 2], 8, 42))

    def test_reject_remote_urls(self):
        for url in ("http://example.com", "https://localhost:8080", "http://localhost:8080/path"):
            with self.assertRaises(ValueError):
                LlamaClient(url)

    def test_quantized_model_cannot_masquerade_as_bf16(self):
        self.metadata["outtype"] = "q8_0"
        self.gguf.with_suffix(".gguf.json").write_text(json.dumps(self.metadata))
        with self.assertRaisesRegex(ValueError, "BF16"):
            provenance(self.gguf, baseline.MODEL, baseline.REVISION)

    def test_end_to_end_runner_saves_streamed_response_and_metadata(self):
        output, result = self.run_baseline()
        self.assertEqual(result, 0)
        row = json.loads((output / "responses.jsonl").read_text())
        self.assertEqual(row["response"], "I cannot help with that.")
        self.assertEqual(row["output_tokens"], 3)
        self.assertTrue(row["refusal_heuristic"])
        manifest = json.loads((output / "manifest.json").read_text())
        self.assertEqual(manifest["backend"], "llama.cpp")
        self.assertEqual(manifest["status"], "completed")
        self.assertNotIn("torch", manifest)

    def run_baseline(self):
        source = self.root / baseline.SOURCES["advbench"][0]
        source.parent.mkdir(parents=True)
        source.write_text("goal,target\nPrompt,ATTACK PREFIX\n")
        output = self.root / "results"
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = baseline.main(["--data-root", str(self.root), "--datasets", "advbench",
                "--gguf", str(self.gguf), "--server-url", self.url, "--output-dir", str(output)])
        return output, result

    def test_context_overflow_does_not_silently_truncate(self):
        self.context_size = 4
        output, result = self.run_baseline()
        self.assertEqual(result, 1)
        row = json.loads((output / "responses.jsonl").read_text())
        self.assertEqual(row["status"], "error")
        self.assertIn("context", row["error"])
        self.assertFalse(any(route == "/completion" for route, _ in self.requests))

    def test_partial_response_is_saved_on_stream_failure(self):
        self.final_event = False
        output, result = self.run_baseline()
        self.assertEqual(result, 1)
        row = json.loads((output / "responses.jsonl").read_text())
        self.assertEqual(row["status"], "error")
        self.assertEqual(row["partial_response"], "I cannot help with that.")
