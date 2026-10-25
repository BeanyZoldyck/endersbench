// Builds both Apify Actors into their bundle/ folders, ready for `apify push`.
//
//   npm run actors:build            (from world/)
//
// enders-bench/bundle/world/main.js       the benchmark Actor
// enders-bench/bundle/world/viewer/       Ledger Street for its Live View
// enders-bench/bundle/crs/                CRS personas and saved responses
// site/bundle/world/main.js               the site Actor
// site/bundle/world/viewer/               the whole viewer, recordings included
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const actors = path.dirname(fileURLToPath(import.meta.url));
const world = path.resolve(actors, '..');
const repo = path.resolve(world, '..');

console.log('Building the viewer (vite build)…');
execSync('npx vite build', { cwd: world, stdio: 'inherit' });
const dist = path.join(world, 'dist');

async function bundle(name, viewerFilter, extra = () => {}) {
  const out = path.join(actors, name, 'bundle');
  fs.rmSync(out, { recursive: true, force: true });
  await build({
    entryPoints: [path.join(actors, name, 'src', 'main.ts')],
    outfile: path.join(out, 'world', 'main.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    // Installed in the image from the Actor's package.json.
    external: ['apify', '@anthropic-ai/sdk'],
    logLevel: 'warning',
  });
  fs.cpSync(dist, path.join(out, 'world', 'viewer'), { recursive: true, filter: viewerFilter });
  extra(out);
  console.log(`${name}: ${path.relative(world, out)}`);
}

// The Live View plays one run, so the forest's recordings stay out of the image.
const skip = ['demo', 'replays'].map(d => path.join(dist, d));
await bundle('enders-bench', src => !skip.some(d => src === d || src.startsWith(d + path.sep)), out => {
  fs.mkdirSync(path.join(out, 'crs'), { recursive: true });
  fs.copyFileSync(path.join(repo, 'crs', 'personas.json'), path.join(out, 'crs', 'personas.json'));
  fs.cpSync(path.join(repo, 'crs', 'fixtures'), path.join(out, 'crs', 'fixtures'), { recursive: true });
});
await bundle('site', () => true);
console.log('Done. Push each with `apify push` from actors/enders-bench and actors/site.');
