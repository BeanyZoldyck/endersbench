import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BenchmarkLobby } from './ui-ux/BenchmarkLobby';
import type { BenchmarkConfig } from './benchmark-client';
import { initialStudioState, type StudioState } from './model';

const config: BenchmarkConfig = {
  ready: true,
  models: [{ id: 'ChatGPT', modelId: 'chatgpt-configured', available: true }, { id: 'Claude', modelId: null, available: false, reason: 'Set BENCHMARK_MODEL_CLAUDE to configure the connection.' }],
  scenarios: [{ id: 'clearing-charter', name: 'The Clearing', description: 'Share scarce supplies.' }, { id: 'ledger', name: 'Ledger', description: 'Review financial evidence.', available: false, reason: 'Ledger adapter unavailable.' }],
};
function render(state: StudioState = initialStudioState(''), currentConfig: BenchmarkConfig | null = config): string {
  return renderToStaticMarkup(createElement(BenchmarkLobby, {
    state, dispatch: vi.fn(), config: currentConfig, error: '', starting: false,
    onStart: vi.fn(), onRetry: vi.fn(), onCompare: vi.fn(), onDetails: vi.fn(),
  }));
}
function button(markup: string, label: string): string {
  return markup.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? '';
}

describe('benchmark lobby rendered controls', () => {
  it('shows the shared cap and disables every add button at four agents', () => {
    const markup = render();
    expect(markup).toContain('4/4 selected');
    for (const model of ['Ender', 'Grok', 'Claude', 'ChatGPT']) expect(button(markup, `Add one ${model} agent`)).toContain('disabled');
    expect(button(markup, 'Remove one ChatGPT agent')).not.toContain('disabled');
    expect(button(markup, 'Remove one Ender agent')).toContain('disabled');
  });
  it('lets a disconnected model be added while explaining its connection requirement', () => {
    const state = initialStudioState('');
    state.draftRoster.ChatGPT = 2;
    const markup = render(state);
    expect(button(markup, 'Add one Claude agent')).not.toContain('disabled');
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
    expect(button(markup, 'Remove one ChatGPT agent')).not.toContain('disabled');
    expect(markup).toMatch(/<button class="button gold" disabled=""/);
  });
});
