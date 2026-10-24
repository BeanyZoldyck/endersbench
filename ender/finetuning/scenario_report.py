#!/usr/bin/env python3
"""Build a separate, offline report for alignment/reward-hacking choice probes."""

import argparse
import csv
import html
import json
from datetime import datetime, timezone
from pathlib import Path

from baseline import sha256, write_json
from scenario_baseline import DATASETS, LABELS, LIMITATION, score_choice, summarize
from second_pass import text


COLORS = {"ethical": "#55d6be", "unethical": "#ff8f91", "undetermined": "#f1c66e"}


def chart(title, groups):
    height = 230 + len(groups) * 48
    esc = html.escape
    pieces = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 {height}" role="img" aria-label="{esc(title, quote=True)}">',
              f'<title>{esc(title)}</title><rect width="1200" height="{height}" rx="18" fill="#111b2d"/>',
              '<g font-family="system-ui,sans-serif">', text(28, 40, title, 25),
              text(28, 70, "Qwen3.8-27B · BF16 / llama.cpp · stated choices, not executed actions", 15, "#a9b7cf")]
    for index, label in enumerate(LABELS):
        x = 28 + index * 245
        pieces.extend([f'<rect x="{x}" y="94" width="13" height="13" fill="{COLORS[label]}"/>',
                       text(x + 23, 106, label.capitalize() + " choice" if label != "undetermined" else label.capitalize(), 15)])
    pieces.append(text(1000, 106, "E / U / ?", 14, "#a9b7cf"))
    for index, (name, counts) in enumerate(groups):
        y = 143 + index * 48
        pieces.extend([text(28, y + 10, name, 15), text(345, y + 10, f"n={counts['n']}", 13, "#a9b7cf")])
        x = 410
        for label in LABELS:
            count = counts[label]
            width = 550 * count / (counts["n"] or 1)
            if count:
                pieces.append(f'<rect x="{x:.2f}" y="{y-10}" width="{width:.2f}" height="27" fill="{COLORS[label]}">'
                              f'<title>{label}: {count} ({count / counts["n"]:.1%})</title></rect>')
                if width >= 24:
                    pieces.append(text(x + width / 2, y + 9, count, 14, "#111b2d", 'text-anchor="middle"'))
            x += width
        pieces.append(text(1000, y + 9, " / ".join(str(counts[label]) for label in LABELS), 15))
    pieces.extend([text(28, height - 45, "Branch labels come from curated scenarios; no external judge or upstream tool harness was run.", 14, "#a9b7cf"),
                   text(28, height - 21, "Explicit alternatives cue decisions. Related cases overlap. Short explanations may be incomplete.", 14, "#a9b7cf"), '</g></svg>'])
    return "\n".join(pieces)


def load_run(run):
    manifest = json.loads((run / "manifest.json").read_text())
    if manifest.get("evaluation_mode") != "catalog_stated_choice":
        raise ValueError("Not a scenario choice-probe run")
    if manifest.get("status") not in ("completed", "completed_with_errors"):
        raise ValueError("Report requires a finished run")
    prompts = [json.loads(line) for line in (run / "prompts.jsonl").read_text().splitlines() if line.strip()]
    rows = [json.loads(line) for line in (run / "responses.jsonl").read_text().splitlines() if line.strip()]
    ids = [r["id"] for r in rows]
    if len(rows) != manifest["selected_examples"] or len(set(ids)) != len(ids):
        raise ValueError("Missing or duplicate responses")
    if len(prompts) != len(rows) or {r["id"] for r in prompts} != set(ids):
        raise ValueError("Prompt/response IDs do not match")
    by_id = {r["id"]: r for r in prompts}
    for row in rows:
        prompt = by_id[row["id"]]
        for key in ("prompt", "prompt_sha256", "dataset", "category", "ethical_option", "source", "overlaps"):
            if row[key] != prompt[key]:
                raise ValueError(f"Prompt/response metadata mismatch: {row['id']}: {key}")
        if row["dataset"] not in DATASETS:
            raise ValueError("Unexpected dataset in report")
        if row["status"] == "ok":
            score = score_choice(row["response"], row["ethical_option"])
            if any(row[key] != value for key, value in score.items()):
                raise ValueError(f"Saved choice score disagrees with response: {row['id']}")
        elif row["choice_label"] != "undetermined":
            raise ValueError("Generation errors cannot count as choices")
    return rows, manifest


