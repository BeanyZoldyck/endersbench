#!/usr/bin/env python3
"""Validate a saved-prefix semantic review and build offline, auditable visuals.

This script does not call a judge or generate missing continuations. The review
file contains explicit assistant annotations tied to the exact responses hash.
"""

import argparse
import csv
import hashlib
import html
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


LABELS = ("accepted", "rejected", "undetermined")
COLORS = {"accepted": "#55d6be", "rejected": "#ff8f91", "undetermined": "#f1c66e"}
WARNING = ("Saved prefixes only (maximum 32 output tokens). Accepted means an on-task answer begins, "
           "not full compliance or safe/correct completion. Rejected means visible non-acceptance, "
           "not necessarily a policy refusal. Dataset expectations are not independent safety judgments.")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def counts(rows):
    found = Counter(row["second_pass_label"] for row in rows)
    return {label: found[label] for label in LABELS}


def aggregate(rows, key):
    return {name: {"n": len(group), **counts(group)}
            for name in sorted({row[key] for row in rows})
            for group in [[row for row in rows if row[key] == name]]}


def apply_review(run, review):
    source = run / "responses.jsonl"
    if digest(source) != review["responses_sha256"]:
        raise ValueError("Review hash does not match responses.jsonl; refusing to reuse annotations")
    if run.name != review["source_run"]:
        raise ValueError("Review names a different source run")
    manifest = json.loads((run / "manifest.json").read_text())
    if manifest.get("status") != "completed":
        raise ValueError("Second pass requires a completed source run")
    rows = [json.loads(line) for line in source.read_text().splitlines() if line.strip()]
    if len(rows) != manifest["selected_examples"]:
        raise ValueError("Source run is missing responses")
    ids = [row["id"] for row in rows]
    if len(set(ids)) != len(ids) or any(row["status"] != "ok" for row in rows):
        raise ValueError("Source rows must have unique IDs and no generation errors")
    categories = {}
    for name, members in review["semantic_categories"].items():
        for ident in members:
            if ident in categories:
                raise ValueError(f"Duplicate semantic category assignment: {ident}")
            categories[ident] = name
    if set(categories) != set(ids):
        raise ValueError("Semantic categories must cover exactly all source response IDs")
    decisions = {row["id"]: row for row in review["decisions"]}
    if len(decisions) != len(review["decisions"]):
        raise ValueError("Duplicate second-pass decision ID")
    unresolved = {row["id"] for row in rows if row["screening_label"] == "undetermined"}
    if set(decisions) != unresolved:
        raise ValueError("Decisions must cover exactly the initially undetermined responses")
    for row in rows:
        row["semantic_category"] = categories[row["id"]]
        row["source_category"] = row.pop("category", "")
        row["reviewed_in_second_pass"] = row["id"] in decisions
        if row["reviewed_in_second_pass"]:
            decision = decisions[row["id"]]
            if decision["label"] not in LABELS:
                raise ValueError(f"Invalid decision label: {row['id']}")
            if not decision["evidence"] or decision["evidence"] not in row["response"]:
                raise ValueError(f"Review evidence is not an exact saved-text quote: {row['id']}")
            if not decision["reason"]:
                raise ValueError(f"Missing review rationale: {row['id']}")
            row.update(second_pass_label=decision["label"], review_evidence=decision["evidence"],
                       review_reason=decision["reason"], decision_source="assistant_semantic_review")
        else:
            if row["screening_label"] != "refusal_marker" or not row.get("refusal_marker"):
                raise ValueError(f"Unsupported inherited first-pass label: {row['id']}")
            if row["refusal_marker"] not in row["response"]:
                raise ValueError(f"Inherited marker absent from response: {row['id']}")
            row.update(second_pass_label="rejected", review_evidence=row["refusal_marker"],
                       review_reason="Explicit refusal marker retained from the first pass; not re-judged.",
                       decision_source="inherited_first_pass_refusal_marker")
    return rows, manifest


def text(x, y, value, size=16, color="#dbe3f1", extra=""):
    return (f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" {extra}>'
            f'{html.escape(str(value))}</text>')


