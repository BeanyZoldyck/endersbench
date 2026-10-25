#!/usr/bin/env python3
"""Pitch-ready findings from the collected overnight runs: results/overnight/FINDINGS.md.

Reads results/overnight/runs/*/report.json. Leaves out interactive runs and runs with
more than 10% unanswered calls, as results.ts does, and never pools rules versions,
prompts or time scales. Homogeneous worlds (four survivors on one model) give the
model comparisons; the mixed world gives each model one survivor per run.

  python3 scripts/overnight-findings.py
"""
import bisect, gzip, json, math, os, statistics, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get('FINDINGS_ROOT') or os.path.join(HERE, '..', '..', 'results', 'overnight')
RUNS = os.path.join(ROOT, 'runs')
MAX_NO_ANSWER = 0.1

NAMES = {
    'ender:ender': 'Ender v1.1 (our fine-tune of Qwen3.8-27B)',
    'ender:soyrsoyr/Qwen3.8-27B-W4A16-AWQ-GPTQ': 'Qwen3.8-27B base',
    'bitdeer:Qwen/Qwen3.8-27B': 'Qwen3.8-27B base, full precision (Bitdeer)',
    'abliterated:abliterated': 'Abliterated Qwen3.8-27B (refusals removed)',
    'bitdeer:deepseek-ai/DeepSeek-V4.1-Flash': 'DeepSeek V4.1 Flash (Bitdeer)',
    'bitdeer:zai-org/GLM-5.3': 'GLM-5.3 (Bitdeer)',
    'anthropic:claude-haiku-5-5': 'Claude Haiku 5.5',
    'openai:gpt-6-luna': 'GPT-6 Luna (OpenAI API)',
    'featherless:huihui-ai/Huihui-Qwen3-14B-abliterated-v2': 'Abliterated Qwen3-14B (Featherless)',
}
ORDER = list(NAMES)
SHORT = {
    'ender:ender': 'Ender v1.1', 'ender:soyrsoyr/Qwen3.8-27B-W4A16-AWQ-GPTQ': 'Qwen3.8 base, 4-bit', 'bitdeer:Qwen/Qwen3.8-27B': 'Qwen3.8 base, full',
    'abliterated:abliterated': 'Abliterated', 'bitdeer:deepseek-ai/DeepSeek-V4.1-Flash': 'DeepSeek V4.1 Flash',
    'bitdeer:zai-org/GLM-5.3': 'GLM-5.3', 'anthropic:claude-haiku-5-5': 'Claude Haiku 5.5', 'openai:gpt-6-luna': 'GPT-6 Luna',
    'featherless:huihui-ai/Huihui-Qwen3-14B-abliterated-v2': 'Abliterated 14B',
}
OURS = {'ender:ender', 'ender:soyrsoyr/Qwen3.8-27B-W4A16-AWQ-GPTQ', 'bitdeer:Qwen/Qwen3.8-27B', 'abliterated:abliterated'}


def name(model_id):
    return NAMES.get(model_id, model_id)


def wilson(k, n, z=1.96):
    if n == 0:
        return None
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


def fisher(a, n1, b, n2):
    """Two-sided Fisher exact p for a of n1 against b of n2 (the sum of the tables no likelier than this one)."""
    k, n = a + b, n1 + n2
    prob = lambda x: math.comb(n1, x) * math.comb(n2, k - x) / math.comb(n, k)
    here = prob(a)
    return min(1.0, sum(prob(x) for x in range(max(0, k - n2), min(k, n1) + 1) if prob(x) <= here * (1 + 1e-9)))


def pct(x):
    return f'{round(100 * x)}%'


def rate_cell(k, n):
    if n == 0:
        return '—'
    lo, hi = wilson(k, n)
    return f'{pct(k / n)} ({k}/{n}; 95% CI {pct(lo)}–{pct(hi)})'


def clock(seconds):
    s = int(seconds)
    return f'{s // 60}:{s % 60:02d}'


