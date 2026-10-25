import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BenchmarkStore } from './store.js';
import { benchmarkConfig } from './config.js';
import { executeBenchmark } from './executor.js';
import { BenchmarkService } from './service.js';
import { createBenchmarkServer } from './http.js';

const store = new BenchmarkStore(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runs'));
const service = new BenchmarkService(() => benchmarkConfig(process.env), executeBenchmark, store);
createBenchmarkServer(service, store).listen(8790, '127.0.0.1', () => {
  process.stdout.write('Benchmark service listening at http://127.0.0.1:8790\n');
});
