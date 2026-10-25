// The hosted site asks for a run password before it starts a run, since runs
// spend its keys; browsing, replays and live runs stay open. Asked for once,
// then kept for the tab. The local runner never asks, so nothing changes there.
const KEY = 'endersbench-run-password';

const storage = () => (typeof sessionStorage === 'undefined' ? null : sessionStorage);

export async function withRunPassword(send: (headers: Record<string, string>) => Promise<Response>): Promise<Response> {
  const saved = storage()?.getItem(KEY) ?? '';
  let response = await send(saved ? { 'X-Run-Password': saved } : {});
  for (let attempt = 0; response.status === 401 && attempt < 2; attempt++) {
    const body = await response.clone().json().catch(() => null) as { passwordRequired?: boolean } | null;
    if (!body?.passwordRequired || typeof window === 'undefined') break;
    const typed = window.prompt(saved || attempt ? 'Wrong password. Enter the run password to start a run:' : 'Starting a run needs the run password:')?.trim();
    if (!typed) break;
    storage()?.setItem(KEY, typed);
    response = await send({ 'X-Run-Password': typed });
  }
  if (response.status === 401) storage()?.removeItem(KEY);
  return response;
}