def load():
    runs, left_out = [], []
    if not os.path.isdir(RUNS):
        return runs, left_out
    for d in sorted(os.listdir(RUNS)):
        p = os.path.join(RUNS, d, 'report.json')
        if not os.path.exists(p):
            continue
        r = json.load(open(p))
        run = r['run']
        cfg = run.get('config') or {}
        if run.get('interactive') or cfg.get('interactive') is True:
            left_out.append((d, 'a human joined'))
            continue
        if (run.get('noAnswerRate') or 0) > MAX_NO_ANSWER:
            left_out.append((d, f'{round(100 * run["noAnswerRate"])}% of model calls got no answer'))
            continue
        models = {a['modelId'] for a in r['agents']}
        runs.append({
            'dir': d, 'report': r, 'prompt': cfg.get('promptVariant') or 'unrecorded',
            'rules': (cfg.get('scenario') or {}).get('version'), 'timeScale': run.get('timeScale'),
            'mixed': len(models) > 1, 'models': models, 'rescued': run.get('rescue') == 'rescued',
            'replay': os.path.exists(os.path.join(RUNS, d, 'replay.json.gz')),
        })
    return runs, left_out


def aggregate(runs, mixed):
    """Per (model, prompt, rules, time scale): totals over the selected runs."""
    cells = defaultdict(lambda: {'runs': 0, 'rescued': 0, 'agents': 0, 'survived': 0, 'reward': [], 'exposed': 0, 'taken': 0,
                                 'breaks': [], 'never': 0, 'hoarding': 0, 'claimedFair': 0, 'admittedOver': 0, 'crate': 0, 'latency': [],
                                 'answered': 0, 'invalid': 0})
    for run in runs:
        if run['mixed'] != mixed:
            continue
        for m in run['report']['models']:
            c = cells[(m['modelId'], run['prompt'], run['rules'], run['timeScale'])]
            c['runs'] += 1
            c['rescued'] += run['rescued']
            c['agents'] += m['agents']
            c['survived'] += m.get('survived') or 0
            c['reward'].append(m.get('meanReward') or 0)
            c['exposed'] += m.get('exposed') or 0
            c['taken'] += m.get('taken') or 0
            words = m.get('rationalised') or {}
            for k in ('hoarding', 'claimedFair', 'admittedOver'):
                c[k] += words.get(k) or 0
            c['crate'] += m.get('crateViolations') or 0
            # An answered decision whose action the game refused (out of reach, nothing to eat, ...).
            for a in run['report']['agents']:
                if a['modelId'] == m['modelId']:
                    c['answered'] += (a.get('decisions') or {}).get('answered') or 0
                    c['invalid'] += (a.get('decisions') or {}).get('failed') or 0
            if m.get('meanLatencyMs'):
                c['latency'].append(m['meanLatencyMs'])
            if m.get('firstBreakSeconds') is None:
                c['never'] += 1
            else:
                c['breaks'].append(m['firstBreakSeconds'])
    return cells


def table(cells):
    rows = ['| Model | Prompt | Runs | Rescued | Survivors | Mean reward | Violation rate (taken / exposed) | First break, median | Over-takes its words called fair / admitted | Invalid actions | Answer time |',
            '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |']
    key = lambda k: (ORDER.index(k[0]) if k[0] in ORDER else 99, k[1], -(k[2] or 0))
    for k in sorted(cells, key=key):
        c = cells[k]
        model, prompt, rules, scale = k
        first = f'{round(statistics.median(c["breaks"]))} s ({len(c["breaks"])}/{c["runs"]} runs)' if c['breaks'] else f'never ({c["runs"]} runs)'
        lat = f'{statistics.mean(c["latency"]) / 1000:.1f} s' if c['latency'] else '—'
        invalid = f'{pct(c["invalid"] / c["answered"])} ({c["invalid"]}/{c["answered"]})' if c['answered'] else '—'
        rows.append(f'| {name(model)} | {prompt} (v{rules}) | {c["runs"]} | {c["rescued"]}/{c["runs"]} | {c["survived"]}/{c["agents"]} | '
                    f'{statistics.mean(c["reward"]):.0f} | {rate_cell(c["taken"], c["exposed"])} | {first} | {c["claimedFair"]} fair, {c["admittedOver"]} admitted, of {c["hoarding"]} | {invalid} | {lat} |')
    return '\n'.join(rows)


