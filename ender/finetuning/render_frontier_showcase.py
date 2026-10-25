#!/usr/bin/env python3
"""Leaderboard page combining base, Ender and frontier models on the frozen showcase suite.

Every number is computed from saved raw responses. Frontier models with partial
coverage (API credit exhaustion) are compared to Ender only on the cases they
answered. The earlier frontier report used a different benchmark and is shown in
a separate panel, never merged into this ranking.
"""
import argparse
import html
import json
from pathlib import Path

from decision_score import decision_score, extract_action

ORDER = ["Ender", "Base Qwen3.8-27B", "Claude Haiku 5.5", "Grok 4.7", "GPT-6 Luna", "Claude Opus 5.5", "GPT-6 Astra"]
DOMAINS = (("simulation_alignment", "Simulation alignment"), ("financial_compliance", "Financial compliance"),
           ("reward_hacking", "Reward hacking"))
# Copied verbatim from reports/agentic-frontier-20261024T133000Z/index.html (different benchmark).
EARLIER = [("Qwen3.8-27B (local base)", 12, 32, 6), ("Claude Opus 5.5", 4, 17, 29),
           ("GPT-6 Astra", 3, 41, 6), ("Grok 4.7", 11, 31, 8)]


def load(run, pairs):
    suite = json.loads((run/"suite.json").read_text())
    local = [json.loads(line) for line in (run/"responses.jsonl").read_text().splitlines()]
    frontier = [json.loads(line) for line in (run/"frontier.jsonl").read_text().splitlines()]
    if len(local) != 2*len(suite):
        raise ValueError("Expected one base and one Ender response per case")
    answers = {}
    for index, row in enumerate(suite):
        base, ender = local[2*index:2*index+2]
        if (base["mode"], ender["mode"]) != ("base", "ender") or base["prompt_sha256"] != ender["prompt_sha256"]:
            raise ValueError("Local responses are not matched base/Ender pairs")
        answers["Base Qwen3.8-27B", index] = (base["response"], base["correct"])
        answers["Ender", index] = (ender["response"], ender["correct"])
    for record in frontier:
        if not record["error"]:
            answers[record["label"], record["case_index"]] = (record["response"], record["correct"])
    rejected = {}
    for path in pairs:
        for line in Path(path).read_text().splitlines():
            pair = json.loads(line)
            action = extract_action(pair["rejected"])
            if action:
                rejected.setdefault(pair["scenario_id"], []).append(action)
    results = {}
    for (model, index), (text, strict) in answers.items():
        row = suite[index]
        score = decision_score(row, text)
        violation = None
        if row["task"] == "act" and row["scenario_id"] in rejected:
            violation = extract_action(text) in rejected[row["scenario_id"]]
        results[model, index] = {"text": text, "strict": strict, "violation": violation, **score}
    return suite, results


def stats(suite, results, model, indices=None):
    indices = [i for i in (indices if indices is not None else range(len(suite))) if (model, i) in results]
    rows = [results[model, i] for i in indices]
    acts = [r for r in rows if r["violation"] is not None]
    return {"n": len(rows), "decision": sum(r["decision_correct"] for r in rows),
            "strict": sum(r["strict"] for r in rows), "violations": sum(r["violation"] for r in acts),
            "act_n": len(acts), "indices": indices}


