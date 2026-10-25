import { SELECTABLE_MODELS, LEGACY_MODELS } from '../../../shared/models';
import { ledgerReplayHref, recordingIdentity, savedRecordings, type HistoryModel } from '../run-history';
import type { useRecordingHistory } from '../useRecordingHistory';
import { formatClock } from '../data';
import { ModelBuddy } from './ModelBuddy';
import '../run-history.css';


const recordedDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function RunHistory({ history, model, onFilter, onOpen }: {
  history: ReturnType<typeof useRecordingHistory>;
  model: HistoryModel;
  onFilter: (model: HistoryModel) => void;
  onOpen: (runId: string) => void;
}) {
  const filters: HistoryModel[] = ['all', ...SELECTABLE_MODELS, ...LEGACY_MODELS.filter(legacy => model === legacy || savedRecordings(legacy, history.recordings).length > 0)];
  const recordings = savedRecordings(model, history.recordings);
  return <main className="studio-main history-page">
    <div className="history-heading"><div><span className="eyebrow">THE ARCHIVE</span><h1>Run history</h1><p>Return to a recorded benchmark. Watch the replay, follow the agents, and inspect the evidence.</p></div><span className="history-total">{savedRecordings('all', history.recordings).length}<small>saved recordings</small></span></div>
    <div className="history-service"><p role="status">{history.status === 'loading' ? 'Loading local recording history… Packaged recordings are available below.' : history.status === 'unavailable' ? `Local history unavailable. ${history.recordings.length ? 'Showing the last loaded local recordings and packaged recordings.' : 'Showing packaged recordings.'} Retry when the benchmark service is available.` : 'Local recordings save automatically when a benchmark finishes. History refreshes every 15 seconds.'}</p><button className="outline-button" disabled={history.refreshing} onClick={history.refresh}>{history.refreshing ? 'Refreshing…' : 'Refresh history'}</button></div>
    <div className="history-filters" role="group" aria-label="Filter recordings by model">
      {filters.map(filter => <button key={filter} aria-pressed={model === filter} onClick={() => onFilter(filter)}>{filter === 'all' ? 'All models' : filter}<span>{savedRecordings(filter, history.recordings).length}</span></button>)}
    </div>
    <div className="history-caption"><p role="status">{recordings.length} {recordings.length === 1 ? 'recording' : 'recordings'}{model !== 'all' ? ` · ${model}` : ''}</p><span>Newest first · Times shown in your timezone</span></div>
    {recordings.length ? <div className="history-recordings">
      {recordings.map(record => { const identity = recordingIdentity(record); return <article className="history-record" key={record.id}>
        <div className="history-model"><div className="history-model-buddies">{(record.roster ?? [{ model: record.model, modelId: record.modelId }]).map(entry => <ModelBuddy key={entry.model} modelId={entry.modelId} />)}</div><div><strong>{identity.label}</strong><small>{identity.modelIds}</small></div></div>
        <div className="history-title"><h2>{record.label}</h2><p>{record.scenario === 'ledger' ? 'Ledger Street' : 'The Clearing'} <span>·</span> {record.condition} <span>·</span> {record.status === 'partial' ? 'Partial recording' : record.status === 'completed' ? 'Completed benchmark' : 'Packaged recording'}</p></div>
        <div className="history-date"><time dateTime={record.recordedAt}>{recordedDate.format(new Date(record.recordedAt))}</time><small>{formatClock(record.durationMs)} recorded</small></div>
        {record.scenario === 'ledger' ? <a className="outline-button" aria-label={`Open Ledger recording: ${record.label}`} href={ledgerReplayHref(record.id)}>Open recording <span aria-hidden="true">↗</span></a> : <button className="outline-button" aria-label={`Open recording: ${record.label}`} onClick={() => onOpen(record.id)}>Open recording <span aria-hidden="true">↗</span></button>}
      </article>; })}
    </div> : <section className="history-empty"><span className="eyebrow">NO RECORDINGS YET</span><h2>{history.status === 'loading' ? `Checking local recordings for ${model}…` : history.status === 'unavailable' ? `No available recordings for ${model}.` : `No saved recordings for ${model}.`}</h2><p>{history.status === 'loading' ? 'The benchmark service is being checked. Packaged recordings for other models are available now.' : history.status === 'unavailable' ? 'Local history could not be checked. Refresh to look for recordings from the benchmark service.' : 'This archive does not yet include a playable recording for this model. Active runs appear after their recording is finalized.'}</p><button className="outline-button" onClick={() => onFilter('all')}>View all recordings ↗</button></section>}
    <p className="history-note">Packaged recordings and saved local benchmark sessions appear together. Partial recordings preserve captured evidence from interrupted or failed runs; their scores are provisional. Packaged recordings may also end before the scenario is complete.</p>
  </main>;
}
