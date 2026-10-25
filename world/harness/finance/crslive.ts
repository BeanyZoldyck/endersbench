// The CRS sandbox, live. In a live run every CRS tool the agent calls goes to
// the sandbox as that persona's exact saved request (crs/personas.json). The
// response the agent is shown, the card the verifier scores and the RequestID
// CRS logged all come from that call, not from the Oct 24 snapshot. Each step
// records the call, and the card is compared with the snapshot's so a change
// in CRS's data (drift) is caught rather than scored against an old answer.
//
// Only persona bodies are ever sent: a body that doesn't match a persona goes
// to the real vendor, where it can fail or be billed. A failed login is never
// retried, since repeated failed logins disable the sandbox account. A failed
// call falls back to the snapshot's response, and the step says so.
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain ES module shared with crs/build-cards.mjs
import { credit, criminal, eviction, fraud, identity, publicRecords, reverse } from '../../../crs/card-from-crs.mjs';
import { type CrsAnswer, isCrsTool } from '../../spacetimedb/src/finance/engine';
import type { CrsCall, CrsTool, Step } from '../../spacetimedb/src/finance/types';
import { envValue } from './providers';
import { crsResponse, fixtureFile } from './rawcrs';

export const CRS_BASE_URL = 'https://api-sandbox.stitchcredit.com/api';

export interface PersonaRequest {
  product: string;
  variant: string;
  method: string;
  path: string;
  config?: string;
  body: unknown;
}

interface Persona {
  id: string;
  name: string; // as CRS holds it, upper case
  requests: PersonaRequest[];
}

let personas: Persona[] | undefined;
function personaById(id: string) {
  personas ??= (JSON.parse(fs.readFileSync(path.resolve('..', 'crs', 'personas.json'), 'utf-8')) as { personas: Persona[] }).personas;
  return personas.find(p => p.id === id);
}

// The fixture file name crs/snapshot.mjs gave each request.
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// The saved request behind one tool call, or undefined when the call names no
// persona or no bureau: the engine answers those with an error, and nothing is sent.
export function personaRequest(tool: CrsTool, args: Record<string, unknown>) {
  const persona = personaById(String(args.subject_id ?? ''));
  if (!persona) return undefined;
  const file = fixtureFile(tool, args);
  const request = persona.requests.find(r => `${r.product}-${slug(r.variant)}` === file);
  if (!request) return undefined;
  const urlPath = request.config ? request.path.replace('{config}', request.config) : request.path;
  return { persona, request, file, urlPath, endpoint: `${request.method} ${urlPath}` };
}

// One product response read the way engine.ts answers from a card, with the
// same reader build-cards.mjs used to make the cards.
export function cardPart(tool: CrsTool, args: Record<string, unknown>, response: unknown, personaName: string): unknown {
  switch (tool) {
    case 'pull_credit':
      return { bureau: args.bureau, ...credit(response) };
    case 'verify_identity':
      return identity(response);
    case 'check_fraud':
      return fraud(response);
    case 'search_public_records':
      return publicRecords(response);
    case 'criminal_check':
      return { records: criminal(response) };
    case 'eviction_check':
      return { records: eviction(response) };
    case 'reverse_lookup': {
      const r = reverse(response, personaName);
      return { records: r.match === 'none' ? [] : [{ name: r.name, city: r.city }] };
    }
  }
}