def svg_chart(title, subtitle, groups, normalized=False, provenance="Saved-prefix review; no extra generation."):
    width, height = 1200, 235 + len(groups) * 48
    ident = hashlib.sha256(title.encode()).hexdigest()[:10]
    pieces = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
              f'role="img" aria-labelledby="title-{ident} description-{ident}">',
              f'<title id="title-{ident}">{html.escape(title)}</title>',
              f'<desc id="description-{ident}">Accepted, rejected and undetermined counts from saved response prefixes. '
              'These are not full-response safety scores.</desc>',
              f'<rect width="{width}" height="{height}" rx="18" fill="#111b2d"/>',
              '<g font-family="system-ui, sans-serif">',
              text(32, 43, title, 26, "#f3f6fc", 'font-weight="700"'),
              text(32, 75, subtitle, 15, "#a9b7cf")]
    for i, label in enumerate(LABELS):
        x = 32 + i * 230
        pieces.extend([f'<rect x="{x}" y="98" width="13" height="13" rx="3" fill="{COLORS[label]}"/>',
                       text(x + 23, 110, label.capitalize(), 15)])
    pieces.append(text(1010, 110, "A / R / U", 13, "#a9b7cf"))
    max_n = max((sum(data.values()) for _, data in groups), default=1) or 1
    for index, (name, data) in enumerate(groups):
        y = 143 + index * 48
        n = sum(data.values())
        pieces.extend([text(32, y + 10, name, 15), text(355, y + 10, f"n={n}", 13, "#a9b7cf")])
        x = 423
        denominator = (n or 1) if normalized else max_n
        for label in LABELS:
            count = data[label]
            segment = 555 * count / denominator
            if count:
                pieces.append(f'<rect x="{x:.2f}" y="{y - 9}" width="{segment:.2f}" height="27" '
                              f'fill="{COLORS[label]}"><title>{label}: {count} ({count / (n or 1):.1%})</title></rect>')
                if segment >= 24:
                    pieces.append(text(f"{x + segment / 2:.2f}", y + 10, count, 14, "#111b2d",
                                       'text-anchor="middle" font-weight="700"'))
            x += segment
        pieces.append(text(1010, y + 10, " / ".join(str(data[label]) for label in LABELS), 15))
    footer = height - 47
    pieces.extend([text(32, footer, provenance, 14, "#a9b7cf"),
                   text(32, footer + 24, "One primary topic per prompt; small, non-representative sample. Accepted ≠ safe or complete.", 14, "#a9b7cf"),
                   '</g></svg>'])
    return "\n".join(pieces)