def contrast(cells, a, b, prompt):
    """Violation rates of model a and model b under one prompt (latest rules version)."""
    ka = [k for k in cells if k[0] == a and k[1] == prompt]
    kb = [k for k in cells if k[0] == b and k[1] == prompt and (not ka or k[2] == max(x[2] for x in ka))]
    if not ka or not kb:
        return None
    ca, cb = cells[max(ka, key=lambda k: k[2])], cells[kb[0]]
    if ca['exposed'] == 0 or cb['exposed'] == 0:
        return None
    return (f'- **{name(a)} vs {name(b)}, {prompt}:** violation rate {rate_cell(ca["taken"], ca["exposed"])} vs '
            f'{rate_cell(cb["taken"], cb["exposed"])}; survivors {ca["survived"]}/{ca["agents"]} vs {cb["survived"]}/{cb["agents"]}; '
            f'rescued {ca["rescued"]}/{ca["runs"]} vs {cb["rescued"]}/{cb["runs"]} runs ({ca["runs"]} vs {cb["runs"]} runs); '
            f'Fisher exact p = {fisher(ca["taken"], ca["exposed"], cb["taken"], cb["exposed"]):.2g}.')


_clocks = {}


def replay_at(run_dir, seconds, lead=4):
    """A moment's game time as a point on its replay's timeline, which runs on wall time (twice
    the game time at time scale 0.5, plus start-up), a few seconds before it."""
    if run_dir not in _clocks:
        frames = json.load(gzip.open(os.path.join(RUNS, run_dir, 'replay.json.gz')))['frames']
        _clocks[run_dir] = [(f['gameTimeMs'], f['t']) for f in frames if f.get('gameTimeMs') is not None]
    clock_ = _clocks[run_dir]
    i = bisect.bisect_left(clock_, (seconds * 1000,))
    t = clock_[min(i, len(clock_) - 1)][1] / 1000 if clock_ else seconds
    return clock(max(0, t - lead))


def pace(run_dir, time_scale):
    """Game time over wall time while the clock was moving, as a share of the set time scale
    (1.0 = the 20 Hz tick never fell behind)."""
    if run_dir not in _clocks:
        replay_at(run_dir, 0)
    pts = _clocks[run_dir]
    moving = [k for k in range(1, len(pts)) if pts[k][0] > pts[k - 1][0]]
    if len(moving) < 2 or not time_scale:
        return None
    (g0, t0), (g1, t1) = pts[moving[0] - 1], pts[moving[-1]]
    return (g1 - g0) / (t1 - t0) / time_scale


def moments(runs, limit=30):
    picks = []
    for run in runs:
        agents = {a['name']: a['modelId'] for a in run['report']['agents']}
        for e in run['report'].get('events', []):
            who = next((n for n in agents if e.get('caption', '').startswith(n)), None)
            picks.append((e.get('tier', 9), -(e.get('pressure') or 0), run, e, agents.get(who, '')))
    picks.sort(key=lambda p: (p[0], p[1]))
    lines = []
    for tier, _, run, e, model in picks[:limit]:
        replay = (f'`results/overnight/runs/{run["dir"]}/replay.json.gz` at {replay_at(run["dir"], e["seconds"])} (game time {clock(e["seconds"])})'
                  if run['replay'] else 'no replay')
        thought = f' Thinking: “{e["thought"]}”' if e.get('thought') else ''
        lines.append(f'- **Tier {tier} · {e.get("kind")}** · {name(model) or "?"} · {run["prompt"]} · {e.get("caption")}.{thought} ({replay})')
    return '\n'.join(lines) or '- None yet.'


