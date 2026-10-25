#!/usr/bin/env python3
"""Two 16:9 chart slides for the deck, as HTML with inline SVG (rendered to PNG by cdp-shot.mjs).
  python3 charts.py <cells.json> <totals.json> <out-dir>"""
import json, sys, os

cells_p, totals_p, out = sys.argv[1:]
cells = json.load(open(cells_p))
t = json.load(open(totals_p))[0]

HEAD = """<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap">
<style>
:root { --bg:#141414; --panel:#1c1c1c; --ink:#f3efe6; --muted:#a9a49a; --grid:#2c2c2c; --gold:#e5ca86; --reward:#e0805f; --charter:#86c2a8; --harm:#e06a5a; --bar:#4a4740; }
html,body { margin:0; width:1600px; height:900px; background:var(--bg); color:var(--ink); font-family:Manrope, system-ui, sans-serif; overflow:hidden; }
.wrap { padding:64px 80px 0; }
.eyebrow { color:var(--gold); font-weight:800; letter-spacing:.14em; font-size:18px; }
h1 { font-size:52px; line-height:1.08; margin:14px 0 10px; font-weight:800; letter-spacing:-.01em; }
.sub { color:var(--muted); font-size:22px; font-weight:500; margin:0; }
.foot { position:absolute; left:80px; right:80px; bottom:40px; color:var(--muted); font-size:17px; line-height:1.45; }
svg text { font-family:Manrope, system-ui, sans-serif; }
</style></head><body>"""

def esc(x):
    return str(x).replace('&', '&amp;').replace('<', '&lt;')

# --- Chart A: reward vs charter per model -------------------------------------------------
order = ['Ender v1.1', 'Qwen3.8 base, 4-bit', 'Qwen3.8 base, full', 'Abliterated', 'DeepSeek V4.1 Flash', 'GLM-5.3', 'Claude Haiku 5.5', 'GPT-6 Luna']
names = {'Qwen3.8 base, 4-bit': 'Qwen3.8-27B, 4-bit (Ender’s base)', 'Qwen3.8 base, full': 'Qwen3.8-27B, full precision', 'Abliterated': 'Qwen3.8-27B, abliterated'}
rate = {(c['short'], c['prompt']): c for c in cells}
rows = [(names.get(m, m), rate.get((m, 'reward')), rate.get((m, 'charter'))) for m in order if (m, 'reward') in rate and (m, 'charter') in rate]
rows.append(('All 8 models', {'rate': t['promptRewardRate'], 'taken': t['promptRewardTaken'], 'exposed': t['promptRewardExposed']},
             {'rate': t['promptCharterRate'], 'taken': t['promptCharterTaken'], 'exposed': t['promptCharterExposed']}))
W, H = 1440, 560
left, right, top = 470, 70, 40
row_h = (H - top - 40) / len(rows)
xmax = 0.12
x = lambda v: left + (W - left - right) * v / xmax
svg = [f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}">']
for tick in (0, .02, .04, .06, .08, .10, .12):
    svg.append(f'<line x1="{x(tick):.1f}" x2="{x(tick):.1f}" y1="{top - 10}" y2="{H - 40}" stroke="var(--grid)" stroke-width="1"/>')
    svg.append(f'<text x="{x(tick):.1f}" y="{H - 12}" fill="var(--muted)" font-size="17" text-anchor="middle">{round(tick * 100)}%</text>')
for i, (label, r, c) in enumerate(rows):
    y = top + row_h * i + row_h / 2
    pooled = label.startswith('All')
    if pooled:
        svg.append(f'<line x1="20" x2="{W - 20}" y1="{y - row_h / 2 + 2:.1f}" y2="{y - row_h / 2 + 2:.1f}" stroke="var(--gold)" stroke-opacity=".35" stroke-width="1"/>')
    svg.append(f'<text x="{left - 24}" y="{y + 7:.1f}" fill="{"var(--gold)" if pooled else "var(--ink)"}" font-size="{24 if pooled else 21}" font-weight="{800 if pooled else 600}" text-anchor="end">{esc(label)}</text>')
    rx, cx = x(r['rate']), x(c['rate'])
    svg.append(f'<line x1="{rx:.1f}" x2="{cx:.1f}" y1="{y:.1f}" y2="{y:.1f}" stroke="var(--muted)" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/>')
    size = 11 if pooled else 9
    svg.append(f'<circle cx="{rx:.1f}" cy="{y:.1f}" r="{size}" fill="var(--reward)"/>')
    svg.append(f'<circle cx="{cx:.1f}" cy="{y:.1f}" r="{size}" fill="var(--charter)"/>')
    lo, hi = sorted([(rx, r, 'reward'), (cx, c, 'charter')], key=lambda z: z[0])
    if lo[0] - left < 70:  # too close to the row label: put it above the dot
        svg.append(f'<text x="{lo[0]:.1f}" y="{y - 16:.1f}" fill="var(--{lo[2]})" font-size="18" font-weight="700" text-anchor="middle">{lo[1]["rate"] * 100:.1f}%</text>')
    else:
        svg.append(f'<text x="{lo[0] - 18:.1f}" y="{y + 6:.1f}" fill="var(--{lo[2]})" font-size="18" font-weight="700" text-anchor="end">{lo[1]["rate"] * 100:.1f}%</text>')
    svg.append(f'<text x="{hi[0] + 18:.1f}" y="{y + 6:.1f}" fill="var(--{hi[2]})" font-size="18" font-weight="700">{hi[1]["rate"] * 100:.1f}%</text>')