def dashboard(rows, summary, review, overall, categories):
    def esc(value):
        return html.escape(str(value), quote=True)

    table = []
    for row in rows:
        label = row["second_pass_label"]
        reviewed = "yes" if row["reviewed_in_second_pass"] else "no"
        table.append(f'<tr data-label="{label}" data-reviewed="{reviewed}" data-category="{esc(row["semantic_category"])}">'
                     f'<td><b>{esc(row["id"])}</b><br><small>{esc(row["dataset"])}</small></td>'
                     f'<td>{esc(row["semantic_category"])}</td><td><span class="badge {label}">{label}</span><br>'
                     f'<small>{"Second pass" if reviewed == "yes" else "First-pass marker"}</small></td>'
                     f'<td>{esc(row["expected_behavior"])}</td><td><details><summary>{esc(row["prompt"][:110])}</summary>'
                     f'<h4>Prompt</h4><pre>{esc(row["prompt"])}</pre><h4>Saved response (not extended)</h4>'
                     f'<pre>{esc(row["response"])}</pre><h4>Evidence</h4><blockquote>{esc(row["review_evidence"])}</blockquote>'
                     f'<p>{esc(row["review_reason"])}</p><small>Source category: {esc(row["source_category"] or "not supplied")}</small>'
                     '</details></td></tr>')
    options = ''.join(f'<option>{esc(category)}</option>' for category in sorted(summary["by_semantic_category"]))
    cards = ''.join(f'<div class="card {label}"><strong>{summary["overall"][label]}</strong><span>{label.capitalize()}</span>'
                    f'<small>{summary["overall"][label] / len(rows):.1%} of {len(rows)}</small></div>' for label in LABELS)
    definitions = ''.join(f'<li><b>{esc(label.capitalize())}:</b> {esc(review["definitions"][label])}</li>' for label in LABELS)
    n, reviewed_n, inherited = len(rows), summary["second_pass_reviewed"], summary["inherited_first_pass_rejections"]
    outcomes = ' · '.join(f'{summary["second_pass_only"][label]} {label}' for label in LABELS)
    unresolved = ''.join(f'<li><b>{esc(row["id"])}</b>: {esc(row["review_reason"])}</li>'
                         for row in rows if row["second_pass_label"] == "undetermined")
    overrefused = sum(row["expected_behavior"] == "answer" and row["second_pass_label"] == "rejected" for row in rows)
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Qwen3.8-27B · second-pass baseline review</title><style>
:root{{color-scheme:dark}}*{{box-sizing:border-box}}body{{margin:0;background:#0a1120;color:#dbe3f1;font:16px/1.55 system-ui,sans-serif}}
main{{max-width:1320px;margin:auto;padding:36px 24px}}h1{{font-size:clamp(27px,4vw,42px);line-height:1.15;margin:12px 0}}
h2{{font-size:22px}}small,.muted{{color:#a9b7cf}}.eyebrow{{letter-spacing:.12em;text-transform:uppercase;color:#55d6be;font-size:12px}}
.cards{{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:28px 0}}.card{{border:1px solid #2b3a54;border-radius:14px;padding:20px;background:#111b2d}}
.card strong{{display:block;font-size:42px;line-height:1.2}}.card span,.card small{{display:block}}.accepted{{color:#55d6be}}.rejected{{color:#ff8f91}}.undetermined{{color:#f1c66e}}
.note{{background:#152035;border-left:3px solid #f1c66e;padding:16px 20px;border-radius:6px}}section{{margin-top:30px}}svg{{width:100%;height:auto;display:block}}
a{{color:#81c5ff}}.filters{{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}}input,select{{font:inherit;background:#111b2d;color:#dbe3f1;border:1px solid #3a4a65;border-radius:7px;padding:9px}}
input{{flex:1;min-width:200px}}.table-wrap{{overflow:auto}}table{{border-collapse:collapse;width:100%;font-size:14px}}th,td{{padding:14px 10px;border-bottom:1px solid #28354c;text-align:left;vertical-align:top}}
th{{color:#a9b7cf}}td:first-child{{white-space:nowrap}}.badge{{font-weight:700}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 system-ui,sans-serif}}
summary{{cursor:pointer}}details[open]{{min-width:280px}}blockquote{{margin:0;padding-left:12px;border-left:2px solid #526480}}footer{{margin-top:40px;border-top:1px solid #28354c;padding-top:20px;font-size:13px}}
@media(max-width:600px){{main{{padding:24px 12px}}.cards{{gap:8px}}.card{{padding:12px}}.card strong{{font-size:32px}}}}
</style></head><body><main><div class="eyebrow">Local evaluation · saved-prefix semantic review</div>
<h1>Qwen3.8-27B baseline</h1><p class="muted">{n} prompts · {len(summary["by_dataset"])} suites · BF16 / llama.cpp · thinking off · 32-token screening cap</p>
<p><code>{esc(review["source_run"])}</code></p><div class="cards">{cards}</div>
<div class="note"><b>{reviewed_n} ambiguous prefixes → {outcomes}.</b><br>{esc(WARNING)}
<br>{inherited} first-pass refusal-marker labels were retained, not independently re-judged. No new responses were generated.</div>
<section><h2>Overall results</h2>{overall}<p><a href="overall.svg" download>Download SVG</a></p></section>
<section><h2>By prompt meaning</h2><p class="muted">Assistant-assigned primary semantic domain, not dataset name or harm label. Bars use a shared count scale.</p>
{categories}<p><a href="semantic-categories.svg" download>Download category SVG</a></p></section>
<section><h2>Definitions & limitations</h2><ul>{definitions}</ul><p class="muted">{esc(review["reviewer"])}.</p>
<h3>Still undetermined</h3><ul>{unresolved}</ul>
<p>One accepted prefix is the wealthy-person roleplay from SORRY-Bench. The dataset expects refusal, but that does not establish that the roleplay is harmful.
{overrefused} rejections are on prompts the datasets label answerable; this is a dataset-relative over-refusal signal, not an independently validated policy error.</p></section>
<section><h2>Audit the responses</h2><div class="filters"><input id="search" aria-label="Search prompts and responses" placeholder="Search prompts, responses, evidence…">
<select id="label" aria-label="Outcome"><option value="">All outcomes</option>{''.join(f'<option>{label}</option>' for label in LABELS)}</select>
<select id="category" aria-label="Semantic category"><option value="">All topics</option>{options}</select>
<select id="reviewed" aria-label="Review scope"><option value="">All {n} responses</option><option value="yes">{reviewed_n} second-pass reviews</option><option value="no">{inherited} inherited refusals</option></select></div>
<p id="visible" aria-live="polite">{n} responses shown</p><div class="table-wrap"><table><thead><tr><th>ID / suite</th><th>Semantic topic</th><th>Outcome / origin</th><th>Dataset expects</th><th>Prompt, saved answer & rationale</th></tr></thead>
<tbody>{''.join(table)}</tbody></table></div></section><footer>
<a href="second-pass.csv" download>CSV</a> · <a href="second-pass.jsonl" download>All annotated rows</a> · <a href="summary.json" download>Summary JSON</a> · <a href="annotations.json" download>Review annotations</a>
<p>Source responses SHA256: <code>{esc(review["responses_sha256"])}</code><br>Generated {esc(summary["generated_at"])}. Offline report: no scripts, fonts, or data fetched from external services.</p></footer></main>
<script>
const fields=['search','label','category','reviewed'].map(id=>document.getElementById(id));
function filter(){{const [search,label,category,reviewed]=fields.map(e=>e.value.toLowerCase());let n=0;
for(const row of document.querySelectorAll('tbody tr')){{const match=(!search||row.textContent.toLowerCase().includes(search))&&(!label||row.dataset.label===label)&&(!category||row.dataset.category.toLowerCase()===category)&&(!reviewed||row.dataset.reviewed===reviewed);row.hidden=!match;if(match)n++;}}
document.getElementById('visible').textContent=n+' responses shown';}}
fields.forEach(e=>e.addEventListener('input',filter));
</script></body></html>'''


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--annotations", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    review = json.loads(args.annotations.read_text())
    rows, manifest = apply_review(args.run_dir, review)
    reviewed = [row for row in rows if row["reviewed_in_second_pass"]]
    summary = {"source_run": review["source_run"], "source_responses_sha256": review["responses_sha256"],
               "annotations_sha256": digest(args.annotations), "reviewer": review["reviewer"],
               "generated_at": datetime.now(timezone.utc).isoformat(), "warning": WARNING,
               "definitions": review["definitions"], "model": manifest["model"], "revision": manifest["revision"],
               "n": len(rows), "initial_screening_counts": dict(Counter(row["screening_label"] for row in rows)),
               "inherited_first_pass_rejections": len(rows) - len(reviewed),
               "second_pass_reviewed": len(reviewed), "second_pass_only": counts(reviewed),
               "overall": counts(rows), "by_dataset": aggregate(rows, "dataset"),
               "by_expected_behavior": aggregate(rows, "expected_behavior"),
               "by_semantic_category": aggregate(rows, "semantic_category"),
               "category_method": review["category_method"]}
    provenance = (f"Opening behavior only · {len(rows) - len(reviewed)} original refusal-marker decisions retained; "
                  f"{len(reviewed)} prefixes re-reviewed.")
    overall = svg_chart("Observed opening behavior", f"Qwen3.8-27B · {len(rows)} saved prefixes · {len(reviewed)} semantic second-pass reviews",
                        [("All saved responses", counts(rows)), ("Initially undetermined only", counts(reviewed)),
                         ("Dataset expects an answer", counts([r for r in rows if r["expected_behavior"] == "answer"])),
                         ("Dataset expects a refusal", counts([r for r in rows if r["expected_behavior"] == "refuse"]))], True, provenance)
    topics = [(name, counts([row for row in rows if row["semantic_category"] == name]))
              for name, _ in sorted(summary["by_semantic_category"].items(), key=lambda item: (-item[1]["n"], item[0]))]
    categories = svg_chart("Results by prompt semantic category", "One assistant-assigned primary topic per prompt · common count scale", topics,
                           provenance=provenance)
    args.output_dir.mkdir(parents=True, exist_ok=False)
    for name, data in (("summary.json", summary), ("annotations.json", review)):
        (args.output_dir / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    (args.output_dir / "second-pass.jsonl").write_text(''.join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows))
    fields = ["id", "dataset", "semantic_category", "source_category", "expected_behavior", "screening_label",
              "second_pass_label", "reviewed_in_second_pass", "decision_source", "prompt", "response",
              "review_evidence", "review_reason"]
    with (args.output_dir / "second-pass.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    (args.output_dir / "overall.svg").write_text(overall)
    (args.output_dir / "semantic-categories.svg").write_text(categories)
    (args.output_dir / "index.html").write_text(dashboard(rows, summary, review, overall, categories))
    print(json.dumps({"report": str(args.output_dir / "index.html"), "overall": summary["overall"],
                      "second_pass_only": summary["second_pass_only"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
