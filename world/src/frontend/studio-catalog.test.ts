import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseReplay, duration } from '../replay';
import { stateAt } from '../useReplay';
import { RUNS, benchmarkRuns } from './catalog';

describe('benchmark model attribution', () => {
  it.each(RUNS)('$id matches its recorded model', run => {
    const replay = parseReplay(JSON.parse(gunzipSync(readFileSync(new URL(`../../public/demo/${run.id}.json.gz`, import.meta.url))).toString()) as unknown);
    const agents = stateAt(replay, duration(replay)).agents;
    expect(agents.length).toBeGreaterThan(0);
    expect([...new Set(agents.map(agent => agent.modelId))]).toEqual([run.modelId]);
  });
  it('lists the complete supported queue', () => {
    expect(benchmarkRuns('ChatGPT')).toHaveLength(RUNS.length);
    expect(benchmarkRuns('Ender')).toEqual([]);
  });
});
