import type { Dispatch } from 'react';
import { BENCHMARK_MODELS, MAX_BENCHMARK_AGENTS, rosterSize, seatDonor, type StudioAction, type StudioState } from '../model';
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

// Each scenario's card art, by scenario id (clearing-* share the Clearing's).
function scenarioArt(id: string) {
  if (id.startsWith('clearing-')) return '/studio/clearing-deepseek.png';
  if (id === 'ledger') return '/studio/ledger-deepseek.png';
  return null;
}

export function BenchmarkLobby({ state, dispatch, config, error, starting, activeJob: candidateJob, checkingRun = false, onStart, onRetry, onDetails }: LobbyProps) {
  const activeJob = candidateJob?.status === 'running' || candidateJob?.status === 'starting' ? candidateJob : null;
  const total = rosterSize(state.draftRoster);
  const entries = rosterEntries(state.draftRoster);
  const scenario = config?.scenarios.find(option => option.id === state.draftScenario);
  const blocker = benchmarkBlocker(config, state.draftRoster, state.draftScenario);
  const note = activeJob ? activeJob.status === 'starting' ? 'Preparing your benchmark…' : 'Your benchmark is still running. Continue to return to it.' : blocker;
  return <main className="studio-main setup-page compact-setup benchmark-lobby">
    <div className="page-head"><h1>Start a benchmark</h1></div>
    <div className="setup-grid">
      <section aria-labelledby="lineup-heading">
        <div className="lineup-heading"><h2 id="lineup-heading">Your lineup</h2><strong role="status" aria-live="polite" aria-atomic="true">{total}/{MAX_BENCHMARK_AGENTS} selected</strong></div>
        <div className="lineup-models" role="group" aria-label="Select agents">{BENCHMARK_MODELS.map(model => {
          const connection = config?.models.find(option => option.id === model);
          const count = state.draftRoster[model] ?? 0;
          // A full lineup can still add a model: it takes a seat from the largest other group.
          const canAdd = !!connection?.available && !starting && (total < MAX_BENCHMARK_AGENTS || seatDonor(state.draftRoster, model) !== null);
          const status = !config ? 'Checking connection' : connection?.available ? '' : connection?.reason === 'Not offered on this site.' ? connection.reason : 'Not connected';
          return <div key={model} className={`lineup-model ${count > 0 ? 'selected' : ''}`}>
            <ModelBuddy modelId={model} large />
            <div className="lineup-model-name"><h3>{model}</h3><p className="small muted">{connection?.modelId || status}</p></div>
            <div className="lineup-stepper" role="group" aria-label={`${model} agent count`}>
              <button type="button" aria-label={`Remove one ${model} agent`} disabled={count === 0 || starting} onClick={() => dispatch({ type: 'adjust-draft-count', model, delta: -1 })}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg></button>
              <output aria-label={`${model} agents`}>{count}</output>
              <button type="button" aria-label={`Add one ${model} agent`} disabled={!canAdd} onClick={() => dispatch({ type: 'adjust-draft-count', model, delta: 1 })}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M8 3v10" /></svg></button>
            </div>
            {status && connection?.modelId && <p className={`lineup-connection small ${config ? 'unavailable' : 'muted'}`}>{status}</p>}
          </div>;
        })}</div>
      </section>
      <section aria-labelledby="scenario-heading">
        <h2 id="scenario-heading">Choose a scenario</h2>
        {config?.scenarios.length
          ? <div className="scenario-choices" role="radiogroup" aria-labelledby="scenario-heading">{config.scenarios.map(option => {
            const art = scenarioArt(option.id);
            const unavailable = option.available === false;
            const selected = option.id === scenario?.id;
            return <label key={option.id} className={`scenario-choice ${selected ? 'selected' : ''} ${unavailable ? 'unavailable' : ''}`}>
              <input type="radio" name="benchmark-scenario" value={option.id} checked={selected} disabled={starting || unavailable} onChange={() => dispatch({ type: 'select-draft-scenario', scenario: option.id })} />
              {art && <img src={art} alt="" width={2172} height={724} decoding="async" />}
              <span className="scenario-choice-text"><strong>{option.name}</strong><span>{option.description}</span>{unavailable && <span className="unavailable">{option.reason || 'Unavailable right now.'}</span>}</span>
            </label>;
          })}</div>
          : <p className="small muted">{config ? 'This runner offers no scenarios.' : 'Waiting for benchmark runner…'}</p>}
        {scenario?.id.startsWith('clearing-') && <button className="text-link scenario-details" onClick={onDetails}>Explore The Clearing ↗</button>}
      </section>
    </div>
    <div className="benchmark-start"><div><strong>{rosterLabel(entries)} · {scenario?.name ?? 'Choose a scenario'}</strong>{note && <p className="small muted" id="launch-requirements">{note}</p>}</div><button className="button gold" disabled={checkingRun || (activeJob ? activeJob.status === 'starting' : !!blocker || starting)} aria-describedby={note ? 'launch-requirements' : undefined} onClick={onStart}>{checkingRun ? 'Checking benchmark…' : activeJob ? 'Continue benchmark' : starting ? 'Starting benchmark…' : 'Start benchmark'}</button></div>
    {error && <div role="alert" className="setup-error"><span>{error}</span><button className="text-link" disabled={starting} onClick={onRetry}>Retry connection</button></div>}
    {starting && <p role="status">Preparing a new world for {rosterLabel(entries)}…</p>}
  </main>;
}
