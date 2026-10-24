#!/usr/bin/env python3
"""Show Spark setup progress; exit with a READY message when baseline prerequisites pass."""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from baseline import MODEL, REVISION


PACKAGE_CHECK = """
import importlib.util, json
names = ('torch', 'transformers', 'accelerate', 'pyarrow')
print(json.dumps({name: importlib.util.find_spec(name) is not None for name in names}))
"""
RUNTIME_CHECK = """
import json, torch, accelerate, pyarrow
from transformers import AutoConfig, AutoTokenizer, AutoModelForImageTextToText, TextStreamer
assert torch.cuda.is_available(), 'CUDA is unavailable'
assert torch.cuda.is_bf16_supported(), 'BF16 is unavailable'
x = torch.ones((2, 2), device='cuda', dtype=torch.bfloat16)
assert torch.isfinite(x @ x).all().item(), 'BF16 CUDA operation failed'
config = AutoConfig.from_pretrained(MODEL, revision=REVISION, local_files_only=True, trust_remote_code=False)
tokenizer = AutoTokenizer.from_pretrained(MODEL, revision=REVISION, local_files_only=True, trust_remote_code=False)
tokenizer.apply_chat_template([{'role': 'user', 'content': 'Hello'}], tokenize=False,
                             add_generation_prompt=True, enable_thinking=False)
print(json.dumps({'gpu': torch.cuda.get_device_name(0), 'torch': torch.__version__,
                  'cuda': torch.version.cuda, 'model_type': config.model_type}))
"""


def read_tail(path, lines=5):
    if not path.is_file():
        return '(log not available)'
    with path.open('rb') as handle:
        handle.seek(max(0, path.stat().st_size - 8192))
        text = handle.read().decode(errors='replace')
    return '\n'.join(text.replace('\r', '\n').splitlines()[-lines:])


def active_jobs(root):
    jobs = []
    for process in Path('/proc').iterdir():
        if not process.name.isdigit():
            continue
        try:
            args = (process / 'cmdline').read_bytes().decode().strip('\0').split('\0')
            cwd = (process / 'cwd').resolve()
            if cwd != root:
                continue
            if ('pip' in args and 'install' in args) or ('download' in args and any(
                    Path(arg).name == 'hf' for arg in args)):
                jobs.append(f"PID {process.name}: {' '.join(args)}")
        except (OSError, UnicodeError):
            continue
    return jobs


def checkpoint_progress(cache):
    snapshot = cache / 'models--Qwen--Qwen3.8-27B' / 'snapshots' / REVISION
    weights = [snapshot / f'model-{i:05d}-of-00018.safetensors' for i in range(1, 19)]
    completed = [path for path in weights if path.is_file()]
    size = sum(path.stat().st_size for path in completed)
    required = ('config.json', 'tokenizer_config.json', 'tokenizer.json',
                'chat_template.jinja', 'model.safetensors.index.json')
    ready = len(completed) == 18 and size == 55563006776 and all((snapshot / name).is_file() for name in required)
    return {'shards': len(completed), 'bytes': size, 'ready': ready}


def inspect(root, cache):
    python = root / '.venv/bin/python'
    packages, error = {}, None
    if python.is_file():
        check = subprocess.run([str(python), '-c', PACKAGE_CHECK], capture_output=True, text=True, timeout=20)
        if check.returncode == 0:
            packages = json.loads(check.stdout)
        else:
            error = check.stderr.strip()
    else:
        error = f'Missing interpreter: {python}'
    return {'python': python, 'packages': packages, 'error': error,
            'checkpoint': checkpoint_progress(cache), 'jobs': active_jobs(root)}


def display(root, info):
    print(f"Spark baseline setup — {time.strftime('%H:%M:%S')}\nInterpreter: {info['python']}\n")
    if info['error']:
        print(info['error'])
    for name, present in info['packages'].items():
        print(f"  {name:14} {'installed' if present else 'NOT INSTALLED YET'}")
    weights = info['checkpoint']
    print(f"\nCheckpoint: {weights['shards']}/18 complete shards | "
          f"{weights['bytes'] / 1e9:.2f}/55.56 GB committed")
    print('Partial shard transfers are NOT counted, so this number advances one completed shard at a time.')
    print('\nActive setup/download jobs:')
    print('\n'.join('  ' + job for job in info['jobs']) or '  None')
    print('\nLatest installation output:\n' + read_tail(root / 'setup-install.log'))
    print('\nLatest checkpoint output:\n' + read_tail(root / 'model-download.log', 2))
    validation_file = root / 'environment-validation.json'
    if validation_file.is_file():
        validation = json.loads(validation_file.read_text())
        print(f"\nRecorded runtime checks: BF16 CUDA matmul={validation.get('bf16_cuda_matmul', 'not tested')}, "
              f"SDPA backward={validation.get('bf16_sdpa_backward', 'not tested')}, "
              f"baseline imports={validation.get('baseline_imports', 'not tested')}")
        if validation.get('pip_check_exit_code'):
            print('Dependency check warning: ' + validation.get('pip_check_output', '').strip())
            print('NVIDIA wheel platform tag: ' + validation.get('cusparselt_wheel_tag', 'unknown'))
            print('The recorded CUDA checks passed, but full-model inference remains untested.')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--interval', type=float, default=5)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args(argv)
    if not 0 < args.interval < float('inf'):
        parser.error('Interval must be finite and positive')
    root = args.root.resolve()
    hf_home = Path(os.environ.get('HF_HOME', Path(os.environ.get('XDG_CACHE_HOME', Path.home() / '.cache')) / 'huggingface'))
    cache = Path(os.environ.get('HF_HUB_CACHE', hf_home / 'hub'))
    while True:
        info = inspect(root, cache)
        if sys.stdout.isatty():
            print('\033[2J\033[H', end='')
        display(root, info)
        packages_ready = bool(info['packages']) and all(info['packages'].values())
        # Avoid import checks against an environment while pip is still changing it.
        installing = any(' pip install ' in f' {job} ' for job in info['jobs'])
        if packages_ready and info['checkpoint']['ready'] and not installing:
            print('\nChecking actual imports, CUDA BF16, and cached tokenizer/config...', flush=True)
            code = f'MODEL={MODEL!r}\nREVISION={REVISION!r}\n' + RUNTIME_CHECK
            check = subprocess.run([str(info['python']), '-c', code], capture_output=True, text=True, timeout=120)
            if check.returncode == 0:
                print('\a\nREADY — package imports, CUDA BF16, and complete checkpoint cache checks passed.')
                print(check.stdout.strip())
                print('Full-model inference has not yet been tested. Start the baseline with:')
                print(f'cd {root}\n.venv/bin/python -u finetuning/baseline.py')
                return 0
            print('\nBLOCKED — runtime check failed:\n' + check.stderr[-6000:])
            return 1
        print('\nNOT READY — do not start the baseline yet.', flush=True)
        if not info['jobs']:
            print('No setup/download job is active. An incomplete setup needs attention; inspect the logs.', flush=True)
        if args.once:
            return 1
        print(f'Refreshing every {args.interval:g}s. This monitor exits with READY and rings the terminal bell when checks pass.', flush=True)
        time.sleep(args.interval)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print('\nMonitor stopped. Installation and download jobs continue.')
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        raise SystemExit(f'Status check failed: {exc}') from exc
