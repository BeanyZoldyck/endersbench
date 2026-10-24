// Usage: node scripts/submission-cut/compose.mjs <spec.json> <out.mp4>
// Builds a captioned 1920x1080 video from title cards and clips of existing
// recordings (paths in the spec are relative to the spec file). Each segment is
// rendered on its own, then the segments are joined without re-encoding.
//   card: { "card": 6, "lines": [{ "text": "...", "size": 54, "serif": true, "color": "f0e4cc" }] }
//   clip: { "clip": "path.mp4", "from": 12, "for": 9, "width": 1536, "caption": "..." }
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const [specFile, out] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(specFile, 'utf8'));
const here = dirname(resolve(specFile));
const work = mkdtempSync(join(tmpdir(), 'submission-cut-'));
const W = 1920, H = 1080, INK = '0x293f39', CREAM = 'f0e4cc';
const SERIF = '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf';
const SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
let n = 0;
const textFile = text => { const f = join(work, `t${n++}.txt`); writeFileSync(f, text); return f; };
const draw = (text, { size = 30, serif = false, color = CREAM, y }) =>
  `drawtext=fontfile=${serif ? SERIF : SANS}:textfile=${textFile(text)}:x=(w-tw)/2:y=${y}:fontsize=${size}:fontcolor=0x${color}:expansion=none`;
const ENCODE = ['-c:v', 'libx264', '-preset', 'slow', '-crf', process.env.CRF ?? '26', '-pix_fmt', 'yuv420p', '-r', '30', '-an'];

const parts = spec.segments.map((s, i) => {
  const file = join(work, `s${i}.mp4`);
  if (s.card) {
    // Lines stack down the middle of the card, spaced by their size.
    const gap = s.gap ?? 1.9;
    const total = s.lines.reduce((h, l) => h + (l.size ?? 30) * gap, 0);
    let y = (H - total) / 2;
    const filters = s.lines.map(l => { const f = draw(l.text, { ...l, y: Math.round(y) }); y += (l.size ?? 30) * gap; return f; });
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-t', String(s.card), '-i', `color=c=${INK}:s=${W}x${H}:r=30`,
      '-vf', ['setsar=1', ...filters].join(','), ...ENCODE, file]);
  } else {
    // The clip sits at the top, scaled to the given width; its caption runs underneath,
    // from captionTop if given, otherwise against the bottom edge.
    const width = s.width ?? W;
    const filters = [`scale=${width}:-2`, 'setsar=1', `pad=${W}:${H}:(ow-iw)/2:${s.top ?? 0}:color=${INK}`];
    const lines = (s.caption ?? '').split('\n').filter(Boolean);
    const size = s.captionSize ?? 34;
    const first = s.captionTop ?? H - 30 - lines.length * size * 1.6;
    lines.forEach((text, k) => filters.push(draw(text, { size, y: Math.round(first + k * size * 1.6) })));
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(s.from), '-t', String(s.for), '-i', resolve(here, s.clip),
      '-vf', `fps=30,${filters.join(',')}`, ...ENCODE, file]);
  }
  return file;
});
const list = join(work, 'list.txt');
writeFileSync(list, parts.map(p => `file '${p}'`).join('\n'));
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', resolve(out)]);
console.log(`${out}: ${spec.segments.length} segments`);
