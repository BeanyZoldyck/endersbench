export type StudioScreen = 'landing' | 'models' | 'setup' | 'single' | 'briefing' | 'monitor' | 'follow' | 'outcome' | 'lending' | 'compare' | 'context' | 'method';
import { ALL_MODEL_NAMES, SELECTABLE_MODELS, isModelName, type ModelName } from '../../shared/models';
export type StudioModel = ModelName;
export type BenchmarkRoster = Partial<Record<StudioModel, number>>;
export const MAX_BENCHMARK_AGENTS = 4;
export const BENCHMARK_MODELS: StudioModel[] = SELECTABLE_MODELS;
export function rosterSize(roster: BenchmarkRoster): number {
  return ALL_MODEL_NAMES.reduce((total, model) => total + (roster[model] ?? 0), 0);
}
// Who gives up a seat when a full lineup adds another model: the largest other group, if any.
export function seatDonor(roster: BenchmarkRoster, adding: StudioModel): StudioModel | null {
  let donor: StudioModel | null = null;
  for (const model of ALL_MODEL_NAMES) if (model !== adding && (roster[model] ?? 0) > (donor ? roster[donor] ?? 0 : 0)) donor = model;
  return donor;
}
export type Scenario = 'clearing' | 'lending';
export type StudioSnapshot = Pick<StudioState, 'screen' | 'runId' | 'selectedAgentId' | 'eventIndex' | 'replayTimeMs' | 'briefingScenario' | 'contextTab' | 'compareScenario' | 'comparePair'>;
export type StudioState = {
  screen: StudioScreen;
  previous: StudioSnapshot[];
  draftModel: StudioModel;
  draftRoster: BenchmarkRoster;
  draftScenario: string;
  draftMode: 'swarm' | 'single';
  briefingScenario: Scenario;
  runId: string;
  selectedAgentId: string | null;
  eventIndex: number;
  replayTimeMs: number;
  restoreNonce: number;
  playing: boolean;
  contextTab: 'graph' | 'details';
  historyModel: 'all' | StudioModel;
  compareScenario: 'all' | Scenario;
  comparePair: [StudioModel, StudioModel];
  pendingComparePair: [StudioModel, StudioModel] | null;
  landingSection: 'top' | 'scenarios' | 'results' | 'evidence';
  previewTab: Scenario;
};
export type StudioAction =
  | { type: 'navigate'; screen: StudioScreen; timeMs?: number }
  | { type: 'back'; fallback?: StudioScreen }
  | { type: 'select-draft-model'; model: StudioModel }
  | { type: 'adjust-draft-count'; model: StudioModel; delta: -1 | 1 }
  | { type: 'select-draft-scenario'; scenario: string }
  | { type: 'select-draft-mode'; mode: 'swarm' | 'single' }
  | { type: 'select-briefing-scenario'; scenario: Scenario }
  | { type: 'select-run'; runId: string }
  | { type: 'history-model'; model: 'all' | StudioModel }
  | { type: 'select-agent'; agentId: string | null }
  | { type: 'select-event'; index: number }
  | { type: 'replay'; command: 'previous' | 'next' | 'stop' | 'play' | 'pause'; count: number }
  | { type: 'context-tab'; tab: 'graph' | 'details' }
  | { type: 'compare-scenario'; scenario: 'all' | Scenario }
  | { type: 'begin-model-change' }
  | { type: 'pending-model'; slot: 0 | 1; model: StudioModel }
  | { type: 'apply-model-change' }
  | { type: 'cancel-model-change' }
  | { type: 'landing-section'; section: StudioState['landingSection'] }
  | { type: 'preview-tab'; scenario: Scenario };

const snapshot = (state: StudioState): StudioSnapshot => ({
  screen: state.screen, runId: state.runId, selectedAgentId: state.selectedAgentId,
  eventIndex: state.eventIndex, replayTimeMs: state.replayTimeMs, briefingScenario: state.briefingScenario,
  contextTab: state.contextTab, compareScenario: state.compareScenario,
  comparePair: state.comparePair,
});

export function replayEventIndex(eventCount: number, currentIndex: number, direction: 'previous' | 'next' | 'stop'): number {
  if (eventCount <= 0) return 0;
  const current = Math.min(eventCount - 1, Math.max(0, currentIndex));
  if (direction === 'stop') return 0;
  return direction === 'previous' ? Math.max(0, current - 1) : Math.min(eventCount - 1, current + 1);
}

