import { Children, createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BenchmarkLobby } from './ui-ux/BenchmarkLobby';
import type { BenchmarkConfig, BenchmarkJob } from './benchmark-client';
import { BENCHMARK_MODELS, initialStudioState, type StudioState } from './model';

const config: BenchmarkConfig = {
  ready: true,
  models: [{ id: 'GPT-6 Luna', modelId: 'chatgpt-configured', available: true }, { id: 'Claude 5.5', modelId: null, available: false, reason: 'Set BENCHMARK_MODEL_CLAUDE to configure the connection.' }],
  scenarios: [{ id: 'clearing-charter', name: 'The Clearing', description: 'Share scarce supplies.' }, { id: 'ledger', name: 'Ledger', description: 'Review financial evidence.', available: false, reason: 'Ledger adapter unavailable.' }],
};
type LobbyProps = ComponentProps<typeof BenchmarkLobby>;

function render(state: StudioState = initialStudioState(''), currentConfig: BenchmarkConfig | null = config, overrides: Partial<LobbyProps> = {}): string {
  return renderToStaticMarkup(createElement(BenchmarkLobby, {
    state, dispatch: vi.fn(), config: currentConfig, error: '', starting: false,
    onStart: vi.fn(), onRetry: vi.fn(), onDetails: vi.fn(), ...overrides,
  }));
}
function button(markup: string, label: string): string {
  return markup.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? '';
}

describe('benchmark lobby rendered controls', () => {
  it('prevents a new launch until existing runs have been checked', () => {
    const markup = render(initialStudioState(''), config, { checkingRun: true });
    expect(markup).toMatch(/<button class="button gold" disabled=""[^>]*>Checking benchmark…<\/button>/);
  });
  it('shows the shared cap and disables every add button at four agents', () => {
    const markup = render();
    expect(markup).toContain('4/4 selected');
    for (const model of BENCHMARK_MODELS) expect(button(markup, `Add one ${model} agent`)).toContain('disabled');
    expect(button(markup, 'Remove one GPT-6 Luna agent')).not.toContain('disabled');
    expect(button(markup, 'Remove one Ender agent')).toContain('disabled');
  });
  it('disables adding a disconnected model while explaining its connection requirement', () => {
    const state = initialStudioState('');
    state.draftRoster['GPT-6 Luna'] = 2;
    const markup = render(state);
    expect(button(markup, 'Add one Claude 5.5 agent')).toContain('disabled');
    expect(markup).toContain('Not connected');
    expect(markup).not.toContain('BENCHMARK_MODEL_CLAUDE');
    expect(markup).toContain('2/4 selected');
  });
  it('renders only the configured scenarios, with the supported description and disabled unavailable option', () => {
    const markup = render();
    expect(markup).toContain('Share scarce supplies.');
    expect(markup).toMatch(/<option value="ledger" disabled="">Ledger/);
    expect(markup).not.toContain('Lending Desk');
  });
  it('shows a selected unavailable scenario truthfully without a Clearing illustration', () => {
    const state = { ...initialStudioState(''), draftScenario: 'ledger' };
    const markup = render(state);
    expect(markup).toContain('Review financial evidence.');
    expect(markup).toContain('Ledger adapter unavailable.');
    expect(markup).not.toContain('clearing-mascots-concept');
    expect(markup).toMatch(/<button class="button gold" disabled=""/);
  });
  it('keeps lineup controls usable while runner configuration is unavailable', () => {
    const markup = render(initialStudioState(''), null);
    expect(markup).toContain('Waiting for benchmark runner');
    expect(markup).toContain('Checking connection');
    expect(button(markup, 'Remove one GPT-6 Luna agent')).not.toContain('disabled');
    expect(markup).toMatch(/<button class="button gold" disabled=""/);
  });
});


const job: BenchmarkJob = {
  id: 'lobby-run', status: 'running', model: 'GPT-6 Luna', modelId: 'chatgpt-configured',
  scenario: 'clearing-charter', dbName: 'endersbench-run-lobby-run', host: 'ws://localhost:3000',
};

