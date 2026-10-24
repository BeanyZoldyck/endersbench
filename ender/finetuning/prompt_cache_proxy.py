#!/usr/bin/env python3
"""Loopback-only cache bridge for an already-running structured-JSON agent.

The live Python runner keeps its memory and old endpoint. Only native structured
completion requests gain cache_prompt=true; prompts and sampling stay unchanged.
"""

import argparse
import json
import os
import threading
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from llamacpp_backend import LlamaClient


def cache_payload(route, payload):
    if route == "/completion" and isinstance(payload, dict) and payload.get("json_schema"):
        return {**payload, "cache_prompt": True}, True
    return payload, False


def handler_for(upstream, audit_file):
    LlamaClient(upstream)  # Apply the same loopback/no-credentials validation.
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def log_message(self, *args):
            pass

        def forward(self):
            if self.path not in ("/health", "/props", "/slots", "/metrics", "/lora-adapters",
                                  "/apply-template", "/tokenize", "/completion"):
                self.send_error(404)
                return
            try:
                data = None
                if self.command == "POST":
                    size = int(self.headers.get("Content-Length", 0))
                    if not 0 < size <= 16 * 1024 * 1024:
                        self.send_error(413)
                        return
                    payload = json.loads(self.rfile.read(size))
                    payload, cached = cache_payload(self.path, payload)
                    if self.path == "/completion":
                        record = {"at": datetime.now(timezone.utc).isoformat(), "cache_enabled": cached,
                                  "prompt_tokens": len(payload.get("prompt", [])),
                                  "max_new_tokens": payload.get("n_predict")}
                        with lock, audit_file.open("a") as handle:
                            handle.write(json.dumps(record) + "\n")
                    data = json.dumps(payload).encode()
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                request = urllib.request.Request(upstream + self.path, data=data, method=self.command,
                                                 headers={"Content-Type": "application/json"})
                with opener.open(request, timeout=600) as response:
                    self.send_response(response.status)
                    self.send_header("Content-Type", response.headers.get("Content-Type", "application/json"))
                    self.send_header("Connection", "close")
                    self.end_headers()
                    while chunk := response.read1(65536):
                        self.wfile.write(chunk)
                        self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                # Closing the upstream stream propagates the agent's JSON-boundary
                # cancellation instead of leaving extra generation running.
                return
            except urllib.error.HTTPError as exc:
                self.send_error(exc.code, exc.read(2048).decode(errors="replace"))
            except (ValueError, OSError) as exc:
                self.send_error(502, str(exc))
            finally:
                self.close_connection = True

        do_GET = forward
        do_POST = forward

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--upstream", default="http://127.0.0.1:8081")
    parser.add_argument("--audit-file", type=Path, required=True)
    parser.add_argument("--pid-file", type=Path, required=True)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(args.upstream, args.audit_file))
    server.daemon_threads = True
    args.pid_file.write_text(str(os.getpid()) + "\n")
    print(f"Cache bridge 127.0.0.1:{args.port} -> {args.upstream}; structured completions only", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