export function initialStudioState(search: string): StudioState {
  const params = new URLSearchParams(search);
  const route = params.get('studio');
  const known: StudioScreen[] = ['landing', 'models', 'setup', 'single', 'briefing', 'monitor', 'follow', 'outcome', 'lending', 'compare', 'context', 'method'];
  const screen = known.includes(route as StudioScreen) ? route as StudioScreen : params.has('replay') || params.has('live') ? 'monitor' : 'landing';
  const replayName = params.get('replay')?.match(/\/demo\/([a-z0-9-]+)\.json(?:\.gz)?$/)?.[1];
  return {
    screen, previous: [], draftModel: 'GPT-6 Luna', draftRoster: {}, draftScenario: 'clearing-charter', draftMode: 'swarm', briefingScenario: 'clearing',
    runId: params.get('run') || replayName || 'clearing-charter-v8-admission', selectedAgentId: null,
    eventIndex: 0, replayTimeMs: 0, restoreNonce: 0, playing: false,
    historyModel: isModelName(params.get('historyModel')) ? params.get('historyModel') as StudioModel : 'all', contextTab: params.get('view') === 'details' ? 'details' : 'graph', compareScenario: 'all',
    comparePair: ['Ender', 'Grok'], pendingComparePair: null, landingSection: 'top', previewTab: 'clearing',
  };
}

export function recordedStudioHref(
  screen: StudioScreen,
  runId?: string,
  atMs?: number,
  view?: 'graph' | 'details',
): string {
  const params = new URLSearchParams({ studio: screen });
  if (runId) params.set('run', runId);
  if (atMs !== undefined && Number.isFinite(atMs) && atMs >= 0) params.set('t', String(atMs / 1000));
  if (view) params.set('view', view);
  return `/?${params.toString()}`;
}

export function requiresRecordedSource(screen: StudioScreen): boolean {
  return screen === 'landing' || screen === 'models' || screen === 'setup' || screen === 'single'
    || screen === 'briefing' || screen === 'lending';
}

export function transitionStudio(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case 'navigate': return action.screen === state.screen ? state : {
      ...state, screen: action.screen, draftMode: action.screen === 'setup' ? 'swarm' : state.draftMode, replayTimeMs: action.timeMs ?? state.replayTimeMs,
      previous: [...state.previous, { ...snapshot(state), replayTimeMs: action.timeMs ?? state.replayTimeMs }], playing: false,
    };
    case 'back': {
      const previous = state.previous[state.previous.length - 1];
      return previous ? { ...state, ...previous, previous: state.previous.slice(0, -1), restoreNonce: state.restoreNonce + 1, playing: false } : { ...state, screen: action.fallback ?? 'compare', restoreNonce: state.restoreNonce + 1, playing: false };
    }
    case 'select-draft-model': return { ...state, draftModel: action.model, draftRoster: { [action.model]: Math.max(1, rosterSize(state.draftRoster)) } };
    case 'adjust-draft-count': {
      if (action.delta === -1 && (state.draftRoster[action.model] ?? 0) <= 0) return state;
      const roster = { ...state.draftRoster };
      if (action.delta === 1 && rosterSize(roster) >= MAX_BENCHMARK_AGENTS) {
        // A full lineup gives up a seat from its largest other group, so + always does something visible.
        const donor = seatDonor(roster, action.model);
        if (!donor) return state;
        roster[donor] = (roster[donor] ?? 0) - 1;
      }
      roster[action.model] = (roster[action.model] ?? 0) + action.delta;
      return { ...state, draftRoster: Object.fromEntries(Object.entries(roster).filter(([, count]) => (count ?? 0) > 0)) };
    }
    case 'select-draft-scenario': return { ...state, draftScenario: action.scenario };
    case 'select-draft-mode': return { ...state, draftMode: action.mode, screen: action.mode === 'single' ? 'single' : 'setup', playing: false };
    case 'select-briefing-scenario': return { ...state, briefingScenario: action.scenario };
    case 'history-model': return { ...state, historyModel: action.model };
    case 'select-run': return { ...state, runId: action.runId, eventIndex: 0, replayTimeMs: 0, selectedAgentId: null, briefingScenario: 'clearing', playing: false };
    case 'select-agent': return { ...state, selectedAgentId: action.agentId };
    case 'select-event': return { ...state, eventIndex: Math.max(0, action.index), playing: false };
    case 'replay': {
      if (action.command === 'pause') return { ...state, playing: false };
      if (action.command === 'play') return action.count <= 0 ? { ...state, playing: false } : { ...state, playing: true, eventIndex: state.eventIndex >= action.count - 1 ? 0 : state.eventIndex };
      return { ...state, eventIndex: replayEventIndex(action.count, state.eventIndex, action.command), playing: false };
    }
    case 'context-tab': return { ...state, contextTab: action.tab };
    case 'compare-scenario': return { ...state, compareScenario: action.scenario };
    case 'begin-model-change': return { ...state, pendingComparePair: [...state.comparePair] };
    case 'pending-model': {
      if (!state.pendingComparePair) return state;
      const pair: [StudioModel, StudioModel] = [...state.pendingComparePair];
      pair[action.slot] = action.model;
      return { ...state, pendingComparePair: pair };
    }
    case 'apply-model-change': return state.pendingComparePair && state.pendingComparePair[0] !== state.pendingComparePair[1]
      ? { ...state, comparePair: state.pendingComparePair, pendingComparePair: null } : state;
    case 'cancel-model-change': return { ...state, pendingComparePair: null };
    case 'landing-section': return { ...state, landingSection: action.section };
    case 'preview-tab': return { ...state, previewTab: action.scenario };
  }
}
