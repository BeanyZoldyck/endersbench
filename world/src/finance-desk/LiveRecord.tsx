// The record, as the clearing's "Moments of choice" rail: every evaluated moment
// across the offices as it happens, newest first, with the CRS call behind each answer.
import { useMemo } from 'react';
import type { Office } from './comparison';
import { moments, type RecordEntry } from './liveEval';
import { TONE_COLORS } from './OfficeProps';

const KIND_WORDS: Record<RecordEntry['kind'], string> = { message: 'Message', evidence: 'CRS answer', finding: 'Finding', decision: 'Decision', report: 'Report', verdict: 'Verdict' };
const TONE: Record<string, string> = { ...TONE_COLORS, good: '#9fcf98', bad: '#ec6a73', gold: '#d7bd78' };
const SHOWN = 80;
const isLive = (api?: string) => !!api?.includes('· live ·');
// The source in a few words; the full line (status, RequestID, drift) is the tooltip.
const apiShort = (api: string) => isLive(api) ? `CRS live · ${/(\d+) ms/.exec(api)?.[1] ?? '—'} ms` : api.startsWith('Saved') ? 'Saved CRS data' : 'Snapshot after a failed call';

export function LiveRecord({ entries, offices, selected, onInspect, crs }: { entries: RecordEntry[]; offices: Office[]; selected: number; onInspect: (index: number) => void; crs: { live: number; fellBack: number; saved: number } }) {
  // Every office in one stream; an entry or a card opens one office's ledger.
  const shown = useMemo(() => moments(entries), [entries]);
  const agents = offices.filter(o => o.row), closed = agents.filter(o => o.verdict);
  const findings = entries.filter(e => e.kind === 'finding').length;
  const answers = crs.live + crs.fellBack + crs.saved;
  return <aside className="live-record" aria-label="Live evaluation">
    <header className="record-heading">
      <h2>Live evaluation</h2>
      <p className="record-stats">
        {closed.length ? <span><b>{closed.filter(o => o.verdict?.pass).length}/{closed.length}</b> compliant</span> : <span><b>{agents.length}</b> running</span>}
        <span className={findings ? 'bad' : ''}><b>{findings}</b> finding{findings === 1 ? '' : 's'}</span>
        {answers > 0 && <span className={crs.live ? 'live' : ''} title={crs.live ? 'Sent to the CRS sandbox during the run, as each test identity’s exact request. RequestIDs and latency are in each office’s ledger.' : 'The saved Oct 24 sandbox responses, not live calls'}>
          <b>{crs.live || answers}</b> {crs.live ? 'live CRS calls' : 'saved CRS answers'}{crs.fellBack ? ` · ${crs.fellBack} from snapshot` : ''}</span>}
      </p>
    </header>
    {!shown.length ? <p className="record-empty">{agents.length ? 'Waiting for the first action.' : 'No agents on this case yet.'}</p>
      : <ol className="record-list">{shown.slice(0, SHOWN).map(({ entry, members }) => {
        const target = members.find(m => m.office === selected) ?? entry;
        const calls = members.filter(m => m.api), liveCalls = calls.filter(m => isLive(m.api)).length;
        return <li key={entry.id} className={`record-entry ${entry.kind}`}>
          <button onClick={() => onInspect(target.office)} title={`${KIND_WORDS[entry.kind]} · open ${target.agent}'s ledger`}>
            <strong>{entry.tone && <i style={{ background: TONE[entry.tone] }} />}{entry.title}</strong>
            {entry.detail && <span className="record-detail">{entry.detail}</span>}
            <span className="record-meta">
              {members.length > 1 && members.length === agents.length
                ? <span className="record-agent">{members.map(m => <i key={m.id} style={{ background: m.color }} />)}All {members.length} offices</span>
                : members.map(m => <span key={m.id} className="record-agent"><i style={{ background: m.color }} />{m.agent}</span>)}
              {calls.length > 0 && <span className={`record-api ${liveCalls === calls.length ? 'live' : ''}`} title={calls.map(m => `${m.agent}: ${m.api}`).join('\n')}>
                {calls.length === 1 ? apiShort(calls[0].api!) : liveCalls === calls.length ? `CRS live · ${calls.length} calls` : `${liveCalls} of ${calls.length} live`}
              </span>}
            </span>
          </button>
        </li>;
      })}</ol>}
    {shown.length > SHOWN && <p className="record-more">{shown.length - SHOWN} earlier moments in each office’s ledger</p>}
  </aside>;
}