svg.append('</svg>')
legend = ('<div style="display:flex;gap:30px;margin:26px 0 8px;font-size:19px;font-weight:600;color:var(--muted)">'
          '<span><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:var(--reward);margin-right:9px;vertical-align:-1px"></span>Reward only</span>'
          '<span><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:var(--charter);margin-right:9px;vertical-align:-1px"></span>With the camp’s charter</span></div>')
a = HEAD + f"""<div class="wrap"><div class="eyebrow">THE CLEARING · WHAT WE FOUND</div>
<h1>Stating the rules halves rule-breaking</h1>
<p class="sub">Share of temptations each model took, reward-only prompt against the camp’s charter · {t['runs']} runs, every decision made inside SpacetimeDB</p>
{legend}{''.join(svg)}</div>
<div class="foot">Pooled over all 8 models: {t['promptRewardTaken']:,} of {t['promptRewardExposed']:,} temptations taken without the charter, {t['promptCharterTaken']:,} of {t['promptCharterExposed']:,} with it. Run-level permutation test (prompt labels shuffled among each model’s own runs, 20,000 times): p = {t['promptRunP']:.5f}. Seven of the eight models broke the rules less with the charter; DeepSeek did not.</div></body></html>"""
open(os.path.join(out, 'chart-rules.html'), 'w').write(a)

# --- Chart B: Ledger Street, no house rules ----------------------------------------------
ledger = [  # (label, passed of 70, harmful, ours, note)
    ('Claude Haiku 5.5', 50, 0, False, ''), ('DeepSeek V4.1 Flash', 47, 3, False, ''), ('Qwen3.8-27B, full precision', 47, 5, False, ''),
    ('Ender v1.3', 42, 5, True, ''), ('Qwen3.8-27B, 4-bit (Ender’s base)', 40, 7, False, ''), ('Ender v1.1', 37, 8, True, ''), ('GPT-6 Luna', 28, 2, False, '')]
W, H = 1440, 520
left, right, top = 470, 230, 20
row_h = (H - top - 40) / len(ledger)
x = lambda v: left + (W - left - right) * v / 70
svg = [f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}">']
for tick in (0, 10, 20, 30, 40, 50, 60, 70):
    svg.append(f'<line x1="{x(tick):.1f}" x2="{x(tick):.1f}" y1="{top}" y2="{H - 40}" stroke="var(--grid)" stroke-width="1"/>')
    svg.append(f'<text x="{x(tick):.1f}" y="{H - 12}" fill="var(--muted)" font-size="17" text-anchor="middle">{tick}</text>')
for i, (label, passed, harm, ours, _) in enumerate(ledger):
    y = top + row_h * i + row_h / 2
    svg.append(f'<text x="{left - 24}" y="{y + 7:.1f}" fill="{"var(--gold)" if ours else "var(--ink)"}" font-size="21" font-weight="{800 if ours else 600}" text-anchor="end">{esc(label)}</text>')
    svg.append(f'<rect x="{x(0):.1f}" y="{y - 15:.1f}" width="{x(passed) - x(0):.1f}" height="30" rx="5" fill="{"var(--gold)" if ours else "var(--bar)"}"/>')
    svg.append(f'<text x="{x(passed) + 14:.1f}" y="{y + 7:.1f}" fill="var(--ink)" font-size="20" font-weight="700">{passed}</text>')
    pill_x = W - right + 40
    color = 'var(--harm)' if harm else 'var(--charter)'
    svg.append(f'<text x="{pill_x}" y="{y + 7:.1f}" fill="{color}" font-size="19" font-weight="700">{harm} harmful</text>')
svg.append(f'<text x="{left}" y="{top - 2}" fill="var(--muted)" font-size="16">cases passed, of 70</text>')
svg.append('</svg>')
b = HEAD + """<div class="wrap"><div class="eyebrow">LEDGER STREET · OUR MODEL, MEASURED</div>
<h1>v1.3 fixed what v1.1 broke</h1>
<p class="sub">70 finance cases with no house rules in the prompt, every credit check a live CRS sandbox call · one run per model</p>
<div style="height:30px"></div>""" + ''.join(svg) + """</div>
<div class="foot">Ender v1.1 → v1.3: 37 → 42 passed, 8 → 5 harmful, collections 1/13 → 6/13, and no more contacting debtors in bankruptcy. v1.3 is the first adapter above its own 4-bit base (42 vs 40), a small margin in one run. Ender and its 4-bit base ran on Oct 25; the other models on Oct 24, same benchmark version.</div></body></html>"""
open(os.path.join(out, 'chart-ledger.html'), 'w').write(b)
print('wrote chart-rules.html, chart-ledger.html')
