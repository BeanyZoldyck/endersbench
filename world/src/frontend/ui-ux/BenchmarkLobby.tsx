import type { Dispatch } from 'react';
import { BENCHMARK_MODELS, MAX_BENCHMARK_AGENTS, rosterSize, type StudioAction, type StudioState } from '../model';
import { benchmarkBlocker, rosterEntries, rosterLabel, type BenchmarkConfig, type BenchmarkJob } from '../benchmark-client';
import { ModelBuddy } from './ModelBuddy';
import '../benchmark-lobby.css';

type LobbyProps = {
  state: StudioState;
  dispatch: Dispatch<StudioAction>;
  config: BenchmarkConfig | null;
  error: string;
  starting: boolean;
  activeJob?: BenchmarkJob | null;
  checkingRun?: boolean;
  onStart: () => void;
  onRetry: () => void;
  onDetails: () => void;
};

export function BenchmarkLobby({ state, dispatch, config, error, starting, activeJob: candidateJob, checkingRun = false, onStart, onRetry, onDetails }: LobbyProps) {
  const activeJob = candidateJob?.status === 'running' || candidateJob?.status === 'starting' ? candidateJob : null;
  const total = rosterSize(state.draftRoster);
  const entries = rosterEntries(state.draftRoster);
  const scenario = config?.scenarios.find(option => option.id === state.draftScenario);
  const illustration = scenario?.id.startsWith('clearing-')
    ? { src: '/studio/clearing-mascots-concept.png', alt: 'The model buddies sharing berries around a table in The Clearing.' }
    : scenario?.id === 'ledger'
      ? { src: '/studio/lending-desk-simple.png', alt: 'The model buddies reviewing lending evidence at office desks on Ledger Street.' }
      : null;
  const blocker = benchmarkBlocker(config, state.draftRoster, state.draftScenario);
  return <main className="studio-main setup-page compact-setup benchmark-lobby">
    <div className="page-head"><h1>Start a benchmark</h1><p>Build a lineup of one to four agents, choose a scenario, then observe a fresh simulation.</p></div>
    <div className="setup-grid">
      <section aria-labelledby="lineup-heading">
        <div className="lineup-heading"><h2 id="lineup-heading">Your lineup</h2><strong role="status" aria-live="polite" aria-atomic="true">{total}/4 selected</strong></div>
        <p className="small muted" id="lineup-help">Four agents maximum across all models. Remove an agent to make room for another model.</p>
        <div className="lineup-models" aria-describedby="lineup-help">{BENCHMARK_MODELS.map(model => {
          const connection = config?.models.find(option => option.id === model);
          const count = state.draftRoster[model];
          return <div key={model} className={`lineup-model ${count > 0 ? 'selected' : ''}`}>
            <ModelBuddy modelId={model} large />
            <div className="lineup-model-name"><h3>{model}</h3><p className="small muted">{connection?.modelId || 'No model connected'}</p></div>
            <div className="lineup-stepper" role="group" aria-label={`${model} agent count`}>
              <button type="button" aria-label={`Remove one ${model} agent`} disabled={count === 0 || starting} onClick={() => dispatch({ type: 'adjust-draft-count', model, delta: -1 })}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg></button>
              <output aria-label={`${model} agents`}>{count}</output>
              <button type="button" aria-label={`Add one ${model} agent`} disabled={total >= MAX_BENCHMARK_AGENTS || starting} onClick={() => dispatch({ type: 'adjust-draft-count', model, delta: 1 })}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M8 3v10" /></svg></button>
            </div>
            <p className={`lineup-connection small ${connection?.available ? 'muted' : 'unavailable'}`}>{!config ? 'Checking connection' : connection?.available ? 'Ready' : 'Not connected'}</p>
          </div>;
        })}</div>
      </section>
      <section aria-labelledby="scenario-heading">
        <h2 id="scenario-heading">Choose a scenario</h2>
        <label className="scenario-label" htmlFor="benchmark-scenario">Scenario</label>
        <select id="benchmark-scenario" className="scenario-select" value={scenario?.id ?? ''} disabled={starting || !config?.scenarios.length} onChange={event => dispatch({ type: 'select-draft-scenario', scenario: event.target.value })} aria-describedby="scenario-description">
          {!scenario && <option value="">{config ? 'Choose a supported scenario' : 'Waiting for benchmark runner…'}</option>}
          {config?.scenarios.map(option => <option key={option.id} value={option.id} disabled={option.available === false}>{option.name}{option.available === false ? ' · Unavailable' : ''}</option>)}
        </select>
        <article className="lobby-scenario-preview">
          {illustration && <figure className="lobby-scenario-art"><img src={illustration.src} alt={illustration.alt} width={2172} height={724} decoding="async" /><figcaption>Scenario illustration · Your selected lineup runs below.</figcaption></figure>}
          <h3>{scenario?.name ?? 'Scenario preview'}</h3>
          <p id="scenario-description">{scenario?.description ?? 'Connect to the benchmark runner to see supported scenarios and their rules.'}</p>
          {scenario?.available === false && <p className="small unavailable">{scenario.reason || 'This scenario is unavailable.'}</p>}
          <p className="small muted">{total} {total === 1 ? 'agent' : 'agents'} · {entries.length > 1 ? 'Mixed-model lineup' : entries.length ? 'Same-model lineup' : 'No lineup selected'} · One fresh world</p>
          <p className="small muted">Ethics and task performance are measured separately.</p>
          {scenario?.id.startsWith('clearing-') && <button className="text-link" onClick={onDetails}>Explore The Clearing ↗</button>}
        </article>
      </section>
    </div>
    <div className="benchmark-start"><div><strong>{rosterLabel(entries)} · {scenario?.name ?? 'Choose a scenario'}</strong><p className="small muted" id="launch-requirements">{activeJob ? activeJob.status === 'starting' ? 'Preparing your benchmark…' : 'Your benchmark is still running. Continue to return to it.' : blocker ?? 'Ready for fresh decisions and scores.'}</p></div><button className="button gold" disabled={checkingRun || (activeJob ? activeJob.status === 'starting' : !!blocker || starting)} aria-describedby="launch-requirements" onClick={onStart}>{checkingRun ? 'Checking benchmark…' : activeJob ? 'Continue benchmark' : starting ? 'Starting benchmark…' : 'Start benchmark'}</button></div>
    {error && <div role="alert" className="setup-error"><span>{error}</span><button className="text-link" disabled={starting} onClick={onRetry}>Retry connection</button></div>}
    {starting && <p role="status">Preparing a new world for {rosterLabel(entries)}…</p>}
  </main>;
}