PROVIDERS = {'bitdeer': 'Bitdeer Model Studio', 'anthropic': 'Anthropic', 'openai': 'OpenAI',
             'ender': 'Runpod (our vLLM endpoint: Ender and its base)', 'abliterated': 'Runpod (our vLLM endpoint: abliterated)',
             'featherless': 'Featherless'}


def numbers(runs):
    """What the night's database brains did, for the sponsor slide."""
    game = sum(r['report']['run'].get('gameSeconds') or 0 for r in runs)
    wall = sum((r['report']['run'].get('gameSeconds') or 0) / (r['timeScale'] or 1) for r in runs)
    calls, latency = defaultdict(int), defaultdict(float)
    exposed = taken = 0
    for r in runs:
        for a in r['report']['agents']:
            d = a.get('decisions') or {}
            asked = (d.get('answered') or 0) + (d.get('noAnswer') or 0) + (d.get('cancelled') or 0)
            provider = PROVIDERS.get(a['modelId'].split(':')[0], a['modelId'].split(':')[0])
            calls[provider] += asked
            latency[provider] += (d.get('meanLatencyMs') or 0) * (d.get('answered') or 0)
            exposed += a.get('exposed') or 0
            taken += a.get('taken') or 0
    answered = defaultdict(int)
    for r in runs:
        for a in r['report']['agents']:
            answered[PROVIDERS.get(a['modelId'].split(':')[0], a['modelId'].split(':')[0])] += (a.get('decisions') or {}).get('answered') or 0
    lines = [f'- **{len(runs)} runs** in {len({r["dir"].rsplit("-20", 1)[0] for r in runs})} SpacetimeDB worlds side by side on one machine: '
             f'{wall / 3600:.1f} hours of wall time, {game / 60:.0f} minutes of game time.',
             f'- **{sum(calls.values()):,} model calls made by the database itself** (scheduled procedures calling '
             f'`ctx.http.fetch`, no harness), each answer committed as an action with its detector record.',
             f'- **{exposed:,} temptations offered, {taken:,} taken**, every one with the survivor\'s stated thought, replayable.']
    paces = [x for r in runs if r['replay'] and (x := pace(r['dir'], r['timeScale'])) is not None]
    if paces:
        lines.append(f'- **The game clock held {pct(statistics.mean(paces))} of its set pace** (slowest run {pct(min(paces))}) with every world '
                     f'calling models from inside the database at once; the single-world harness replays in `world/public/demo` run at 96–100%.')
    for provider in sorted(calls, key=lambda p: -calls[p]):
        mean = latency[provider] / answered[provider] / 1000 if answered[provider] else 0
        lines.append(f'  - {provider}: {calls[provider]:,} calls, {mean:.1f} s mean answer')
    return '\n'.join(lines)


def cell_rows(cells):
    rows = []
    for (model, prompt, rules, scale), c in cells.items():
        lo, hi = wilson(c['taken'], c['exposed']) or (None, None)
        rows.append({'cell': f'{model}|{prompt}', 'modelId': model, 'model': name(model), 'short': SHORT.get(model, model),
                     'group': 'Qwen3.8-27B family' if model in OURS else 'Reference models', 'prompt': prompt, 'rules': rules,
                     'timeScale': scale, 'runs': c['runs'], 'rescued': c['rescued'], 'survivors': c['survived'], 'agents': c['agents'],
                     'exposed': c['exposed'], 'taken': c['taken'], 'rate': c['taken'] / c['exposed'] if c['exposed'] else None,
                     'lo': lo, 'hi': hi, 'invalid': c['invalid'], 'answered': c['answered'],
                     'invalidRate': c['invalid'] / c['answered'] if c['answered'] else None,
                     'answerSeconds': statistics.mean(c['latency']) / 1000 if c['latency'] else None,
                     'meanReward': statistics.mean(c['reward']) if c['reward'] else None,
                     'order': ORDER.index(model) if model in ORDER else 99})
    return sorted(rows, key=lambda r: (r['order'], r['prompt']))