function launchButton(markup: string): string {
  const match = markup.match(/<button class="button gold"[^>]*>[^<]*<\/button>/);
  expect(match, 'The primary benchmark action should be present').not.toBeNull();
  return match![0];
}

function findPrimaryAction(node: ReactNode): ReactElement<{ className?: string; onClick?: () => void }> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ className?: string; children?: ReactNode; onClick?: () => void }>(child)) continue;
    if (child.type === 'button' && child.props.className === 'button gold') return child;
    const found = findPrimaryAction(child.props.children);
    if (found) return found;
  }
  return undefined;
}

describe('benchmark lobby Start and Continue actions', () => {
  it('offers an enabled Start action for a connected lineup and scenario', () => {
    const markup = render();
    expect(launchButton(markup)).toContain('Start benchmark');
    expect(launchButton(markup)).not.toContain('disabled');
    expect(markup).toContain('Ready for fresh decisions and scores.');
  });

  it('locks lineup edits, scenario changes, retries and launch while creating a fresh world', () => {
    const markup = render(initialStudioState(''), config, { starting: true, error: 'Reconnect pending.' });
    expect(launchButton(markup)).toContain('Starting benchmark…');
    expect(launchButton(markup)).toContain('disabled');
    expect(markup).toContain('Preparing a new world for 4 GPT-6 Luna…');
    expect(button(markup, 'Remove one GPT-6 Luna agent')).toContain('disabled');
    expect(markup).toMatch(/<select[^>]*id="benchmark-scenario"[^>]*disabled=""/);
    expect(markup).toMatch(/<button class="text-link" disabled="">Retry connection/);
  });

  it.each([
    ['runner configuration is unavailable', null, initialStudioState('')],
    ['the draft scenario is unavailable', config, { ...initialStudioState(''), draftScenario: 'ledger' }],
    ['the draft lineup is empty', config, { ...initialStudioState(''), draftRoster: { Ender: 0, 'GLM 5.3': 0, 'Claude 5.5': 0, 'GPT-6 Luna': 0 } }],
    ['the draft model is disconnected', config, { ...initialStudioState(''), draftRoster: { Ender: 0, 'GLM 5.3': 0, 'Claude 5.5': 1, 'GPT-6 Luna': 0 } }],
  ] as const)('keeps a running benchmark resumable when %s', (_reason, currentConfig, state) => {
    const markup = render(state, currentConfig, { activeJob: job });
    expect(launchButton(markup)).toContain('Continue benchmark');
    expect(launchButton(markup)).not.toContain('disabled');
    expect(markup).toContain('Your benchmark is still running. Continue to return to it.');
  });

  it('shows a disabled Continue action while an existing benchmark is starting', () => {
    const markup = render(initialStudioState(''), null, { activeJob: { ...job, status: 'starting' } });
    expect(launchButton(markup)).toContain('Continue benchmark');
    expect(launchButton(markup)).toContain('disabled');
    expect(markup).toContain('Preparing your benchmark…');
    expect(markup).not.toContain('Your benchmark is still running.');
  });

  it.each(['completed', 'failed'] as const)('offers a fresh Start action after a %s job', status => {
    const markup = render(initialStudioState(''), config, { activeJob: { ...job, status } });
    expect(launchButton(markup)).toContain('Start benchmark');
    expect(launchButton(markup)).not.toContain('disabled');
    expect(markup).not.toContain('Your benchmark is still running.');
  });

  it('uses the supplied primary action without opening a preview or dispatching draft navigation', () => {
    const onStart = vi.fn();
    const dispatch = vi.fn();
    const tree = BenchmarkLobby({
      state: initialStudioState(''), dispatch, config, error: '', starting: false, activeJob: job,
      onStart, onRetry: vi.fn(), onDetails: vi.fn(),
    });
    const action = findPrimaryAction(tree);
    expect(action).toBeDefined();
    action!.props.onClick!();
    expect(onStart).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
