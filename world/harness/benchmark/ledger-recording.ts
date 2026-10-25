import type { Replay } from '../../src/replay.js';

// Generic journals store changed tables. Finance playback expects the final
// evidence tables and paces individual recorded turns itself.
export function ledgerRecording(replay: Replay): unknown {
  const tables: Record<string, unknown[]> = {};
  for (const frame of replay.frames) Object.assign(tables, frame.tables);
  const runRow = tables.meta?.find(row => typeof row === 'object' && row !== null && 'key' in row && row.key === 'run');
  let metadata: Record<string, unknown> = {};
  if (runRow && typeof runRow === 'object' && 'value' in runRow && typeof runRow.value === 'string') {
    try { metadata = JSON.parse(runRow.value) as Record<string, unknown>; } catch { /* Evidence remains playable without optional roster metadata. */ }
  }
  const cases = tables.finance_case ?? [];
  if (!cases.length) throw new Error('Ledger recording contains no cases.');
  return {
    version: 1, lineup: true, source: `Ledger lobby · saved CRS snapshots · ${replay.db}`, recordedAt: replay.recordedAt,
    timing: 'paced', stepMs: 2200, cases, steps: tables.finance_step ?? [], verdicts: tables.finance_verdict ?? [],
    roster: metadata.roster, caseSlots: metadata.caseSlots,
  };
}