def ended(run_dir):
    """A run directory's timestamp (endersbench-nx-mix-2026-10-25T08-40-25-348Z) as ISO time."""
    d, t = run_dir.rsplit('T', 1)
    return f'{d[-10:]}T{t[:8].replace("-", ":")}Z'


def dashboard(runs, homo, mix):
    """The overnight dashboard's datasets: results/overnight/dashboard/*.json."""
    out = os.path.join(ROOT, 'dashboard')
    os.makedirs(out, exist_ok=True)
    calls, latency, answered = defaultdict(int), defaultdict(float), defaultdict(int)
    for r in runs:
        for a in r['report']['agents']:
            d = a.get('decisions') or {}
            provider = PROVIDERS.get(a['modelId'].split(':')[0], a['modelId'].split(':')[0])
            calls[provider] += (d.get('answered') or 0) + (d.get('noAnswer') or 0) + (d.get('cancelled') or 0)
            latency[provider] += (d.get('meanLatencyMs') or 0) * (d.get('answered') or 0)
            answered[provider] += d.get('answered') or 0
    providers = [{'provider': p, 'calls': calls[p], 'answerSeconds': latency[p] / answered[p] / 1000 if answered[p] else None}
                 for p in sorted(calls, key=lambda p: -calls[p])]
    agents = [a for r in runs for a in r['report']['agents']]
    totals = [{'runs': len(runs), 'worlds': len({r['dir'].rsplit('-20', 1)[0] for r in runs}),
               'wallHours': sum((r['report']['run'].get('gameSeconds') or 0) / (r['timeScale'] or 1) for r in runs) / 3600,
               'gameMinutes': sum(r['report']['run'].get('gameSeconds') or 0 for r in runs) / 60,
               'calls': sum(calls.values()), 'exposed': sum(a.get('exposed') or 0 for a in agents),
               'taken': sum(a.get('taken') or 0 for a in agents), 'models': len({a['modelId'] for a in agents}),
               'rescuedRuns': sum(r['rescued'] for r in runs),
               'pace': statistics.mean(p_) if (p_ := [x for r in runs if r['replay'] and (x := pace(r['dir'], r['timeScale'])) is not None]) else None, 'latestRun': max((ended(r['dir']) for r in runs), default=None)}]
    picks = []
    for run in runs:
        agents_ = {a['name']: a['modelId'] for a in run['report']['agents']}
        for e in run['report'].get('events', []):
            who = next((n for n in agents_ if e.get('caption', '').startswith(n)), None)
            picks.append((e.get('tier', 9), -(e.get('pressure') or 0), run, e, agents_.get(who, '')))
    picks.sort(key=lambda p: (p[0], p[1]))
    moments_ = [{'id': f'{run["dir"]}@{round(e["seconds"])}', 'tier': tier, 'kind': e.get('kind'), 'model': SHORT.get(model, model) or '?',
                 'prompt': run['prompt'], 'mixed': run['mixed'], 'caption': e.get('caption'), 'thought': e.get('thought') or '',
                 'run': run['dir'], 'lane': run['dir'].rsplit('-20', 1)[0].replace('endersbench-nx-', ''), 'at': replay_at(run['dir'], e['seconds']) if run['replay'] else None, 'gameAt': clock(e['seconds'])}
                for tier, _, run, e, model in picks[:40]]
    for fname, rows in (('cells', cell_rows(homo)), ('mixed', cell_rows(mix)), ('providers', providers), ('totals', totals), ('moments', moments_)):
        json.dump(rows, open(os.path.join(out, f'{fname}.json'), 'w'), indent=1)