def render(run, pairs):
    suite, results = load(run, pairs)
    total = len(suite)
    css = (":root{color-scheme:dark;--bg:#0b1020;--line:#29364f;--text:#e8eef8;--muted:#9eacc3;--mint:#5de0bf;"
           "--blue:#87a9ff;--amber:#ffd166;--rose:#ff8f91}*{box-sizing:border-box}body{margin:0;background:"
           "radial-gradient(ellipse at 70% -10%,#23385d 0,transparent 44%),var(--bg);color:var(--text);"
           "font:15px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:38px 24px 70px}"
           ".eyebrow{color:var(--mint);font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700}"
           "h1{font-size:clamp(32px,5vw,54px);line-height:1.05;letter-spacing:-.04em;margin:12px 0}h2{margin:38px 0 6px;font-size:22px}"
           ".sub,.muted{color:var(--muted)}.banner{border:1px solid #705a2d;background:#352b183d;color:#ffdf91;padding:15px 18px;"
           "border-radius:12px;margin:22px 0}.panel{background:linear-gradient(145deg,#172238,#111827);border:1px solid var(--line);"
           "border-radius:15px;padding:22px;margin-top:14px}.bar{display:grid;grid-template-columns:200px 1fr 150px;gap:14px;"
           "align-items:center;margin:13px 0}.name{font-weight:650}.name small{display:block;color:var(--muted);font-weight:400;font-size:12px}"
           ".track{height:26px;background:#1d2840;border-radius:7px;overflow:hidden;position:relative}.fill{height:100%;border-radius:7px;"
           "background:#56627c}.fill.ender{background:linear-gradient(90deg,#5d7cff,var(--mint))}.fill.partial{background:repeating-linear-gradient("
           "45deg,#56627c 0 8px,#46516a 8px 16px)}.val{font-variant-numeric:tabular-nums;text-align:right;font-weight:650}.val small{display:block;"
           "color:var(--muted);font-weight:400;font-size:12px}table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;"
           "padding:11px 10px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-size:12px;text-transform:uppercase}"
           ".zero{color:var(--mint);font-weight:700}.hit{color:var(--rose)}.tag{display:inline-block;border:1px solid var(--line);"
           "border-radius:99px;padding:2px 9px;font-size:12px;color:var(--muted)}details{border-top:1px solid var(--line);padding:10px 0}"
           "summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0b1120;border:1px solid var(--line);"
           "padding:11px;border-radius:9px;font:12px/1.5 ui-monospace,monospace;max-height:280px;overflow:auto}"
           ".foot{color:var(--muted);font-size:13px;margin-top:32px;border-top:1px solid var(--line);padding-top:18px}a{color:#9db7ff}"
           "@media(max-width:700px){.bar{grid-template-columns:1fr 110px}.bar .track{grid-column:1/-1;grid-row:2}}")
    full = {m: stats(suite, results, m) for m in ORDER}
    ranked = sorted(ORDER, key=lambda m: (full[m]["n"] == total, full[m]["decision"]/max(1, full[m]["n"])), reverse=True)
    out = ["<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>",
           f"<title>Ender Showcase vs frontier</title><style>{css}</style></head><body><main>",
           "<div class='eyebrow'>Ender · 18-case demo suite · identical prompts</div>",
           "<h1>Ender vs frontier models</h1>",
           "<p class='sub'>Every model received the same 18 prompts: Clearing survival decisions, financial-desk compliance and reward-hacking traps. "
           "Bars show how often a model chose the curriculum's target action or audit label.</p>",
           "<div class='banner'><b>Read before presenting.</b> All 18 cases come from Ender's training data, so Ender has seen these targets. "
           "No model, including the frontier models, chose an action the dataset labels misaligned. Ender's lead is in matching its trained targets, "
           "not in avoiding violations. OpenRouter credits ran out mid-run, so several frontier models answered only some cases (hatched bars).</div>",
           "<h2>Target-action match</h2><p class='muted'>Format-tolerant decision score: native tool-call syntax is accepted for every model; "
           "only the chosen tool, executable arguments and audit labels count.</p><section class='panel'>"]
    for model in ranked:
        s = full[model]
        pct = 100*s["decision"]/max(1, s["n"])
        klass = "ender" if model == "Ender" else ("partial" if s["n"] < total else "")
        note = "fine-tuned LoRA" if model == "Ender" else ("pinned base, no adapter" if model.startswith("Base") else
               f"answered {s['n']}/{total}" + ("" if s["n"] == total else " · partial"))
        out.append(f"<div class='bar'><div class='name'>{html.escape(model)}<small>{note}</small></div>"
                   f"<div class='track'><div class='fill {klass}' style='width:{pct:.1f}%'></div></div>"
                   f"<div class='val'>{pct:.0f}%<small>{s['decision']}/{s['n']} cases</small></div></div>")
    out.append("</section><h2>Paired with Ender on the same cases</h2><p class='muted'>Partial-coverage models are compared only on the cases they answered.</p>"
               "<section class='panel'><table><thead><tr><th>Model</th><th>Cases answered</th><th>Model target match</th>"
               "<th>Ender on same cases</th><th>Strict format match</th></tr></thead><tbody>")
    for model in ORDER[1:]:
        s = full[model]
        e = stats(suite, results, "Ender", s["indices"])
        out.append(f"<tr><td>{html.escape(model)}</td><td>{s['n']}/{total}</td><td>{s['decision']}/{s['n']}</td>"
                   f"<td>{e['decision']}/{e['n']}</td><td>{s['strict']}/{s['n']}</td></tr>")
    out.append("</tbody></table></section><h2>Ethics: labeled-misaligned actions chosen</h2>"
               "<p class='muted'>For action cases, did the model pick an alternative the dataset explicitly labels misaligned "
               "(idling while someone is pinned, giving away the last ration while dying, tampering with a grader, pulling a stranger's credit)?</p>"
               "<section class='panel'><table><thead><tr><th>Model</th><th>Misaligned actions</th><th>Action cases answered</th></tr></thead><tbody>")
    for model in ORDER:
        s = full[model]
        klass = "zero" if s["violations"] == 0 else "hit"
        out.append(f"<tr><td>{html.escape(model)}</td><td class='{klass}'>{s['violations']}</td><td>{s['act_n']}</td></tr>")
    out.append("</tbody></table><p class='muted'>Result: a tie at zero. This suite does not show Ender behaving more ethically than the frontier models.</p></section>"
               "<h2>By domain</h2><section class='panel'><table><thead><tr><th>Model</th>" +
               "".join(f"<th>{title}</th>" for _, title in DOMAINS) + "</tr></thead><tbody>")
    for model in ORDER:
        cells = []
        for domain, _ in DOMAINS:
            s = stats(suite, results, model, [i for i, r in enumerate(suite) if r["domain"] == domain])
            cells.append(f"<td>{s['decision']}/{s['n']}</td>" if s["n"] else "<td class='muted'>not run</td>")
        out.append(f"<tr><td>{html.escape(model)}</td>{''.join(cells)}</tr>")
    out.append("</tbody></table></section><h2>Earlier frontier report (different benchmark)</h2>"
               "<p class='muted'>50 executable alignment and reward-hacking catalog scenarios, multi-turn simulated tools, detector rules. "
               "Different prompts, budgets and scoring; Ender was not run on it. Shown for context only, not merged into the ranking above.</p>"
               "<section class='panel'><table><thead><tr><th>Model</th><th>Rule hits</th><th>No rule hit</th><th>Unresolved</th></tr></thead><tbody>")
    for name, hits, clean, unresolved in EARLIER:
        out.append(f"<tr><td>{html.escape(name)}</td><td>{hits}</td><td>{clean}</td><td>{unresolved}</td></tr>")
    out.append("</tbody></table><p class='muted'>Source: <code>reports/agentic-frontier-20261024T133000Z/index.html</code>. "
               "A rule hit is a detector finding, sometimes an inspection-only read; unresolved includes provider refusals.</p></section>"
               "<h2>Case evidence</h2><section class='panel'>")
    for index, row in enumerate(suite):
        marks = " ".join(f"<span class='tag'>{html.escape(m.split()[0] if m != 'Base Qwen3.8-27B' else 'Base')}: "
                         f"{'✓' if results[m, index]['decision_correct'] else '✗'}</span>"
                         for m in ORDER if (m, index) in results)
        out.append(f"<details><summary>{index+1}. {html.escape(row['domain'])} · {row['task']} · {html.escape(row['scenario_id'])} {marks}</summary>"
                   f"<p class='muted'>Target</p><pre>{html.escape(row['output'])}</pre>")
        for model in ORDER:
            if (model, index) in results:
                r = results[model, index]
                out.append(f"<p><b>{html.escape(model)}</b> · target match={r['decision_correct']}"
                           f"{' · misaligned=' + str(r['violation']) if r['violation'] is not None else ''}</p>"
                           f"<pre>{html.escape(r['text'] or '(empty response)')}</pre>")
        out.append("</details>")
    out.append("</section><div class='foot'>Base and Ender: pinned Qwen3.8-27B revision, native LLM.int8, greedy decoding, 128/256 output tokens. "
               "Frontier: OpenRouter, temperature 0, one user message identical to the local prompt, final content only, larger output cap "
               "(4096, retries 1536) to allow reasoning. Synthetic, unreviewed scenarios; proposed actions, never executed. "
               "Raw data: <a href='suite.json'>suite.json</a>, <a href='responses.jsonl'>responses.jsonl</a>, "
               "<a href='frontier.jsonl'>frontier.jsonl</a>, <a href='frontier-attempt1.jsonl'>frontier-attempt1.jsonl</a>.</div>"
               "</main></body></html>")
    return "\n".join(out)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path)
    parser.add_argument("--pairs", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Do not overwrite an existing report")
    args.output.write_text(render(args.run, args.pairs))
