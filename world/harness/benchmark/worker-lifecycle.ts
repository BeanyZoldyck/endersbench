import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function processIdentity(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (fields[0] === 'Z') return null;
    return `${readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${fields[19]}`;
  } catch { return null; }
}
export function markWorker(directory: string, pid: number): void {
  const identity = processIdentity(pid);
  if (!identity) throw new Error('Could not identify benchmark worker.');
  writeFileSync(path.join(directory, 'worker.json'), JSON.stringify({ pid, identity }));
}
export function workerAlive(directory: string): boolean {
  try {
    const marker = JSON.parse(readFileSync(path.join(directory, 'worker.json'), 'utf8')) as { pid: number; identity: string };
    return Number.isInteger(marker.pid) && marker.pid > 0 && processIdentity(marker.pid) === marker.identity;
  } catch { return false; }
}
