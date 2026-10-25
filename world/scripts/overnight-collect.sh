#!/usr/bin/env bash
# Collects finished overnight runs into results/overnight (report, the decisions and the
# replay, both gzipped), rebuilds RESULTS.md and results.html from every collected run,
# and, with --push, commits and pushes the current branch.
#
#   scripts/overnight-collect.sh [--push] [world-name-prefix, default endersbench-nx-]
set -u
PUSH=''
[ "${1:-}" = --push ] && { PUSH=1; shift; }
PREFIX=${1:-endersbench-nx-}
W=$(cd "$(dirname "$0")/.." && pwd)
R=$W/../results/overnight
mkdir -p "$R/runs"

# A report directory is written when a run ends; its recording directory (replay.json)
# was created when that run started: the latest one of the same world before the report.
python3 -I - "$W/runs" "$R/runs" "$PREFIX" <<'PY'
import gzip, os, re, shutil, sys
runs, out, prefix = sys.argv[1:]
stamp = re.compile(r'^(?P<db>.+)-(?P<ts>\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d+Z)$')
dirs = [(m['db'], m['ts'], d) for d in sorted(os.listdir(runs)) if d.startswith(prefix) and (m := stamp.match(d))]
added = 0
for db, ts, d in dirs:
    src = os.path.join(runs, d)
    if not os.path.exists(os.path.join(src, 'report.json')):
        continue
    dst = os.path.join(out, d)
    if os.path.exists(os.path.join(dst, 'report.json')):
        continue
    os.makedirs(dst, exist_ok=True)
    for f in ('report.json', 'report.md'):
        if os.path.exists(os.path.join(src, f)):
            shutil.copy(os.path.join(src, f), dst)
    if os.path.exists(os.path.join(src, 'decisions.jsonl')):
        with open(os.path.join(src, 'decisions.jsonl'), 'rb') as i, gzip.open(os.path.join(dst, 'decisions.jsonl.gz'), 'wb') as o:
            shutil.copyfileobj(i, o)
    recordings = [(t, x) for b, t, x in dirs if b == db and t < ts and os.path.exists(os.path.join(runs, x, 'replay.json'))]
    if recordings:
        with open(os.path.join(runs, recordings[-1][1], 'replay.json'), 'rb') as i, gzip.open(os.path.join(dst, 'replay.json.gz'), 'wb') as o:
            shutil.copyfileobj(i, o)
    added += 1
print(f'collected {added} new run(s); {len([x for x in os.listdir(out) if os.path.exists(os.path.join(out, x, "report.json"))])} in results/overnight/runs')
PY

cd "$W" && RESULTS_RUNS_DIR="$R/runs" RESULTS_OUT_DIR="$R" npm run --silent results 2>&1 | tail -1
python3 -I "$W/scripts/overnight-findings.py"

if [ -n "$PUSH" ]; then
  cd "$W/.." || exit 1
  git add results/overnight
  if git diff --cached --quiet; then echo 'nothing new to commit'; exit 0; fi
  n=$(ls results/overnight/runs | wc -l)
  git commit -q -m "Overnight data: $n runs collected" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  timeout 300 git push -q origin "$(git branch --show-current)" 2>&1 | tail -2
  echo "pushed $(git rev-parse --short HEAD)"
fi