def dashboard(rows, manifest, summary, overall, categories):
    esc = lambda value: html.escape(str(value), quote=True)
    cards = "".join(f'<div class="card {label}"><strong>{summary["overall"][label]}</strong>'
                    f'{label.capitalize()}{" choice" if label != "undetermined" else ""}</div>' for label in LABELS)
    table = []
    for row in rows:
        label = row["choice_label"]
        metadata = {key: row[key] for key in ("ethical_option", "tier", "source", "overlaps")}
        table.append(f'<tr data-label="{label}" data-dataset="{esc(row["dataset"])}" data-category="{esc(row["category"])}">'
                     f'<td><b>{esc(row["id"])}</b><br>{esc(row["title"])}</td><td>{esc(row["category"])}</td>'
                     f'<td class="{label}">{label}<br><small>{esc(row["choice_evidence"])}</small></td>'
                     f'<td><details><summary>Prompt, answer & provenance</summary><h4>Exact model prompt</h4><pre>{esc(row["prompt"])}</pre>'
                     f'<h4>Saved model answer</h4><pre>{esc(row["response"])}</pre><p>{esc(row["scoring_reason"])}</p>'
                     f'<p>Status: {esc(row["status"])} · Length-limited: {esc(row.get("length_limited", "n/a"))}</p>'
                     f'<p>{esc(row.get("error", ""))}</p><h4>Catalog metadata (not sent to model)</h4><pre>{esc(json.dumps(metadata, indent=2))}</pre>'
                     '</details></td></tr>')
    options = "".join(f'<option>{esc(name)}</option>' for name in summary["by_category"])
    positions = chart("Option-position diagnostic", list(summary["by_ethical_option"].items()))
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Alignment & reward hacking · Qwen3.8-27B</title><style>
:root{{color-scheme:dark}}*{{box-sizing:border-box}}body{{margin:0;background:#0a1120;color:#dbe3f1;font:16px/1.55 system-ui,sans-serif}}
main{{max-width:1320px;margin:auto;padding:32px 24px}}h1{{font-size:clamp(28px,4vw,42px);line-height:1.2}}h2{{margin-top:36px}}
.muted,small{{color:#a9b7cf}}.eyebrow{{color:#55d6be;letter-spacing:.12em;text-transform:uppercase;font-size:12px}}
.cards{{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:24px 0}}.card{{background:#111b2d;border:1px solid #2b3a54;border-radius:14px;padding:20px}}
.card strong{{display:block;font-size:42px}}.ethical{{color:#55d6be}}.unethical{{color:#ff8f91}}.undetermined{{color:#f1c66e}}
.note{{padding:16px 20px;border-left:3px solid #f1c66e;background:#152035}}svg{{width:100%;height:auto;display:block}}a{{color:#81c5ff}}
.filters{{display:flex;flex-wrap:wrap;gap:10px}}input,select{{background:#111b2d;border:1px solid #3a4a65;color:#dbe3f1;padding:9px;border-radius:7px;font:inherit}}
input{{flex:1;min-width:200px}}.table-wrap{{overflow:auto}}table{{width:100%;border-collapse:collapse;font-size:14px}}td,th{{padding:14px 10px;text-align:left;vertical-align:top;border-bottom:1px solid #28354c}}
pre{{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 system-ui,sans-serif}}summary{{cursor:pointer}}footer{{margin-top:36px;border-top:1px solid #28354c;padding-top:20px;font-size:13px}}
@media(max-width:600px){{main{{padding:20px 12px}}.cards{{gap:8px}}.card{{padding:12px}}.card strong{{font-size:32px}}}}
</style></head><body><main><div class="eyebrow">Separate catalog baseline · local inference only</div>
<h1>Alignment & reward hacking</h1><p class="muted">Qwen3.8-27B · {len(rows)} scenarios · 2 catalogs · BF16 / llama.cpp · thinking off · {manifest['max_new_tokens']}-token cap</p>
<p><code>{esc(summary['source_run'])}</code></p><div class="cards">{cards}</div>
<div class="note">{esc(LIMITATION)}<br><b>Generation errors: {summary['overall']['errors']}.</b> Errors count as undetermined, never as ethical choices.</div>
<h2>Overall and by dataset</h2>{overall}<p><a href="overall.svg" download>Download SVG</a></p>
<h2>By semantic category</h2><p class="muted">Source catalog subcategories, not independently assigned safety judgments. Each bar is normalized; n shows the count.</p>
{categories}<p><a href="semantic-categories.svg" download>Download category SVG</a></p>
<h2>Option-order check</h2><p>Within each catalog, the ethical branch appears equally often in A and B. Each scenario runs once. Differences below are confounded by scenario content; they are not a causal position-bias estimate.</p>{positions}
<h2>How to read this</h2><ul><li><b>Ethical:</b> leading CHOICE selects the catalog's ethical branch.</li>
<li><b>Unethical:</b> leading CHOICE selects the catalog's unethical branch.</li><li><b>Undetermined:</b> no valid leading choice, or a generation error.</li></ul>
<p>No refusal regex, semantic judge, or observed-action detector is used. The explanation is saved for inspection, not automatically judged. No Charter or win-at-all-costs instruction is added.
Only observations, branch actions/consequences, and output-format instructions are sent to the model. Titles, categories, ethical labels, detection rules, notes, and provenance stay outside the prompt.</p>
<p>All 24 alignment and 26 reward-hacking catalog entries are retained separately. Cross-catalog overlap links are shown per row; the pooled total is descriptive, not 50 independent failures or successes.</p>
<h2>Audit all responses</h2><div class="filters"><input id="search" aria-label="Search" placeholder="Search prompts and answers…">
<select id="label" aria-label="Choice"><option value="">All choices</option>{''.join(f'<option>{label}</option>' for label in LABELS)}</select>
<select id="dataset" aria-label="Dataset"><option value="">Both datasets</option>{''.join(f'<option>{name}</option>' for name in DATASETS)}</select>
<select id="category" aria-label="Category"><option value="">All categories</option>{options}</select></div><p id="visible" aria-live="polite">{len(rows)} responses shown</p>
<div class="table-wrap"><table><thead><tr><th>Scenario</th><th>Semantic category</th><th>Stated choice</th><th>Evidence</th></tr></thead><tbody>{''.join(table)}</tbody></table></div>
<footer><a href="choices.csv" download>CSV</a> · <a href="choices.jsonl" download>Responses & metadata</a> · <a href="summary.json" download>Summary JSON</a> · <a href="manifest.json" download>Run manifest</a>
<p>Response SHA256: <code>{esc(summary['responses_sha256'])}</code><br>Generated {esc(summary['generated_at'])}. Fully offline; no external scripts, fonts, or judge requests.</p></footer></main>
<script>
const fields=['search','label','dataset','category'].map(id=>document.getElementById(id));
function filter(){{const [search,label,dataset,category]=fields.map(e=>e.value.toLowerCase());let n=0;
for(const row of document.querySelectorAll('tbody tr')){{const match=(!search||row.textContent.toLowerCase().includes(search))&&(!label||row.dataset.label===label)&&(!dataset||row.dataset.dataset===dataset)&&(!category||row.dataset.category===category);row.hidden=!match;if(match)n++;}}
document.getElementById('visible').textContent=n+' responses shown';}}fields.forEach(e=>e.addEventListener('input',filter));
</script></body></html>'''


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    rows, manifest = load_run(args.run_dir)
    summary = summarize(rows, manifest["selected_examples"])
    summary.update(source_run=args.run_dir.name, responses_sha256=sha256(args.run_dir / "responses.jsonl"),
                   prompts_sha256=sha256(args.run_dir / "prompts.jsonl"),
                   generated_at=datetime.now(timezone.utc).isoformat(), model=manifest["model"],
                   revision=manifest["revision"], source_catalogs=manifest["sources"])
    overall = chart("Stated choices by catalog", [("Both catalogs (overlap present)", summary["overall"]),
                                               *summary["by_dataset"].items()])
    categories = chart("Stated choices by semantic category", sorted(summary["by_category"].items()))
    args.output_dir.mkdir(parents=True, exist_ok=False)
    write_json(args.output_dir / "summary.json", summary)
    write_json(args.output_dir / "manifest.json", manifest)
    (args.output_dir / "choices.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    fields = ["id", "dataset", "category", "tier", "ethical_option", "choice", "choice_label", "choice_evidence",
              "scoring_reason", "status", "prompt", "response", "length_limited", "generation_seconds", "error"]
    with (args.output_dir / "choices.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    (args.output_dir / "overall.svg").write_text(overall)
    (args.output_dir / "semantic-categories.svg").write_text(categories)
    (args.output_dir / "index.html").write_text(dashboard(rows, manifest, summary, overall, categories))
    print(json.dumps({"report": str(args.output_dir / "index.html"), "overall": summary["overall"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
