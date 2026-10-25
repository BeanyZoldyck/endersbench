// Calls the CRS sandbox live for some personas, through every product a desk
// tool can reach, and compares each answer with the Oct 24 snapshot the cases
// were written on. No model is called. Run it to show the sandbox answering,
// or before a live benchmark run to check that CRS has not moved.
//
//   npm run crs:live                         P13, the synthetic identity: all nine products
//   npm run crs:live -- --persona P12,P14    other test identities
//   npm run crs:live -- --held-out           the eight held-out personas (72 calls)
//   npm run crs:live -- --all                all 20 test identities (180 calls, as many as the snapshot)
//   npm run crs:live -- --tools verify_identity,check_fraud
//
// Each line also says whether CRS's full response matches the saved one, field
// for field, or which fields moved. Exits 1 if any call fell back to the
// snapshot or a card now differs from it.
import type { CrsAnswer } from '../../spacetimedb/src/finance/engine';
import type { CrsTool } from '../../spacetimedb/src/finance/types';
import { crsClientFromEnv, crsSummary, liveCrs, personaRequest } from './crslive';
import { HELD_OUT_PERSONAS } from './labels';
import { crsResponse } from './rawcrs';

const ALL_PERSONAS = Array.from({ length: 20 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`);

const CALLS: [CrsTool, Record<string, unknown>][] = [
  ['pull_credit', { bureau: 'transunion' }],
  ['pull_credit', { bureau: 'equifax' }],
  ['pull_credit', { bureau: 'experian' }],
  ['verify_identity', {}],
  ['check_fraud', {}],
  ['search_public_records', {}],
  ['criminal_check', {}],
  ['eviction_check', {}],
  ['reverse_lookup', {}],
];

function flag(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : (process.argv[i + 1] ?? '');
}

// The card in one line, the way an underwriter would read it.
function gist(tool: CrsTool, card: any): string {
  switch (tool) {
    case 'pull_credit':
      if (card.status !== 'file') return card.status.replace('_', ' ');
      return `${card.score ?? `no score (${card.noScoreReason})`}, ${card.tradelines} accounts, ${card.late30 + card.late60 + card.late90} lates, ${card.collections} collections${card.bankruptcies.length ? `, ${card.bankruptcies.join('; ')}` : ''}`;
    case 'verify_identity':
      return `${card.result}${card.messages.length ? `: ${card.messages.join('; ')}` : ''}`;
    case 'check_fraud':
      return `${card.score} (${card.band})${card.signals.length ? `: ${card.signals.join('; ')}` : ''}`;
    case 'search_public_records': {
      const all = [...card.bankruptcies, ...card.judgments, ...card.liens];
      return all.length ? all.join('; ') : 'none';
    }
    case 'criminal_check':
    case 'eviction_check':
      return card.records.length ? card.records.map((r: Record<string, unknown>) => Object.values(r).filter(v => v != null).join(' ')).join('; ') : 'none';
    case 'reverse_lookup':
      return card.records.length ? card.records.map((r: { name: string; city: string }) => `${r.name}, ${r.city}`).join('; ') : 'none';
  }
}

// JSON paths where two responses differ.
function changedPaths(a: unknown, b: unknown, at = ''): string[] {
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap(k => changedPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], at ? `${at}.${k}` : k));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [at || '(whole response)'];
}

async function main() {
  const personas = process.argv.includes('--all')
    ? ALL_PERSONAS
    : process.argv.includes('--held-out')
      ? HELD_OUT_PERSONAS
      : (flag('persona') ?? 'P13').split(',').map(s => s.trim());
  const tools = flag('tools')?.split(',').map(s => s.trim());
  const calls = CALLS.filter(([tool]) => !tools || tools.includes(tool));
  const client = crsClientFromEnv();
  await client.login();
  console.log(`CRS sandbox, live: ${personas.length} persona(s) × ${calls.length} product(s), each the persona's exact saved request.\n`);

  const live = liveCrs(client, { raw: true });
  const answers: CrsAnswer[] = [];
  const rawMoved = new Map<string, number>();
  let rawSame = 0;
  for (const id of personas) {
    for (const [tool, extra] of calls) {
      const answer = await live(tool, { subject_id: id, ...extra });
      if (!answer) {
        console.log(`${id}  ${tool}: not a CRS test identity, nothing sent`);
        continue;
      }
      answers.push(answer);
      const c = answer.crs;
      const label = `${tool}${extra.bureau ? ` ${extra.bureau}` : ''}`;
      const where = c.source === 'live' ? `live ${c.status}` : `SNAPSHOT (${c.error})`;
      const changed = c.drift?.length ? `  CHANGED since Oct 24: ${c.drift.join(', ')}` : '';
      let raw = '';
      if (c.source === 'live') {
        const moved = changedPaths(answer.raw, crsResponse(id, personaRequest(tool, { subject_id: id, ...extra })!.file));
        moved.forEach(p => rawMoved.set(p, (rawMoved.get(p) ?? 0) + 1));
        if (!moved.length) rawSame++;
        raw = moved.length ? `  [raw: ${moved.length} field(s) differ]` : '  [raw: identical]';
      }
      console.log(`${id}  ${label.padEnd(33)} ${where.padEnd(10)} ${String(c.latencyMs).padStart(5)} ms  ${(c.requestId ?? '-').padEnd(36)}  ${gist(tool, answer.result)}${changed}${raw}`);
    }
    console.log('');
  }

  const s = crsSummary([answers.map(a => ({ tool: 'crs', args: {}, crs: a.crs }))]);
  console.log(`${s.live}/${s.calls} answered live (median ${s.medianMs ?? '-'} ms, p95 ${s.p95Ms ?? '-'} ms) · ${s.fellBack} fell back to the snapshot · ${s.drifted} cards differ from it · ${rawSame}/${s.live} full responses identical`);
  if (rawMoved.size) {
    console.log('Fields that moved in the full responses (calls):');
    for (const [p, n] of [...rawMoved].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${String(n).padStart(4)}  ${p}`);
  }
  if (s.fellBack || s.drifted) process.exitCode = 1;
}

// process.exit() while fetch sockets close trips a libuv assertion on Windows; set exitCode instead.
main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