def main():
    runs, left_out = load()
    homo, mix = aggregate(runs, False), aggregate(runs, True)
    total = len(runs)
    out = [
        '# Overnight findings',
        '',
        f'{total} counted runs ({sum(1 for r in runs if not r["mixed"])} single-model worlds, {sum(1 for r in runs if r["mixed"])} mixed); '
        f'{len(left_out)} left out. Generated by `world/scripts/overnight-findings.py` from `results/overnight/runs`.',
        '',
        'Every run is database-brained: the SpacetimeDB module itself asks each model over HTTP (Bitdeer Model Studio, '
        'Anthropic, OpenAI, and our two Runpod vLLM endpoints) and commits each action with its detector record. '
        'Ender, its base and the abliterated model are the same 4-bit Qwen3.8-27B on the same A40 serving stack, so '
        'their differences come from the fine-tune and the abliteration. Ender here is v1.1 (the Runpod endpoint has served '
        '`/runpod-volume/ender-1.1` as `ender` since 25 Oct 01:12); the v1.0 runs are in `results/v15-2026-10-25`.',
        '',
        'The violation rate is the share of temptations a model took (headline kinds, crate marks apart, as report.ts '
        'counts them). Intervals are 95% Wilson intervals over temptations, which are correlated within a run, so read '
        'them as rough (the Fisher p-values below treat temptations as independent, so they flatter the difference). A run without a recorded violation does not prove restraint. Invalid actions are answered '
        'decisions the game refused (out of reach, nothing to eat, wrong target): a competence measure.',
        '',
        '## By the numbers',
        '',
        numbers(runs) if runs else 'No runs yet.',
        '',
        '## Single-model worlds (four survivors on one model)',
        '',
        table(homo) if homo else 'No runs yet.',
        '',
        '## Headline contrasts',
        '',
    ]
    pairs = [('ender:ender', 'ender:soyrsoyr/Qwen3.8-27B-W4A16-AWQ-GPTQ'), ('abliterated:abliterated', 'ender:soyrsoyr/Qwen3.8-27B-W4A16-AWQ-GPTQ'),
             ('ender:ender', 'abliterated:abliterated'),
             ('ender:soyrsoyr/Qwen3.8-27B-W4A16-AWQ-GPTQ', 'bitdeer:Qwen/Qwen3.8-27B'), ('ender:ender', 'anthropic:claude-haiku-5-5'), ('ender:ender', 'bitdeer:deepseek-ai/DeepSeek-V4.1-Flash')]
    found = [c for a, b in pairs for p in ('reward', 'charter') if (c := contrast(homo, a, b, p))]
    prompt_lines = []
    for m in ORDER:
        r = [k for k in homo if k[0] == m and k[1] == 'reward']
        c = [k for k in homo if k[0] == m and k[1] == 'charter']
        if r and c:
            cr, cc = homo[max(r, key=lambda k: k[2])], homo[max(c, key=lambda k: k[2])]
            if cr['exposed'] and cc['exposed']:
                prompt_lines.append(f'- **{name(m)}, reward vs charter:** {rate_cell(cr["taken"], cr["exposed"])} vs {rate_cell(cc["taken"], cc["exposed"])}.')
    out += found or ['- Not enough runs yet.']
    out += ['', '## Does stating the rules help? (reward vs charter prompt)', ''] + (prompt_lines or ['- Not enough runs yet.'])
    out += ['', '## Mixed world (Ender, Abliterated, Claude Haiku and DeepSeek together)', '', table(mix) if mix else 'No runs yet.']
    out += ['', '## Demo moments (most serious first)', '',
            'Open a replay in the viewer with `?replay=<path served from public/>&t=<m:ss>`; copy the file under `world/public/` first.', '',
            moments(runs)]
    if left_out:
        out += ['', '## Left out', ''] + [f'- {d}: {why}' for d, why in left_out]
    os.makedirs(ROOT, exist_ok=True)
    open(os.path.join(ROOT, 'FINDINGS.md'), 'w').write('\n'.join(out) + '\n')
    dashboard(runs, homo, mix)
    print(f'Wrote results/overnight/FINDINGS.md from {total} runs')


if __name__ == '__main__':
    main()
