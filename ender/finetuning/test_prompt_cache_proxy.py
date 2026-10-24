import json
import tempfile
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from prompt_cache_proxy import cache_payload, handler_for


class CacheBridgeTests(unittest.TestCase):
    def test_only_structured_native_completions_change(self):
        original = {"prompt": [1, 2], "cache_prompt": False, "temperature": 0,
                    "json_schema": {"type": "object"}}
        new, changed = cache_payload("/completion", original)
        self.assertTrue(changed)
        self.assertTrue(new["cache_prompt"])
        self.assertFalse(original["cache_prompt"])
        self.assertEqual(new["prompt"], original["prompt"])
        self.assertEqual(new["temperature"], original["temperature"])
        self.assertEqual(cache_payload("/tokenize", original), (original, False))
        ordinary = {"prompt": [1, 2], "cache_prompt": False}
        self.assertEqual(cache_payload("/completion", ordinary), (ordinary, False))

    def test_forwarded_stream_and_health(self):
        received = []

        class Upstream(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"status":"ok"}')

            def do_POST(self):
                received.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                self.wfile.write(b'data: {"content":"ok","stop":true}\n\n')

        upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        threading.Thread(target=upstream.serve_forever, daemon=True).start()
        with tempfile.TemporaryDirectory() as tmp:
            bridge = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(
                f"http://127.0.0.1:{upstream.server_port}", Path(tmp) / "audit.jsonl"))
            threading.Thread(target=bridge.serve_forever, daemon=True).start()
            try:
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                with opener.open(f"http://127.0.0.1:{bridge.server_port}/health") as response:
                    self.assertEqual(json.load(response), {"status": "ok"})
                payload = {"prompt": [1, 2], "cache_prompt": False, "json_schema": {"type": "object"}}
                request = urllib.request.Request(f"http://127.0.0.1:{bridge.server_port}/completion",
                                                 data=json.dumps(payload).encode())
                with opener.open(request) as response:
                    self.assertIn(b'"content":"ok"', response.read())
                self.assertTrue(received[0]["cache_prompt"])
                self.assertEqual(len((Path(tmp) / "audit.jsonl").read_text().splitlines()), 1)
            finally:
                bridge.shutdown()
                bridge.server_close()
                upstream.shutdown()
                upstream.server_close()


if __name__ == "__main__":
    unittest.main()
