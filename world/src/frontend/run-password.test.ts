import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withRunPassword } from './run-password';

const asked = (status = 401) => new Response(JSON.stringify({ error: 'Starting a run needs the run password.', passwordRequired: true }), { status });
const ok = () => new Response('{}', { status: 202 });

let stored: Record<string, string>;
beforeEach(() => {
  stored = {};
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => { stored[k] = v; }, removeItem: (k: string) => { delete stored[k]; } });
});
afterEach(() => vi.unstubAllGlobals());

describe('withRunPassword', () => {
  it('sends nothing extra where no password is asked for (the local runner)', async () => {
    const send = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('window', { prompt: vi.fn() });
    expect((await withRunPassword(send)).status).toBe(202);
    expect(send).toHaveBeenCalledWith({});
  });

  it('asks once when the site wants the password, retries with it, and remembers it for the tab', async () => {
    const send = vi.fn().mockResolvedValueOnce(asked()).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    const prompt = vi.fn().mockReturnValue(' quiet-harbor-27 ');
    vi.stubGlobal('window', { prompt });
    expect((await withRunPassword(send)).status).toBe(202);
    expect(send).toHaveBeenLastCalledWith({ 'X-Run-Password': 'quiet-harbor-27' });
    await withRunPassword(send);
    expect(send).toHaveBeenLastCalledWith({ 'X-Run-Password': 'quiet-harbor-27' });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('forgets a wrong password, and gives up when the visitor cancels', async () => {
    stored['endersbench-run-password'] = 'old';
    const send = vi.fn().mockResolvedValue(asked());
    vi.stubGlobal('window', { prompt: vi.fn().mockReturnValueOnce('still-wrong').mockReturnValueOnce(null) });
    expect((await withRunPassword(send)).status).toBe(401);
    expect(stored['endersbench-run-password']).toBeUndefined();
  });
});
