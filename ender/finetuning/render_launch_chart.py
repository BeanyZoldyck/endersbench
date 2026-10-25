#!/usr/bin/env python3
"""Launch-style grouped bar chart (SVG) for the Ender demo showcase.

Numbers come from saved raw responses via render_frontier_showcase.load/stats.
Bars for models with partial coverage carry their case count; footnotes state
the training overlap and the zero-violation tie. Nothing is hand-entered.
"""
import argparse
import html
from pathlib import Path

from render_frontier_showcase import DOMAINS, load, stats

MODELS = [  # (label in data, display name, fill)
    ("Ender", "Ender (ours)", "#5b45e6"),
    ("Grok 4.7", "Grok 4.7", "#c9ccd6"),
    ("Claude Opus 5.5", "Claude Opus 5.5", "#b3b8c6"),
    ("GPT-6 Astra", "GPT-6 Astra", "#9ea4b5"),
    ("Claude Haiku 5.5", "Claude Haiku 5.5", "#8a91a4"),
    ("GPT-6 Luna", "GPT-6 Luna", "#767e93"),
    ("Base Qwen3.8-27B", "Qwen3.8-27B (base)", "#e3e5ec"),
]
GROUPS = [("overall", "Overall")] + list(DOMAINS)


def esc(text):
    return html.escape(str(text), quote=True)


def chart(run, pairs):
    suite, results = load(run, pairs)
    data = {}
    for key, _ in GROUPS:
        indices = range(len(suite)) if key == "overall" else [i for i, r in enumerate(suite) if r["domain"] == key]
        indices = list(indices)
        for label, _, _ in MODELS:
            s = stats(suite, results, label, indices)
            data[key, label] = (s["decision"], s["n"], len(indices))
    violations = {label: stats(suite, results, label)["violations"] for label, _, _ in MODELS}

    width, height = 1600, 900
    left, right, top, bottom = 90, 40, 210, 250
    plot_w, plot_h = width-left-right, height-top-bottom
    group_w = plot_w/len(GROUPS)
    bar_gap = 6
    bar_w = (group_w-70-bar_gap*(len(MODELS)-1))/len(MODELS)
    y = lambda pct: top+plot_h*(1-pct/100)

    svg = [f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {width} {height}' width='{width}' height='{height}' "
           "font-family='Inter,Helvetica Neue,Arial,sans-serif'>",
           f"<rect width='{width}' height='{height}' fill='#ffffff'/>",
           f"<text x='{left}' y='70' font-size='40' font-weight='700' fill='#111827'>Ender Showcase</text>",
           f"<text x='{left}' y='108' font-size='20' fill='#6b7280'>Target-action match on 18 agentic ethics cases · same prompts for every model · higher is better</text>"]
    # Legend.
    lx, ly = left, 150
    for label, name, fill in MODELS:
        paint = fill
        stroke = " stroke='#cfd3dc'" if fill == "#e3e5ec" else ""
        svg.append(f"<rect x='{lx}' y='{ly-14}' width='18' height='18' rx='4' fill='{paint}'{stroke}/>")
        weight = "700" if label == "Ender" else "500"
        svg.append(f"<text x='{lx+26}' y='{ly}' font-size='17' font-weight='{weight}' fill='#374151'>{esc(name)}</text>")
        lx += 34+len(name)*9.6
    # Grid.
    for tick in range(0, 101, 20):
        ty = y(tick)
        svg.append(f"<line x1='{left}' y1='{ty:.1f}' x2='{width-right}' y2='{ty:.1f}' stroke='#eef0f4' stroke-width='1.5'/>")
        svg.append(f"<text x='{left-14}' y='{ty+6:.1f}' font-size='16' fill='#9ca3af' text-anchor='end'>{tick}</text>")
    svg.append(f"<line x1='{left}' y1='{y(0):.1f}' x2='{width-right}' y2='{y(0):.1f}' stroke='#d1d5db' stroke-width='2'/>")
    # Bars.
    for g, (key, title) in enumerate(GROUPS):
        gx = left+g*group_w+35
        n_cases = data[key, MODELS[0][0]][2]
        for m, (label, _, fill) in enumerate(MODELS):
            correct, answered, total = data[key, label]
            bx = gx+m*(bar_w+bar_gap)
            if not answered:
                svg.append(f"<text x='{bx+bar_w/2:.1f}' y='{y(0)-10:.1f}' font-size='12' fill='#9ca3af' text-anchor='middle' "
                           f"transform='rotate(-90 {bx+bar_w/2:.1f} {y(0)-10:.1f})'>not run</text>")
                continue
            pct = 100*correct/answered
            by = y(pct)
            partial = answered < total
            stroke = " stroke='#cfd3dc' stroke-width='1.5'" if fill == "#e3e5ec" else ""
            if partial:
                stroke = " stroke='#6b7280' stroke-width='1.5' stroke-dasharray='5 4'"
            opacity = " fill-opacity='0.45'" if partial else ""
            svg.append(f"<rect x='{bx:.1f}' y='{by:.1f}' width='{bar_w:.1f}' height='{y(0)-by:.1f}' rx='5' fill='{fill}'{opacity}{stroke}/>")
            bold = "800" if label == "Ender" else "600"
            color = "#4c3bd1" if label == "Ender" else "#374151"
            size = 19 if label == "Ender" else 15
            svg.append(f"<text x='{bx+bar_w/2:.1f}' y='{by-10:.1f}' font-size='{size}' font-weight='{bold}' fill='{color}' "
                       f"text-anchor='middle'>{pct:.0f}</text>")
            if answered < total:
                svg.append(f"<text x='{bx+bar_w/2:.1f}' y='{y(0)+20:.1f}' font-size='11' fill='#9ca3af' text-anchor='middle'>"
                           f"{answered}/{total}</text>")
        cx = gx+(len(MODELS)*(bar_w+bar_gap)-bar_gap)/2
        svg.append(f"<text x='{cx:.1f}' y='{y(0)+52:.1f}' font-size='21' font-weight='700' fill='#111827' text-anchor='middle'>{esc(title)}</text>")
        svg.append(f"<text x='{cx:.1f}' y='{y(0)+76:.1f}' font-size='15' fill='#6b7280' text-anchor='middle'>{n_cases} cases</text>")
    # Footnotes.
    zero = all(v == 0 for v in violations.values())
    notes = [
        "Score = % of answered cases where the model chose the curriculum's target action or audit label (native tool-call formats accepted).",
        "All 18 cases are drawn from Ender's fine-tuning data. Faded dashed bars with n/total labels: OpenRouter credit ran out, scored only on answered cases.",
        ("Labeled-misaligned actions chosen: 0 for every model, including Ender — the gap reflects matching trained targets, not fewer violations."
         if zero else "Labeled-misaligned actions chosen: " + ", ".join(f"{k} {v}" for k, v in violations.items()) + "."),
        "Qwen3.8-27B base and Ender: native int8, greedy. Frontier: OpenRouter, temperature 0, one identical user message. Raw outputs in frontier.jsonl.",
    ]
    for i, note in enumerate(notes):
        svg.append(f"<text x='{left}' y='{height-92+i*24}' font-size='15' fill='#6b7280'>{'¹²³⁴'[i]} {esc(note)}</text>")
    svg.append("</svg>")
    return "\n".join(svg)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path)
    parser.add_argument("--pairs", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Do not overwrite an existing chart")
    args.output.write_text(chart(args.run, args.pairs))
