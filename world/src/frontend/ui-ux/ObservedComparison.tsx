import { useState } from 'react';
import { showcaseGroups, showcaseModels, showcaseScore } from '../showcase-data';
import '../showcase.css';

export function ObservedComparison() {
  const [view, setView] = useState<'Reward-only' | 'Charter' | 'Showcase'>('Showcase');
  return <div className="comparison-browser">
    <nav className="tab-row comparison-tabs" aria-label="Comparison charts">{(['Reward-only', 'Charter', 'Showcase'] as const).map(tab => <button key={tab} aria-pressed={view === tab} className={view === tab ? 'active' : ''} onClick={() => setView(tab)}>{tab}</button>)}</nav>
    {view === 'Showcase' ? <ShowcaseChart /> : <BaselineCharts condition={view} />}
  </div>;
}

function ShowcaseChart() {
  return <section className="showcase" aria-labelledby="showcase-title">
    <header className="showcase-heading"><div><span className="showcase-eyebrow">MODEL COMPARISON</span><h1 id="showcase-title">ender1 Showcase</h1><p>Target-action match across 18 agentic ethics cases · Higher is better</p></div><span className="showcase-badge">Training-overlap showcase</span></header>
    <div className="showcase-legend">{showcaseModels.map(model => <span key={model.key}><i style={{ background: `linear-gradient(180deg, ${model.key === 'ender' ? '#ffe69b' : '#fff3cb'}, ${model.color})` }} />{model.label}</span>)}<span className="showcase-coverage">Counts = answered/total · Dashed = incomplete</span></div>
    <svg className="showcase-chart" viewBox="0 0 1100 390" role="img" aria-labelledby="showcase-chart-title showcase-chart-description">
      <defs>{showcaseModels.map(model => <linearGradient key={model.key} id={`showcase-${model.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={model.key === 'ender' ? '#ffe69b' : '#fff3cb'} /><stop offset="100%" stopColor={model.key === 'ender' ? '#bf903b' : '#b7a878'} /></linearGradient>)}</defs>
      <title id="showcase-chart-title">Target-action match by model and case category</title>
      <desc id="showcase-chart-description">Scores are percentages of answered cases, not all cases. {showcaseGroups.map(group => `${group.name}: ${showcaseModels.map(model => { const score = showcaseScore(model.key, group.key); return `${model.label} ${score.percent?.toFixed(1)} percent, ${score.correct} matches from ${score.valid} answered of ${score.total} cases`; }).join('; ')}.`).join(' ')}</desc>
      {[0,20,40,60,80,100].map(tick => <g key={tick}><line x1="52" x2="1080" y1={300-tick*2.5} y2={300-tick*2.5} className="showcase-grid"/><text x="40" y={305-tick*2.5} textAnchor="end">{tick}</text></g>)}
      {showcaseGroups.map((group, index) => <g key={group.key}>{showcaseModels.map((model, modelIndex) => {
        const score = showcaseScore(model.key, group.key);
        const height = (score.percent ?? 0) * 2.5;
        const x = 110 + index * 254 + modelIndex * 74;
        return <g key={model.key}><title>{`${model.label}: ${score.correct}/${score.valid} answered cases match; ${score.valid}/${score.total} cases answered`}</title><rect x={x} y={300-height} width="58" height={height} rx="5" fill={`url(#showcase-${model.key})`} fillOpacity={score.valid < score.total ? .65 : 1} stroke={model.color} strokeWidth="2" strokeDasharray={score.valid < score.total ? '5 4' : undefined}/><text className="showcase-score" x={x+29} y={288-height} textAnchor="middle">{score.percent === null ? '—' : `${Number(score.percent.toFixed(1))}%`}</text><text x={x+29} y="320" textAnchor="middle">{score.valid}/{score.total}</text></g>;
      })}<text className="showcase-category" x={176+index*254} y="350" textAnchor="middle">{group.name}</text><text x={176+index*254} y="373" textAnchor="middle">{group.total} cases</text></g>)}
    </svg>
    <div className="showcase-notes"><p><strong>Score:</strong> target-action matches ÷ answered cases. Ender: 15/17 matched; base: 7/7 matched. Coverage differs, so these rates are not a fair model ranking.</p><p>All 18 cases overlap the training data. This is not an independent benchmark. Frontier scores are absent from the supplied summary and are not plotted. Target-action match does not measure violation frequency.</p><p className="showcase-source">Source: supplied summary.json · Values follow the JSON, which differs from the reference image.</p></div>
  </section>;
}

function BaselineCharts({ condition }: { condition: 'Reward-only' | 'Charter' }) {
  const observed = { excess: condition === 'Charter' ? 42 : 54, rescued: 4 };
  const models = ['Ender', 'Grok', 'Claude', 'ChatGPT'];
  const selectedModel = 'ChatGPT';
  return <section className="baseline-comparison" aria-labelledby="baseline-title">
    <header className="showcase-heading"><div><span className="showcase-eyebrow">RECORDED BASELINE</span><h1 id="baseline-title">{condition}</h1><p>The Clearing · GPT-6-Luna · Rules v8 · 7 runs per condition</p></div></header>
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
    <p className="small muted">Ethics and task performance are measured separately. Other models have no matched observations here; missing results are not zero. These historical runs are separate from the training-overlap showcase.</p>
    <a className="text-link" href="/studio/observed-baseline.md" target="_blank" rel="noreferrer">Read the source report ↗</a>
  </section>;
}
