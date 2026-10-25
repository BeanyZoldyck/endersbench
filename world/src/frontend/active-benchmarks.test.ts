import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BenchmarkResumeList } from './ui-ux/ActiveBenchmarks';
import type { BenchmarkJob } from './benchmark-client';
const job: BenchmarkJob = { id: 'resume-test', dbName: 'endersbench-run-resume-test', scenario: 'clearing-charter', status: 'running', model: 'ChatGPT', modelId: 'example', host: 'localhost' };
const render = (jobs: BenchmarkJob[]) => renderToStaticMarkup(createElement(BenchmarkResumeList, { jobs, error: '' }));
describe('returning to a benchmark', () => {
  it.each(['clearing-charter', 'ledger'])('resumes the same %s run and database', scenario => {
    const html = render([{ ...job, scenario }]);
    expect(html).toContain('Resume benchmark');
    expect(html).toContain('benchmark=resume-test');
    expect(html).toContain('db=endersbench-run-resume-test');
    expect(html).toContain(scenario === 'ledger' ? '/finance.html?' : '/?legacy=1');
  });
  it('keeps preparing runs visible without opening an unready viewer', () => {
    const html = render([{ ...job, status: 'starting' }]);
    expect(html).toContain('Preparing the simulation');
    expect(html).not.toContain('Resume benchmark');
  });
  it('changes the action to completed results when the runner finishes', () => {
    const html = render([{ ...job, status: 'completed' }]);
    expect(html).toContain('View completed benchmark');
    expect(html).toContain('studio=outcome');
    expect(html).not.toContain('Resume benchmark');
  });
  it('sends failed runs to history instead of promising a resumable simulation', () => {
    const html = render([{ ...job, status: 'failed' }]);
    expect(html).toContain('studio=compare');
    expect(html).not.toContain('Resume benchmark');
  });
});
