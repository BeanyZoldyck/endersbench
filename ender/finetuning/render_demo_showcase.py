#!/usr/bin/env python3
"""Render a self-contained, leaderboard-style HTML page from demo-showcase outputs."""
import argparse
import html
import json
from pathlib import Path


def render(run):
    summary = json.loads((run/"summary.json").read_text())
    rows = [json.loads(line) for line in (run/"responses.jsonl").read_text().splitlines()]
    suite = json.loads((run/"suite.json").read_text())
    titles = {"simulation_alignment":"Simulation alignment", "financial_compliance":"Financial compliance", "reward_hacking":"Reward hacking"}
    css = """
:root{color-scheme:dark;--bg:#0b1020;--panel:#121a2b;--line:#29364f;--text:#e8eef8;--muted:#9eacc3;--blue:#87a9ff;--mint:#5de0bf;--amber:#ffd166;--rose:#ff8295}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 70% -10%,#23385d 0,transparent 44%),var(--bg);color:var(--text);font:15px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:38px 24px 70px}.eyebrow{color:var(--mint);font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700}h1{font-size:clamp(32px,5vw,56px);line-height:1.05;letter-spacing:-.04em;margin:12px 0}h2{margin:35px 0 14px;font-size:22px}.sub{color:var(--muted);max-width:780px}.banner{border:1px solid #705a2d;background:#352b183d;color:#ffdf91;padding:15px 18px;border-radius:12px;margin:22px 0}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}.card,.panel{background:linear-gradient(145deg,#172238,#111827);border:1px solid var(--line);border-radius:15px;padding:20px;box-shadow:0 15px 40px #0002}.label{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em}.big{font-size:36px;font-weight:750;letter-spacing:-.04em;margin:7px 0}.green{color:var(--mint)}.blue{color:var(--blue)}.row{display:grid;grid-template-columns:190px 1fr 90px;align-items:center;gap:14px;margin:15px 0}.track{height:11px;background:#263147;border-radius:99px;overflow:hidden}.fill{height:100%;background:linear-gradient(90deg,#688cff,var(--mint));border-radius:99px}.metric{font-variant-numeric:tabular-nums;text-align:right}.tablewrap{overflow:auto}.leader{width:100%;border-collapse:collapse}.leader td,.leader th{text-align:left;padding:13px;border-bottom:1px solid var(--line)}.leader th{color:var(--muted);font-size:12px;text-transform:uppercase}.tag{display:inline-block;border:1px solid var(--line);border-radius:99px;padding:3px 9px;color:var(--muted);font-size:12px;margin:2px}.tag.mint{color:var(--mint);border-color:#377c70}.tag.amber{color:var(--amber);border-color:#756235}.case{border-top:1px solid var(--line);padding:12px 0}.case summary{cursor:pointer;font-weight:650}.case pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0b1120;border:1px solid var(--line);padding:13px;border-radius:9px;font:12px/1.55 ui-monospace,monospace;max-height:360px;overflow:auto}.foot{color:var(--muted);font-size:13px;margin-top:30px;border-top:1px solid var(--line);padding-top:18px}a{color:#9db7ff}@media(max-width:650px){main{padding:26px 14px}.row{grid-template-columns:1fr 65px}.row .track{grid-column:1/-1;grid-row:2}.row .metric{grid-column:2;grid-row:1}}
"""
    overall = {mode: (sum(r["correct"] for r in rows if r["mode"]==mode),
                      sum(r["valid"] for r in rows if r["mode"]==mode),
                      sum(r["mode"]==mode for r in rows)) for mode in ("base","ender")}
    basec, basev, total = overall["base"]
    enderc, enderv, _ = overall["ender"]
    out = ["<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>",
        "<title>Ender Demo Showcase</title><style>", css, "</style></head><body><main>",
        "<div class='eyebrow'>Ender · curated demo suite · 18 cases</div>",
        "<h1>Demo Showcase</h1>",
        "<p class='sub'>A matched-format snapshot of simulation altruism, financial compliance and reward-hacking behavior. Base and Ender receive identical prompts; outputs are proposed calls and audits, not executed trajectories.</p>",
        "<div class='banner'><b>Training-overlap showcase.</b> Every case is drawn from Ender’s fine-tuning corpora. This is useful for demonstrating curriculum fit, not independent generalization. Frontier results are <b>not measured on this suite</b>; the earlier frontier report used a different benchmark and is not comparable.</div>",
        "<section class='cards'>",
        f"<div class='card'><div class='label'>Base · pinned Qwen3.8-27B</div><div class='big blue'>{basec}/{total}</div><div class='label'>exact target matches · {basev}/{total} valid outputs</div></div>",
        f"<div class='card'><div class='label'>Ender · Clearing demo LoRA</div><div class='big green'>{enderc}/{total}</div><div class='label'>exact target matches · {enderv}/{total} valid outputs</div></div>",
        f"<div class='card'><div class='label'>Matched change</div><div class='big'>{enderc-basec:+d}</div><div class='label'>net exact matches vs base · n={total} paired cases</div></div>",
        "</section><h2>By domain</h2><section class='panel'>"]
    for domain, title in (("simulation_alignment", "Simulation alignment"),
                          ("financial_compliance", "Financial compliance"),
                          ("reward_hacking", "Reward hacking")):
        b, e = summary["base"][domain], summary["ender"][domain]
        n=b["total"]
        out.append(f"<div class='row'><div>{title}<div class='label'>Base {b['correct']}/{n} · Ender {e['correct']}/{n}</div></div><div class='track'><div class='fill' style='width:{(e['correct']/max(1,n))*100:.1f}%'></div></div><div class='metric'>{(e['correct']/max(1,n))*100:.0f}% Ender</div></div>")
    out.append("</section><h2>Leaderboard</h2><section class='panel tablewrap'><table class='leader'><thead><tr><th>Model</th><th>Exact matches</th><th>Valid outputs</th><th>Evaluation status</th></tr></thead><tbody>")
    for name, (correct, valid, _) in (("Ender · Clearing demo LoRA", overall["ender"]), ("Base · Qwen3.8-27B", overall["base"])):
        out.append(f"<tr><td><b>{html.escape(name)}</b></td><td>{correct}/{total} ({100*correct/max(1,total):.0f}%)</td><td>{valid}/{total}</td><td><span class='tag mint'>matched prompts</span><span class='tag amber'>training overlap</span></td></tr>")
    out.append("</tbody></table></section><h2>Case-by-case evidence</h2><section class='panel'>")
    if len(rows) != 2*len(suite):
        raise ValueError("Expected exactly two matched responses per frozen suite row")
    for index, source in enumerate(suite):
        base, ender = rows[2*index:2*index+2]
        if base["mode"] != "base" or ender["mode"] != "ender":
            raise ValueError("Responses are not in frozen base/Ender pair order")
        if base["scenario_id"] != source["scenario_id"] or ender["scenario_id"] != source["scenario_id"]:
            raise ValueError("Response order does not match frozen suite")
        if base["prompt_sha256"] != ender["prompt_sha256"]:
            raise ValueError("Base and Ender received different prompts")
        label=f"{source['domain']} · {source['task']} · {source['scenario_id']} · case {index+1}"
        out.append(f"<details class='case'><summary>{html.escape(label)} <span class='tag blue'>base {'match' if base['correct'] else 'miss'}</span> <span class='tag mint'>Ender {'match' if ender['correct'] else 'miss'}</span></summary>")
        for record in (base, ender):
            out.append(f"<p><b>{record['mode'].title()}</b> · valid={record['valid']} · exact match={record['correct']}</p><pre>{html.escape(record['response'])}</pre>")
        out.append("</details>")
    out += ["</section><div class='foot'><b>Scoring:</b> actions require valid tool-call format and exact executable arguments (Clearing thought wording ignored); audits use domain-specific labels. Exact-target misses are not automatically unsafe. Audit scores are narrow field checks, not human judgments. All data is synthetic/unreviewed. See <a href='suite.json'>frozen prompts/targets</a>, <a href='responses.jsonl'>raw responses</a>, <a href='manifest.json'>run manifest</a> and <a href='summary.json'>summary JSON</a>.</div></main></body></html>"]
    return "\n".join(out)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Do not overwrite an existing report")
    args.output.write_text(render(args.run))