// Card fields whose values differ.
function drift(now: unknown, then: unknown): string[] {
  const a = (now ?? {}) as Record<string, unknown>;
  const b = (then ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

export interface CrsResponse {
  status: number;
  requestId: string | null;
  body: unknown;
  latencyMs: number;
}

export interface CrsClient {
  login(): Promise<void>;
  send(request: PersonaRequest): Promise<CrsResponse>;
}

export interface CrsClientOptions {
  username: string;
  password: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxInFlight?: number; // requests open at once, across every case of a run
  sleep?: (ms: number) => Promise<void>;
}

// One login per run, shared by every case in flight; a 401 later logs in once
// more, as crs/snapshot.mjs does. A 429 waits for the server's Retry-After.
export function crsClient(opts: CrsClientOptions): CrsClient {
  const base = opts.baseUrl ?? CRS_BASE_URL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const maxInFlight = opts.maxInFlight ?? 2;
  const sleep = opts.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let token: Promise<string> | undefined;
  let refreshed = false;

  function login() {
    token ??= (async () => {
      const res = await fetchImpl(`${base}/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: opts.username, password: opts.password }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        throw new Error(
          `CRS login failed (${res.status}): ${(await res.text()).slice(0, 200)}. Not retrying: repeated failed logins disable the sandbox account. Fix CRS_USERNAME and CRS_PASSWORD in endersbench/.env.`
        );
      }
      const t = ((await res.json()) as { token?: string }).token;
      if (!t) throw new Error('CRS login response had no token.');
      return t;
    })();
    return token;
  }

  let active = 0;
  const waiting: (() => void)[] = [];
  async function slot<T>(work: () => Promise<T>): Promise<T> {
    while (active >= maxInFlight) await new Promise<void>(resolve => waiting.push(resolve));
    active++;
    try {
      return await work();
    } finally {
      active--;
      waiting.shift()?.();
    }
  }

  return {
    login: async () => {
      await login();
    },
    send: request =>
      slot(async () => {
        const urlPath = request.config ? request.path.replace('{config}', request.config) : request.path;
        const started = performance.now();
        for (let attempt = 0; attempt < 5; attempt++) {
          const res = await fetchImpl(`${base}${urlPath}`, {
            method: request.method,
            headers: { Authorization: `Bearer ${await login()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(request.body),
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (res.status === 429) {
            await sleep(Number(res.headers.get('Retry-After') ?? 2) * 1000);
            continue;
          }
          // An expired token: log in once more per run.
          if (res.status === 401 && !refreshed) {
            refreshed = true;
            token = undefined;
            continue;
          }
          const text = await res.text();
          let body: unknown;
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
          return { status: res.status, requestId: res.headers.get('RequestID'), body, latencyMs: Math.round(performance.now() - started) };
        }
        throw new Error('CRS still rate limited after 5 tries');
      }),
  };
}

// The sandbox account from the environment or endersbench/.env.
export function crsClientFromEnv(opts: Omit<CrsClientOptions, 'username' | 'password'> = {}): CrsClient {
  const username = envValue('CRS_USERNAME');
  const password = envValue('CRS_PASSWORD');
  if (!username || !password) throw new Error('Live CRS needs CRS_USERNAME and CRS_PASSWORD in endersbench/.env (see .env.example).');
  return crsClient({ username, password, ...opts });
}

export type LiveCrs = (tool: string, args: Record<string, unknown>) => Promise<CrsAnswer | undefined>;

// Answers CRS tool calls from the live sandbox. With `raw` the agent is
// shown CRS's full response, as with --raw-crs; otherwise the card read from it.
export function liveCrs(client: CrsClient, opts: { raw?: boolean } = {}): LiveCrs {
  return async (tool, args) => {
    if (!isCrsTool(tool)) return undefined;
    const found = personaRequest(tool, args);
    if (!found) return undefined;
    const name = found.persona.name;
    const saved = crsResponse(found.persona.id, found.file);
    const snapshot = cardPart(tool, args, saved, name);
    const at = new Date().toISOString();
    const started = performance.now();
    const fallback = (error: string, res?: CrsResponse): CrsAnswer => ({
      result: snapshot,
      ...(opts.raw ? { raw: saved } : {}),
      crs: {
        source: 'snapshot',
        endpoint: found.endpoint,
        requestId: res?.requestId ?? null,
        status: res?.status ?? null,
        latencyMs: res?.latencyMs ?? Math.round(performance.now() - started),
        at,
        error,
      },
    });
    let res: CrsResponse;
    try {
      res = await client.send(found.request);
    } catch (err) {
      return fallback(err instanceof Error ? err.message : String(err));
    }
    // Credit reports report their own failures (a deceased or frozen file) as
    // HTTP 200 with errorMessages; those are answers, read like any other.
    if (res.status !== 200) return fallback(`HTTP ${res.status}`, res);
    let result: unknown;
    try {
      result = cardPart(tool, args, res.body, name);
    } catch (err) {
      return fallback(`unreadable response: ${err instanceof Error ? err.message : String(err)}`, res);
    }
    const changed = drift(result, snapshot);
    const crs: CrsCall = {
      source: 'live',
      endpoint: found.endpoint,
      requestId: res.requestId,
      status: res.status,
      latencyMs: res.latencyMs,
      at,
      ...(changed.length ? { drift: changed } : {}),
    };
    return { result, ...(opts.raw ? { raw: res.body } : {}), crs };
  };
}

// The CRS calls behind a set of case runs, for a run's summary.
export function crsSummary(runs: Step[][]) {
  const calls = runs.flatMap(steps => steps.flatMap(s => (s.crs ? [s.crs] : [])));
  const live = calls.filter(c => c.source === 'live');
  const ms = live.map(c => c.latencyMs).sort((a, b) => a - b);
  const at = (q: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] : null);
  return {
    calls: calls.length,
    live: live.length,
    fellBack: calls.length - live.length,
    drifted: live.filter(c => c.drift?.length).length,
    driftFields: [...new Set(live.flatMap(c => c.drift ?? []))],
    medianMs: at(0.5),
    p95Ms: at(0.95),
    errors: [...new Set(calls.flatMap(c => (c.error ? [c.error] : [])))].slice(0, 5),
  };
}
