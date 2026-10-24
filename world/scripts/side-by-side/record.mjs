// Usage: node scripts/side-by-side/record.mjs <viewer base url> <left.json.gz> <right.json.gz> <out dir> [beats.json]
// Records two replays through the same beat script (seek to t, play at speed, hold),
// one after the other, and prints each video's start offset for compose.sh.
// Both replays must share a clock (recorded side by side by scripts/experiment.sh).
// Needs Playwright (not a dependency of the viewer): PLAYWRIGHT=/path/to/playwright/index.mjs
import { readFileSync, readdirSync, renameSync } from 'node:fs';
import { join, basename } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
const [base, left, right, outDir, beatsFile] = process.argv.slice(2);
// [seconds to seek to, speed, seconds to hold]
const beats = beatsFile ? JSON.parse(readFileSync(beatsFile, 'utf8')) : [[0, 4, 12]];
const W = Number(process.env.W ?? 960), H = Number(process.env.H ?? 720);

async function record(file, name) {
  const dir = join(outDir, name);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir, size: { width: W, height: H } } });
  await context.addInitScript(() => localStorage.setItem('endersbench/intro-seen', '1'));
  const page = await context.newPage();
  const opened = Date.now();
  await page.goto(`${base}/?replay=/demo/${basename(file)}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.replay-bar input[type=range]', { timeout: 60000 });
  const slider = page.locator('.replay-bar input[type=range]');
  const seek = ms => slider.evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, Math.max(0, Math.round(ms)));
  const speed = s => page.click(`.replay-bar button:has-text("${s}×")`);
  await seek(0); await page.waitForTimeout(3000);
  const start = Date.now();
  for (const [at, s, hold] of beats) { await seek(at * 1000); await speed(s); await page.waitForTimeout(hold * 1000); }
  await context.close(); await browser.close();
  const video = readdirSync(dir).find(f => f.endsWith('.webm'));
  renameSync(join(dir, video), join(outDir, `${name}.webm`));
  return (start - opened) / 1000;
}

const offsets = { left: await record(left, 'left'), right: await record(right, 'right') };
console.log(JSON.stringify(offsets));
