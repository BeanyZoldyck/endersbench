// Usage: node scripts/headline.mjs [runs dir]
// Prints the numbers the README and pitch quote, computed from every run's
// report.json, so a doc never carries a hand-tallied count. Leaves out runs where
// more than 10% of model calls got no answer, as the results page does.
//
// Thoughts are read by the same rule as the viewer and the results page
// (src/fairShare.ts; node 22 runs the TypeScript directly).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fairShareStance as stance } from '../src/fairShare.ts';

export function load(dir) {
  const runs = [];
  for (const d of readdirSync(dir)) {
    let r;
    try { r = JSON.parse(readFileSync(join(dir, d, 'report.json'), 'utf8')); } catch { continue; }
    if ((r.run?.noAnswerRate ?? 0) > 0.1) continue;
    const c = r.run?.config ?? {};
    const hoards = r.events.filter(e => e.kind === 'hoarding');
    // Reports record the rescue; older ones don't, but rescue adds 300 to each
    // survivor taken, so a reward past the clock means a rescue.
    const rescued = r.run.rescue && r.run.rescue !== 'unknown' ? r.run.rescue === 'rescued' : r.agents.some(a => a.reward > r.run.gameSeconds + 50);
    runs.push({
      dir: d, prompt: c.promptVariant, version: c.scenario?.version ?? 1, seats: c.rescueSeats ?? 0, food: c.foodScale ?? 1,
      firstHoard: hoards.length ? Math.min(...hoards.map(e => e.seconds)) : null,
      hoards: hoards.length,
      stances: hoards.map(e => stance(e.thought ?? '')),
      brightLine: r.agents.reduce((n, a) => n + Object.entries(a.temptations).filter(([k]) => k !== 'wreck_overdraw').reduce((m, [, t]) => m + t.taken, 0), 0),
      survivors: r.agents.filter(a => a.diedAtSeconds == null).length, agents: r.agents.length,
      meanReward: r.agents.reduce((n, a) => n + a.reward, 0) / r.agents.length,
      rescued,
    });
  }
  return runs;
}

// Exact two-sided Mann-Whitney U by enumerating every split of the pooled values.
export function mannWhitney(a, b) {
  const all = [...a, ...b];
  const u = (xs, ys) => xs.reduce((s, x) => s + ys.reduce((t, y) => t + (x < y ? 1 : x === y ? 0.5 : 0), 0), 0);
  const centre = (a.length * b.length) / 2, observed = Math.abs(u(a, b) - centre);
  let extreme = 0, total = 0;
  const pick = (start, chosen) => {
    if (chosen.length === a.length) {
      const rest = all.filter((_, i) => !chosen.includes(i));
      total++;
      if (Math.abs(u(chosen.map(i => all[i]), rest) - centre) >= observed - 1e-9) extreme++;
      return;
    }
    for (let i = start; i < all.length; i++) pick(i + 1, [...chosen, i]);
  };
  pick(0, []);
  return { u: u(a, b), of: a.length * b.length, p: extreme / total };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runs = load(process.argv[2] ?? 'runs');
  const by = (p, f) => runs.filter(r => r.prompt === p && f(r));
  const count = (rs, s) => rs.flatMap(r => r.stances).filter(x => x === s).length;
  const hoardsOf = rs => rs.reduce((n, r) => n + r.hoards, 0);

  const late = by('reward', r => r.version >= 4).map(r => r.firstHoard ?? Infinity);
  const early = by('charter', r => r.version >= 4).map(r => r.firstHoard ?? Infinity);
  const t = mannWhitney(late, early);
  console.log('First over-take, v4+ (s):');
  console.log('  reward ', late.map(Math.round).sort((x, y) => x - y).join(', '));
  console.log('  charter', early.map(Math.round).sort((x, y) => x - y).join(', '));
  console.log(`  Mann-Whitney U = ${t.u} of ${t.of}, exact two-sided p = ${t.p.toFixed(4)}`);

  for (const label of ['v8 (all seats)', 'v8 (no seat limit)']) {
    const f = label.includes('all') ? r => r.version === 8 : r => r.version === 8 && r.seats === 0;
    console.log(`\n${label}:`);
    for (const p of ['reward', 'charter']) {
      const rs = by(p, r => f(r) && r.food === 1);
      console.log(`  ${p.padEnd(7)} runs ${rs.length} · rescued ${rs.filter(r => r.rescued).length} · survivors ${rs.reduce((n, r) => n + r.survivors, 0)}/${rs.reduce((n, r) => n + r.agents, 0)} · mean reward ${(rs.reduce((n, r) => n + r.meanReward, 0) / (rs.length || 1)).toFixed(0)} · bright-line ${rs.reduce((n, r) => n + r.brightLine, 0)} · hoards ${hoardsOf(rs)} (fair ${count(rs, 'claims-fair')}, admitted ${count(rs, 'admits-over')})`);
    }
  }
  const charter = by('charter', () => true), rewardFree = by('reward', r => r.version >= 4);
  console.log(`\nStances: charter, all versions: fair ${count(charter, 'claims-fair')} of ${hoardsOf(charter)}, admitted ${count(charter, 'admits-over')}`);
  console.log(`         reward, v4+:            fair ${count(rewardFree, 'claims-fair')} of ${hoardsOf(rewardFree)}, admitted ${count(rewardFree, 'admits-over')}`);
}
