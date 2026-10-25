import { useState } from 'react';
import type { StudioModel } from '../model';

// Published matched baseline: results/latest/RESULTS.md, Primary comparison.
// These are prompt-condition observations for one exact model, not brand rankings.
const conditions = [
  { name: 'Reward-only', excess: 54, rescued: 4 },
  { name: 'Charter', excess: 42, rescued: 4 },
] as const;

export function ObservedComparison({ selectedModel }: { selectedModel: StudioModel }) {
  const [condition, setCondition] = useState<'Reward-only' | 'Charter'>('Charter');
  const observed = conditions.find(row => row.name === condition)!;
  const models: StudioModel[] = ['Ender', 'Grok', 'Claude', 'ChatGPT'];
  return <section className="observed-comparison" aria-labelledby="observed-heading">
    <header><h2 id="observed-heading">What we’ve observed</h2><p>Ethical behavior and task performance, measured separately.</p></header>
    <p className="comparison-selection" role="status">{selectedModel === 'ChatGPT'
      ? 'ChatGPT family selected. The baseline below is GPT-6-Luna; it does not represent every GPT model or the currently configured model.'
      : `${selectedModel} selected. No matched ${selectedModel} results are packaged here yet. The GPT-6-Luna baseline below is a reference, not a prediction for your selection.`}</p>
    <div className="tab-row" aria-label="Observed prompt condition">{conditions.map(row => <button key={row.name} className={condition === row.name ? 'active' : ''} aria-pressed={condition === row.name} onClick={() => setCondition(row.name)}>{row.name}</button>)}</div>
    <p className="small muted">The Clearing · Rules v8 · {condition} · 7 runs for GPT-6-Luna. Other models have no matched observations here.</p>
    <div className="observed-charts">
      <figure><figcaption><strong>Ethics-related behavior</strong><span>Rations taken beyond allocation · fewer is better</span></figcaption>
        {models.map(model => <div className={`observation-bar-row ${model === selectedModel ? 'selected' : ''}`} key={model}><span>{model === 'ChatGPT' ? 'GPT-6-Luna' : model}</span>{model === 'ChatGPT' ? <><div className="observation-bar-track" aria-hidden="true"><div style={{ width: `${observed.excess / 60 * 100}%` }} /></div><strong>{observed.excess}</strong></> : <span className="observation-missing">No matched data</span>}</div>)}
        <p className="small muted">Total across 7 runs per condition. This is one behavior measure, not an overall ethics score.</p>
      </figure>
      <figure><figcaption><strong>Task performance</strong><span>Runs with rescue · more is better</span></figcaption>
        {models.map(model => <div className={`observation-bar-row ${model === selectedModel ? 'selected' : ''}`} key={model}><span>{model === 'ChatGPT' ? 'GPT-6-Luna' : model}</span>{model === 'ChatGPT' ? <><div className="observation-bar-track" aria-hidden="true"><div style={{ width: `${observed.rescued / 7 * 100}%` }} /></div><strong>{observed.rescued}/7</strong></> : <span className="observation-missing">No matched data</span>}</div>)}
        <p className="small muted">Both conditions reached rescue in 4 of 7 runs. This measures the survival task, not general intelligence.</p>
      </figure>
    </div>
    <details className="inspector-extra"><summary>Model coverage and comparison conditions</summary>
      <div className="comparison-table-wrap"><table><caption>Available matched baseline in this checkout</caption><thead><tr><th scope="col">Model</th><th scope="col">Evidence</th></tr></thead><tbody>
        <tr><th scope="row">GPT-6-Luna</th><td>14 runs · two prompt conditions</td></tr>
        {(['Ender', 'Grok', 'Claude'] as const).map(model => <tr key={model}><th scope="row">{model}</th><td>No matched results packaged</td></tr>)}
      </tbody></table></div>
      <p>The Clearing · rules v8 · food 1× · unlimited rescue seats · time scale 0.5×. Reward-only and Charter each have 7 runs. These historical conditions may differ from a new run.</p>
      <p>The report found no clear difference in excess-ration totals (p = 0.23). Small samples do not establish a model ranking. Missing results are not zero.</p>
      <a className="text-link" href="/studio/observed-baseline.md" target="_blank" rel="noreferrer">Read the source report ↗</a>
    </details>
  </section>;
}
