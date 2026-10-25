// The live leaderboard: the database's own record of finished runs
// (run_history, run_result) and its leaderboard view, which changes the
// moment a run closes. No file, no script: subscribe and it updates.
import { useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import type { LeaderboardRow, RunHistory, RunResult } from './module_bindings/types';

export function shortModel(modelId: string) {
  return (modelId.split(':').pop() ?? modelId).split('/').pop() ?? modelId;
}

export function leaderboardSections(rows: readonly LeaderboardRow[]) {
  const sections: Array<{ title: string; rows: LeaderboardRow[] }> = [];
  for (const row of rows) {
    const title = `Rules v${row.rulesVersion} · ${row.condition}`;
    const section = sections.find(s => s.title === title);
    if (section) section.rows.push(row);
    else sections.push({ title, rows: [row] });
  }
  return sections;
}

export function recentRuns(history: readonly RunHistory[], results: readonly RunResult[], count: number) {
  return [...history]
    .filter(run => run.outcome !== '')
    .sort((a, b) => Number(b.id - a.id))
    .slice(0, count)
    .map(run => {
      const mine = results.filter(r => r.runId === run.id);
      return {
        id: run.id,
        outcome: run.outcome,
        interactive: run.interactive,
        gameSeconds: run.gameSeconds,
        models: [...new Set(mine.map(r => shortModel(r.modelId)))].join(', ') || '—',
        survived: `${mine.filter(r => r.survived).length}/${mine.length}`,
      };
    });
}

const OUTCOME: Record<string, string> = { rescued: 'Rescued', missed: 'Plane missed', all_dead: 'No survivors', reset: 'Reset early' };
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function LiveLeaderboard() {
  const [rows] = useTable(tables.leaderboard);
  const [history] = useTable(tables.runHistory);
  const [results] = useTable(tables.runResult);
  const sections = leaderboardSections(rows);
  const recent = recentRuns(history, results, 8);
  return <div className="live-leaderboard">
    <p className="muted">Kept by the database and recomputed as each run ends. Score counters per survivor; interactive runs, early resets and runs with over 10% unanswered calls are left out; rules versions and conditions are never pooled.</p>
    {sections.length === 0 && <p className="muted">No finished runs yet.</p>}
    {sections.map(section => <section key={section.title}>
      <h3>{section.title}</h3>
      <table className="leaderboard-table">
        <thead><tr><th>Model</th><th title="Runs · survivors">Runs</th><th>Mean reward</th><th title="Survived · rescued">Lived</th><th title="Violations taken / temptations exposed">Violations</th><th>Answer</th></tr></thead>
        <tbody>{section.rows.map(row => <tr key={row.modelId}>
          <td title={row.modelId}>{shortModel(row.modelId)}</td>
          <td>{row.runs} · {row.agents}</td>
          <td>{Math.round(row.meanReward)}</td>
          <td>{row.survived}/{row.agents}</td>
          <td title={`${row.violations} of ${row.temptations}`}>{pct(row.violationRate)}</td>
          <td>{(row.meanLatencyMs / 1000).toFixed(1)} s</td>
        </tr>)}</tbody>
      </table>
    </section>)}
    {recent.length > 0 && <><h3>Recent runs</h3><ol className="journal">{recent.map(run => <li key={String(run.id)}>
      <strong>{OUTCOME[run.outcome] ?? run.outcome}</strong> · {run.models} · {run.survived} lived · {Math.round(run.gameSeconds)} s{run.interactive && <small> · interactive, not counted</small>}
    </li>)}</ol></>}
  </div>;
}
