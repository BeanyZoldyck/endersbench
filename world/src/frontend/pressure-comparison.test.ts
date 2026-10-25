import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PRESSURE_BANDS, PRESSURE_OBSERVATIONS } from './pressure-comparison';
import { ObservedComparison } from './ui-ux/ObservedComparison';

const report = readFileSync(new URL('../../public/studio/observed-baseline.md', import.meta.url), 'utf8');
describe('pressure comparison evidence', () => {
  it.each(['Reward-only', 'Charter'] as const)('matches every pressure band to the exact %s report condition', condition => {
    const prompt = condition === 'Charter' ? 'charter' : 'reward';
    const prefix = `| codex:gpt-6-luna | ${prompt} · time 0.5x · rules v8 |`;
    const section = report.split('## Exploratory event rate by survival pressure')[1];
    const row = section.split('\n').find(line => line.startsWith(prefix));
    expect(row).toBeDefined();
    const cells = row!.slice(prefix.length).split('|').filter(cell => cell.trim());
    expect(cells).toHaveLength(PRESSURE_BANDS.length);
    PRESSURE_OBSERVATIONS[condition].forEach((observation, index) => {
      expect(cells[index]).toContain(`(${observation.taken}/${observation.exposed};`);
      expect(cells[index]).toContain(`${(observation.taken / observation.exposed * 100).toFixed(1)}%`);
    });
  });
  it('opens the illustrative graph from a third comparison control', () => {
    const html = renderToStaticMarkup(createElement(ObservedComparison, { selectedModel: 'Claude' }));
    expect(html).toContain('Illustrative preview');
    expect(html).toContain('These are not measured model results or rankings.');
    expect(html).toContain('Survival pressure →');
    expect(html).toContain('Violations per 100 exposed opportunities');
    expect(html).toContain('Severe');
    expect(html).toContain('aria-pressed="true">Pressure → violations</button>');
    expect(html.indexOf('Charter</button>')).toBeLessThan(html.indexOf('Pressure → violations</button>'));
    expect(html).not.toContain('Ethics-related behavior');
  });
});
