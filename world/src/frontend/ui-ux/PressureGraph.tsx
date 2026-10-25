import { useState } from 'react';
import type { StudioModel } from '../model';
import { PRESSURE_OBSERVATIONS } from '../pressure-comparison';

const models = [
  { name: 'ChatGPT', color: '#70c9a4', dash: '' },
  { name: 'Claude', color: '#df9a77', dash: '10 5' },
  { name: 'Grok', color: '#a5b7f0', dash: '3 5' },
  { name: 'Ender', color: '#e4c665', dash: '12 4 3 4' },
] as const;
const severities = ['All violations', 'Minor', 'Moderate', 'Severe'] as const;
type Severity = typeof severities[number];

// Deliberately synthetic display fixtures, never used for scoring or benchmark results.
export function previewRate(pressure: number, modelIndex: number, severity: Severity): number {
  const p = pressure / 100;
  const minor = 3 + 13 * p + modelIndex * p;
  const moderate = (12 + modelIndex * 2) * p ** 1.6;
  const severe = (13 + modelIndex * 3) * p ** 2.8;
  return severity === 'Minor' ? minor : severity === 'Moderate' ? moderate : severity === 'Severe' ? severe : minor + moderate + severe;
}

export function PressureGraph({ selectedModel, condition }: { selectedModel: StudioModel; condition: 'Reward-only' | 'Charter' }) {
  const [source, setSource] = useState<'preview' | 'recorded'>('preview');
  const [severity, setSeverity] = useState<Severity>('All violations');
  const [focus, setFocus] = useState<StudioModel | null>(null);
  const x = (value: number) => 76 + value * 7;
  const y = (value: number) => 328 - value * 4;
  const observations = PRESSURE_OBSERVATIONS[condition];
  return <section className="pressure-comparison" aria-labelledby="pressure-heading">
    <div className="pressure-heading"><div><span className="pressure-eyebrow">PRESSURE / BEHAVIOR</span><h3 id="pressure-heading">When pressure rises.</h3><p className="small muted">Compare violation frequency across a continuous survival-pressure scale.</p></div><span className="pressure-badge">{source === 'preview' ? 'Illustrative preview' : 'Recorded baseline'}</span></div>
    <div className="pressure-controls"><div className="tab-row" aria-label="Graph data source"><button aria-pressed={source === 'preview'} className={source === 'preview' ? 'active' : ''} onClick={() => setSource('preview')}>Model preview</button><button aria-pressed={source === 'recorded'} className={source === 'recorded' ? 'active' : ''} onClick={() => setSource('recorded')}>Recorded data</button></div>{source === 'preview' && <label>Severity <select value={severity} onChange={event => setSeverity(event.target.value as Severity)}>{severities.map(value => <option key={value}>{value}</option>)}</select></label>}</div>
    <p className="small muted" role="status">{source === 'preview' ? 'Synthetic example curves show the proposed comparison. These are not measured model results or rankings. Severity categories are illustrative.' : `${condition} · GPT-6-Luna · 7 runs. Points show rates in three pressure bands, positioned at band midpoints; horizontal lines show band coverage. Severity is not available in this summary.`}</p>
    <svg className="pressure-plot" viewBox="0 0 820 400" role="img" aria-labelledby="pressure-chart-title pressure-chart-description">
      <title id="pressure-chart-title">{`Pressure versus violations — ${source === 'preview' ? `illustrative ${severity.toLowerCase()}` : 'recorded GPT-6-Luna'}`}</title>
      <desc id="pressure-chart-description">Survival pressure from 0 to 100 percent on the horizontal axis. Violations per 100 exposed opportunities on the vertical axis. {source === 'preview' ? 'Four synthetic model curves rise with pressure to demonstrate the design, not measured behavior.' : observations.map((row, index) => `${['Low', 'Medium', 'High'][index]} pressure: ${row.taken} of ${row.exposed}, ${(row.taken / row.exposed * 100).toFixed(1)} percent.`).join(' ')}</desc>
      <text x="76" y="22" className="axis-title">Violations per 100 exposed opportunities</text>
      {[0, 20, 40, 60].map(tick => <g key={tick}><line x1="76" x2="776" y1={y(tick)} y2={y(tick)} className="pressure-grid"/><text x="58" y={y(tick) + 5} textAnchor="end">{tick}</text></g>)}
      {[0, 20, 40, 60, 80, 100].map(tick => <g key={tick}><line x1={x(tick)} x2={x(tick)} y1="52" y2="328" className="pressure-grid pressure-grid-vertical"/><text x={x(tick)} y="352" textAnchor="middle">{tick}%</text></g>)}
      <text x="426" y="389" textAnchor="middle" className="axis-title">Survival pressure →</text>
      {source === 'preview' ? models.map((model, index) => <polyline key={model.name} fill="none" stroke={model.color} strokeWidth={focus === model.name ? 4 : 2.5} strokeDasharray={model.dash} opacity={focus && focus !== model.name ? .2 : 1} points={Array.from({ length: 101 }, (_, pressure) => `${x(pressure)},${y(previewRate(pressure, index, severity))}`).join(' ')} />) : observations.map((row, index) => { const rate = row.taken / row.exposed * 100; return <g key={index} stroke="#70c9a4"><line x1={x(index * 100 / 3 + 1)} x2={x((index + 1) * 100 / 3 - 1)} y1={y(rate)} y2={y(rate)} strokeWidth="2"/><circle cx={x((index + .5) * 100 / 3)} cy={y(rate)} r="5" fill="#70c9a4"/><text stroke="none" x={x((index + .5) * 100 / 3)} y={y(rate) - 14} textAnchor="middle">{rate.toFixed(1)}%</text></g>; })}
    </svg>
    {source === 'preview' && <div className="pressure-legend" aria-label="Highlight a model curve">{models.map(model => <button key={model.name} aria-pressed={focus === model.name} onClick={() => setFocus(focus === model.name ? null : model.name)}><svg width="28" height="12" aria-hidden="true"><line x1="0" x2="28" y1="6" y2="6" stroke={model.color} strokeWidth="3" strokeDasharray={model.dash}/></svg>{model.name}{model.name === selectedModel ? ' · selected' : ''}</button>)}</div>}
    <p className="small muted">{source === 'preview' ? 'Select a legend item to highlight a model. Use the severity filter to compare minor, moderate, or severe violations.' : 'Pressure is the largest health, fullness, or warmth deficit. These pooled observations do not establish a causal trend; missing models are not zero.'}</p>
  </section>;
}
