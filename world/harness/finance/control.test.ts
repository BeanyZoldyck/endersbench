import { afterEach, expect, test } from 'vitest';
import type { AddressInfo } from 'node:net';
import { financeControl } from './control';

const servers: ReturnType<typeof financeControl>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.close(); });
async function setup(repeat = 1) {
  const rows: { id: bigint; modelId: string; scenarioId: string; variant: string; status: string }[] = [];
  const queued: unknown[] = [];
  const server = financeControl({ host: 'ws://localhost:3012', database: 'test', models: ['codex:gpt-6-luna'], cases: ['lend-clean-approve'], repeat, ready: () => true, rows: () => rows,
    queue: async args => { queued.push(args); } });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/finance-control`;
  const body = { host: 'ws://localhost:3012', database: 'test', version: 6, scenarioId: 'lend-clean-approve', variant: 'charter' };
  const post = (override = {}) => fetch(url, { method: 'POST', headers: { 'X-Finance-Control': '1' }, body: JSON.stringify({ ...body, ...override }) });
  return { rows, queued, url, post };
}
test('queues the configured roster and prevents duplicates before subscription updates and while running', async () => {
  const { rows, queued, post } = await setup();
  expect((await post()).status).toBe(200);
  expect((await post()).status).toBe(409);
  rows.push({ id: 1n, modelId: 'codex:gpt-6-luna', scenarioId: 'lend-clean-approve', variant: 'charter', status: 'open' });
  expect((await post()).status).toBe(409);
  rows[0].status = 'closed';
  expect((await post()).status).toBe(200);
  expect(queued).toEqual(Array(2).fill({ modelId: 'codex:gpt-6-luna', variant: 'charter', repeat: 1, cases: 'lend-clean-approve' }));
});
test('rejects cross-origin simple requests, other databases, and unconfigured cases', async () => {
  const { queued, url, post } = await setup();
  expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(403);
  expect((await post({ database: 'other' })).status).toBe(409);
  expect((await post({ version: 5 })).status).toBe(409);
  expect((await post({ scenarioId: 'unknown' })).status).toBe(400);
  expect((await post({ variant: 'invented' })).status).toBe(400);
  expect(queued).toEqual([]);
});
test.each(['no-charter', 'principles', 'house-rules', 'charter'])('queues v6 %s without substituting another policy', async variant => {
  const { post, queued } = await setup();
  expect((await post({ variant })).status).toBe(200);
  expect(queued[0]).toMatchObject({ variant });
});
test('four-agent controls queue four samples again and wait for every subscription row', async () => {
  const { rows, queued, post } = await setup(4);
  expect((await post()).status).toBe(200);
  expect(queued[0]).toMatchObject({ repeat: 4 });
  rows.push({ id: 1n, modelId: 'codex:gpt-6-luna', scenarioId: 'lend-clean-approve', variant: 'charter', status: 'closed' });
  expect((await post()).status).toBe(409);
  for (const id of [2n, 3n, 4n]) rows.push({ ...rows[0], id });
  expect((await post()).status).toBe(200);
  expect(queued[1]).toMatchObject({ repeat: 4 });
});
