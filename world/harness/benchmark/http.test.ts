import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { BenchmarkStore } from './store';
import { BenchmarkService } from './service';
import { ReplayRecorder } from './recording';
import { createBenchmarkServer } from './http';

it('serves automatically recorded runs after a server restart and rejects non-local requests', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'benchmark-http-'));
  const config = async () => ({ ready: true, models: [{ id: 'Ender' as const, modelId: 'ender:test', available: true }] });
  const store = new BenchmarkStore(root);
  let service = new BenchmarkService(config, async job => {
    const recorder = new ReplayRecorder(path.join(root, job.id), job.dbName);
    recorder.capture([['world', [{ id: 0, gameTimeMs: 0 }]]], 0);
    return { success: true };
  }, store);
  let server = createBenchmarkServer(service, store);
  const listen = async (): Promise<void> => { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); };
  const close = async (): Promise<void> => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); };
  const call = (url: string, body?: string, origin?: string): Promise<{ status: number; bytes: Buffer }> => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: (server.address() as AddressInfo).port, path: url, method: body ? 'POST' : 'GET', headers: { host: '127.0.0.1:8790', ...(body ? { 'content-type': 'application/json' } : {}), ...(origin ? { origin } : {}) } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve({ status: res.statusCode!, bytes: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end(body);
  });
  await listen();
  try {
    const started = await call('/api/benchmarks', JSON.stringify({ model: 'Ender', scenario: 'clearing-charter' }));
    expect(started.status).toBe(202);
    const job = JSON.parse(started.bytes.toString());
    await new Promise(resolve => setTimeout(resolve, 20));
    await close();
    service = new BenchmarkService(config, async () => ({}), new BenchmarkStore(root));
    server = createBenchmarkServer(service, new BenchmarkStore(root));
    await listen();
    const history = JSON.parse((await call('/api/benchmarks/history')).bytes.toString());
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ model: 'Ender', id: job.id, status: 'completed' });
    const replay = await call(history[0].replayUrl);
    expect(replay.status).toBe(200);
    expect(JSON.parse(gunzipSync(replay.bytes).toString()).frames).toHaveLength(1);
    expect((await call('/api/benchmarks/history', undefined, 'https://untrusted.example')).status).toBe(403);
    expect((await call('/api/benchmarks/12345678-1234-1234-1234-123456789abc/replay')).status).toBe(404);
    expect((await call('/api/benchmarks/..%2F..%2Freport/replay')).status).toBe(404);
  } finally { await close(); }
});
