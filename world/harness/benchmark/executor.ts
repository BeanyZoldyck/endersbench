import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executable } from './config.js';
import type { Executor } from './service.js';

const worldDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const startupTimeoutMs = 120_000;
const maxRuntimeMs = 90 * 60_000;

function boundedRuntime(value: string | undefined): number {
  const number = Number(value ?? 45 * 60_000);
  return Number.isFinite(number) ? Math.max(60_000, Math.min(maxRuntimeMs, number)) : 45 * 60_000;
}

function run(command: string, args: string[], timeoutMs: number, onLine?: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: worldDir, env: process.env, stdio: ['ignore', 'pipe', 'ignore'], shell: false });
    let settled = false;
    let timedOut = false;
    let output = '';
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 5_000);
      child.once('close', () => clearTimeout(force));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-4096);
      const lines = output.split('\n');
      output = lines.pop() ?? '';
      for (const line of lines) onLine?.(line.trim());
    });
    child.once('error', () => finish(new Error('Runner process could not start.')));
    child.once('close', code => finish(timedOut ? new Error('Runner timed out.') : code === 0 ? undefined : new Error('Runner process failed.')));
  });
}

export const executeBenchmark: Executor = async (job, onRunning) => {
  const bin = await executable(process.env);
  if (!bin) throw new Error('SpacetimeDB CLI unavailable.');
  const modulePath = path.join(worldDir, 'spacetimedb');
  // The random database name is never supplied by the client. Never republish with data deletion.
  await run(bin, ['publish', job.dbName, '--module-path', modulePath, '--server', 'http://127.0.0.1:3000', '--anonymous', '--no-config', '--delete-data=never', '--yes'], startupTimeoutMs);
  const worker = path.join(worldDir, 'dist-harness', 'benchmark-worker.js');
  await run(process.execPath, [worker, job.id, job.dbName, job.modelId], boundedRuntime(process.env.BENCHMARK_RUNTIME_TIMEOUT_MS), line => {
    if (line === 'BENCHMARK_RUNNING') onRunning();
  });
  const file = path.join(worldDir, 'runs', job.id, 'report.json');
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
};
