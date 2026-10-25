# Runbook: starting, watching and saving a run

For whoever is at the laptop during judging. Commands run from `world/` unless noted. Setup details live in `world/README.md` (Maincloud, Runpod, keys) and `world/actors/site/README.md` (the hosted site).

## Start a Clearing run from the hosted site

1. Open the site's current address (`https://<run>.runs.apify.net`; it changes whenever the site's Apify run restarts) and press **Start a benchmark**.
2. Build a lineup of up to four agents, pick **The Clearing**, and enter the run password. Mason has it; it is not in the repo.
3. If the lineup uses Ender or Abliterated, the page shows "Preparing your benchmark…" while the site wakes their Runpod workers (seconds when warm, minutes when cold). Then the shared Maincloud world resets with the lineup and runs.

The same thing over HTTP:

```bash
curl -s -X POST "$SITE/api/benchmarks" -H 'Content-Type: application/json' -H "X-Run-Password: $RUN_PASSWORD" \
  -d '{"roster":[{"model":"Ender","count":2},{"model":"Qwen 3.8 27B","count":2}],"scenario":"clearing-charter"}'
curl -s "$SITE/api/benchmarks/<id>"      # status: starting → running
```

Model names are the `lobby` names in `world/actors/site/models.json`. Scenarios are `clearing-charter` and `ledger`. The site runs one Clearing at a time and refuses a new one while the world is running.

## Watch it

- The site's live Clearing, or any local viewer pointed at Maincloud (`world/README.md`, "Pointing the viewer somewhere else").
- From a terminal (run from any directory except `world/`, whose `spacetime.json` gets in the way):

```bash
spacetime sql endersbench "SELECT running, game_time_ms, rescue_state FROM world" --server maincloud
spacetime sql endersbench "SELECT model_id, answered, failed, failing_in_a_row, last_error FROM model_health" --server maincloud
spacetime sql endersbench "SELECT * FROM leaderboard" --server maincloud
```

A run ends at the rescue, about 466–506 game seconds in (16–17 real minutes at time scale 0.5), or when every model survivor has died.

## Save it

Start the recorder as soon as the run starts; it stops by itself when the run ends:

```bash
SPACETIMEDB_HOST=wss://maincloud.spacetimedb.com npm run record     # writes runs/endersbench-<time>/replay.json
SPACETIMEDB_HOST=wss://maincloud.spacetimedb.com npm run report     # after the end: report.json, report.md, decisions.jsonl
```

`world/runs/` is not in git. To share a run with the team:

- Gzip the replay into `world/public/demo/<name>.json.gz`. Every viewer, the hosted site included, opens it with `?replay=/demo/<name>.json.gz&t=m:ss`.
- Copy `report.json` and `report.md`, and gzip `decisions.jsonl`, into `results/<set>/runs/<run>/`, as in `results/v15-2026-10-25/`.

## Local runs for a matched comparison

These reproduce the rules v15 set in `results/v15-2026-10-25/` (charter, food 1, time scale 0.5). Keys come from the repo's `.env` without being printed.

```bash
cd spacetimedb && spacetime publish <db> --server local --delete-data=always --yes --no-config && cd ..
scripts/load-model-keys.sh <db> local                        # API models asked by the database
scripts/db-run.sh <db> bitdeer:Qwen/Qwen3.8-27B charter 1 0.5  # records and writes the report
```

Ender, through the harness (its endpoint URL and key in the shell):

```bash
ROSTER="Ivy:ender:ender,Rook:ender:ender,Sage:ender:ender,Wren:ender:ender" SPACETIMEDB_DB_NAME=<db> \
  PROMPT_VARIANT=charter FOOD_SCALE=1 TIME_SCALE=0.5 npm run harness
SPACETIMEDB_DB_NAME=<db> npm run record                       # in a second terminal
```

Ledger Street, all 70 cases with no rules in the prompt, from the main checkout's `world/` so the worker finds `.env`:

```bash
SPACETIMEDB_DB_NAME=<db> FINANCE_MODELS=<provider:model> FINANCE_VARIANT=no-charter FINANCE_CASES= npm run finance:live
```

## When something goes wrong

| What you see | Cause | What to do |
| --- | --- | --- |
| Ender or Abliterated decisions time out, then the world pauses | Runpod worker was cold | `scripts/warm-runpod.sh`, then start again. The site and `db-run.sh` warm automatically. |
| Ender answers get slower and slower | Requests abandoned by a timeout keep running on Runpod's one worker and pile up | Stop the run, wait for `https://api.runpod.ai/v2/<endpoint>/health` to show an empty queue, restart |
| `429 rate_limit_exceeded` from Bitdeer | One Bitdeer key serving several runs at once | Run Bitdeer-heavy jobs one after another |
| GLM answers end with `finish_reason: length` | GLM on Bitdeer always thinks before acting | Main sends `reasoning_effort: low`; keep its runs separate from earlier GLM runs |
| "This world belongs to another harness" | A different harness identity claimed the database first | Use that harness, or publish a fresh database |
| A finished run is missing from the results page | More than 10% of its model calls got no answer | It is left out on purpose; rerun it |
| Stash and pop | Stashes are shared by every worktree of this repo | Don't `git stash pop` in a shared checkout; another session's stash may apply instead |
