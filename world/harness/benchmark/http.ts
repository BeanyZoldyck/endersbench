import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { benchmarkConfig } from './config.js';
import { BenchmarkService, RequestError } from './service.js';
import { BenchmarkStore } from './store.js';

const allowedOrigin = new Set([
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:5179', 'http://127.0.0.1:5179',
  'http://localhost:8790', 'http://127.0.0.1:8790',
]);

function send(response: ServerResponse, code: number, value: unknown): void {
  response.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<unknown> {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new RequestError(415, 'Expected application/json.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += data.length;
    if (size > 1024) throw new RequestError(413, 'Request body is too large.');
    chunks.push(data);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new RequestError(400, 'Invalid JSON.'); }
}

export function createBenchmarkServer(service: BenchmarkService, store: BenchmarkStore) {
return createServer((request, response) => {
  void (async () => {
    const host = request.headers.host;
    const origin = request.headers.origin;
    if (!host || !/^(localhost|127\.0\.0\.1):8790$/.test(host) || origin && !allowedOrigin.has(origin)) {
      send(response, 403, { error: 'Local requests only.' });
      return;
    }
    const url = new URL(request.url ?? '/', 'http://localhost:8790');
    if (request.method === 'GET' && url.pathname === '/api/benchmarks/config') {
      send(response, 200, await benchmarkConfig(process.env));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/benchmarks') {
      send(response, 202, await service.start(await body(request)));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/benchmarks') {
      send(response, 200, service.list());
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/benchmarks/history') {
      service.list(); // Recover any interrupted worker that has now finished its final writes.
      send(response, 200, store.history());
      return;
    }
    const replay = /^\/api\/benchmarks\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/replay$/.exec(url.pathname);
    if (request.method === 'GET' && replay) {
      const bytes = store.replay(replay[1]);
      if (!bytes) { send(response, 404, { error: 'Recording not found.' }); return; }
      response.writeHead(200, { 'content-type': 'application/gzip', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(bytes);
      return;
    }
    const match = /^\/api\/benchmarks\/([a-f0-9-]{36})$/.exec(url.pathname);
    if (request.method === 'GET' && match) {
      const job = service.get(match[1]);
      send(response, job ? 200 : 404, job ?? { error: 'Benchmark not found.' });
      return;
    }
    send(response, 404, { error: 'Route not found.' });
  })().catch(error => {
    const status = error instanceof RequestError ? error.statusCode : 500;
    send(response, status, { error: error instanceof RequestError ? error.message : 'Benchmark service error.' });
  });
});
}
