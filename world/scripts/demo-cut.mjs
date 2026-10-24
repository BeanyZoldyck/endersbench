// Usage: node scripts/demo-cut.mjs "<viewer url with ?replay=...>" <replay.json.gz> <video dir>
// Records a curated demo cut of a replay: an opening at speed, then each violation and death at 1x.
// Needs Playwright: npm i -D playwright (not a dependency of the viewer).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const [url, file, outDir] = process.argv.slice(2);
const replay = JSON.parse(gunzipSync(readFileSync(file)).toString());
// Key moments: the first frame each ethics event or death appears in.
const seen = new Set(), moments = [];
for (const f of replay.frames) {
  for (const e of f.tables.ethics_event ?? []) { const k = 'e' + JSON.stringify(e.id); if (!seen.has(k)) { seen.add(k); moments.push({ t: f.t, what: e.caption }); } }
  for (const s of f.tables.score ?? []) { if (s.diedAtMs > 0) { const k = 'd' + JSON.stringify(s.agentId); if (!seen.has(k)) { seen.add(k); moments.push({ t: f.t, what: 'death' }); } } }
  for (const w of f.tables.world ?? []) { if (w.rescueState === 'rescued' && !seen.has('rescue')) { seen.add('rescue'); moments.push({ t: f.t, what: 'rescue' }); } }
}
console.log(moments.map(m => `${(m.t / 1000).toFixed(0)}s ${m.what}`).join('\n'));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: outDir, size: { width: 1280, height: 800 } } });
await context.addInitScript(() => localStorage.setItem('endersbench/intro-seen', '1'));
const page = await context.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('.replay-bar input[type=range]', { timeout: 30000 });
const slider = page.locator('.replay-bar input[type=range]');
const seek = ms => slider.evaluate((el, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); }, Math.max(0, Math.round(ms)));
const speed = s => page.click(`.replay-bar button:has-text("${s}×")`);
// Opening: the first minutes at 8x (survivors spread out, the shelter goes up).
await speed(8); await page.waitForTimeout(14000);
// Each key moment, at 1x, from a few seconds before it.
// Keep the story's shape: the first beats, and always the ending (a rescue or the last death).
const ending = moments.filter(m => m.what === 'rescue' || m.what === 'death').at(-1);
const beats = [...moments.filter(m => m !== ending).slice(0, 7), ...(ending ? [ending] : [])];
for (const m of beats) { await seek(m.t - 5000); await speed(1); await page.waitForTimeout(9000); }
// Hold the ending so its spotlight can be read.
await page.waitForTimeout(6000);
await context.close(); await browser.close();
console.log('done');
