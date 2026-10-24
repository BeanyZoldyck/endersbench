#!/usr/bin/env python3
"""SIGSTOP an active runner after generation closes its stream, with no HTTP fd.

Uses Linux inotify, not request cancellation. SIGCONT resumes its exact state.
"""

import argparse
import ctypes
import json
import os
import select
import signal
import time
from pathlib import Path


def socket_fds(pid):
    sockets = []
    for path in (Path("/proc") / str(pid) / "fd").iterdir():
        try:
            target = os.readlink(path)
            if target.startswith("socket:"):
                sockets.append(target)
        except FileNotFoundError:
            pass
    return sockets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--timeout", type=float, default=600)
    args = parser.parse_args()
    libc = ctypes.CDLL(None, use_errno=True)
    fd = libc.inotify_init1(os.O_NONBLOCK | os.O_CLOEXEC)
    if fd < 0 or libc.inotify_add_watch(fd, os.fsencode(args.run_dir), 0x80) < 0:
        raise OSError(ctypes.get_errno(), "Cannot watch run directory")
    deadline = time.monotonic() + args.timeout
    print(f"Waiting for a closed-stream boundary in runner {args.pid}...", flush=True)
    try:
        while time.monotonic() < deadline:
            ready, _, _ = select.select([fd], [], [], max(0, deadline - time.monotonic()))
            if not ready:
                break
            os.read(fd, 65536)
            progress = json.loads((args.run_dir / "progress.json").read_text())
            if progress.get("status") not in ("generation_finished", "between_episodes"):
                continue
            os.kill(args.pid, signal.SIGSTOP)
            # Let the kernel complete the group stop before inspecting descriptors.
            for _ in range(100):
                state = (Path("/proc") / str(args.pid) / "status").read_text()
                if "State:\tT" in state:
                    break
                time.sleep(.001)
            if not socket_fds(args.pid):
                print(json.dumps({"paused_pid": args.pid, "progress": progress,
                                  "open_http_sockets": 0}, indent=2), flush=True)
                return
            # A new request won the race. Do not leave it frozen mid-response.
            os.kill(args.pid, signal.SIGCONT)
        raise TimeoutError("No safe pause boundary observed; runner was not left paused")
    finally:
        os.close(fd)


if __name__ == "__main__":
    main()
