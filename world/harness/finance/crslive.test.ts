import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { policyFollower, runBrain } from '../../spacetimedb/src/finance/brains';
import { execute } from '../../spacetimedb/src/finance/engine';
import { gateCase } from '../../spacetimedb/src/finance/gate';
import { SCENARIOS, SCENARIO_BY_ID } from '../../spacetimedb/src/finance/scenarios';
import type { CrsTool } from '../../spacetimedb/src/finance/types';
import { verify } from '../../spacetimedb/src/finance/verifier';
import { cardPart, crsClient, crsSummary, liveCrs, personaRequest } from './crslive';
import { scriptDriver } from './drivers';
import { TEST_CASES } from './labels';
import { crsResponse } from './rawcrs';

const FIXTURES = path.resolve('..', 'crs', 'fixtures');
const PERSONAS = Array.from({ length: 20 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`);
const CALLS: [CrsTool, Record<string, unknown>][] = [
  ['pull_credit', { bureau: 'transunion' }],
  ['pull_credit', { bureau: 'equifax' }],
  ['pull_credit', { bureau: 'experian' }],
  ['verify_identity', {}],
  ['check_fraud', {}],
  ['search_public_records', {}],
  ['criminal_check', {}],
  ['eviction_check', {}],
  ['reverse_lookup', {}],
];

// Every saved exchange, keyed by what was sent: path and body.
type Saved = { path: string; request: unknown; response: unknown; requestId: string };
const saved = new Map<string, Saved>();
for (const id of PERSONAS) {
  for (const f of fs.readdirSync(path.join(FIXTURES, id))) {
    const s = JSON.parse(fs.readFileSync(path.join(FIXTURES, id, f), 'utf-8')) as Saved;
    saved.set(`${s.path} ${JSON.stringify(s.request)}`, s);
  }
}

// A stand-in for the sandbox that answers each persona request with its saved
// response, and records what it was sent.
function fakeSandbox(opts: { login?: () => Response; answer?: (s: Saved) => Response } = {}) {
  const sent: { url: string; auth: string | null; body: string }[] = [];
  let logins = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/users/login')) {
      logins++;
      return opts.login?.() ?? Response.json({ token: `token-${logins}` });
    }
    const body = String(init?.body);
    sent.push({ url: u, auth: new Headers(init?.headers).get('Authorization'), body });
    const s = saved.get(`${u.replace(/^.*\/api/, '')} ${body}`);
    if (!s) return new Response('not a persona request', { status: 400 });
    return opts.answer?.(s) ?? new Response(JSON.stringify(s.response), { status: 200, headers: { RequestID: `live-${s.requestId}` } });
  }) as typeof fetch;
  return { fetchImpl, sent, logins: () => logins };
}

const client = (fetchImpl: typeof fetch) => crsClient({ username: 'u', password: 'p', fetchImpl, sleep: async () => {} });
const anyCase = SCENARIOS[0];

describe('live CRS', () => {
  test('sends each tool call as the persona’s exact saved request', () => {
    for (const id of PERSONAS) {
      for (const [tool, extra] of CALLS) {
        const found = personaRequest(tool, { subject_id: id, ...extra });
        expect(found, `${id} ${tool}`).toBeDefined();
        const s = saved.get(`${found!.urlPath} ${JSON.stringify(found!.request.body)}`);
        expect(s, `${id} ${tool} ${JSON.stringify(extra)}`).toBeDefined();
      }
    }
    expect(saved.size).toBe(PERSONAS.length * CALLS.length);
  });

  test('sends nothing for an unknown person or bureau', () => {
    expect(personaRequest('pull_credit', { subject_id: 'P99', bureau: 'transunion' })).toBeUndefined();
    expect(personaRequest('pull_credit', { subject_id: 'P01', bureau: 'innovis' })).toBeUndefined();
    expect(personaRequest('verify_identity', {})).toBeUndefined();
  });

  test('reads every saved response to exactly the card the engine answers with', () => {
    for (const id of PERSONAS) {
      for (const [tool, extra] of CALLS) {
        const args = { subject_id: id, ...extra };
        const found = personaRequest(tool, args)!;
        expect(cardPart(tool, args, crsResponse(id, found.file), found.persona.name), `${id} ${tool}`).toEqual(execute(anyCase, tool, args));
      }
    }
  });

  test('answers from the sandbox, with the call recorded and no drift', async () => {
    const sandbox = fakeSandbox();
    const live = liveCrs(client(sandbox.fetchImpl));
    const args = { subject_id: 'P13', bureau: 'equifax' };
    const answer = (await live('pull_credit', args))!;
    expect(answer.result).toEqual(execute(anyCase, 'pull_credit', args));
    expect(answer.raw).toBeUndefined();
    expect(answer.crs).toMatchObject({ source: 'live', status: 200, endpoint: 'POST /equifax/credit-report/standard/efx-prequal-vantage4' });
    expect(answer.crs.requestId).toMatch(/^live-/);
    expect(answer.crs.drift).toBeUndefined();
    expect(sandbox.sent).toHaveLength(1);
    expect(sandbox.sent[0].auth).toBe('Bearer token-1');
    // Not a CRS tool, or an unknown person: no call.
    expect(await live('approve_loan', { amount: 1, apr: 1 })).toBeUndefined();
    expect(await live('check_fraud', { subject_id: 'nobody' })).toBeUndefined();
    expect(sandbox.sent).toHaveLength(1);
  });

  test('shows the full response in raw mode', async () => {
    const live = liveCrs(client(fakeSandbox().fetchImpl), { raw: true });
    const answer = (await live('verify_identity', { subject_id: 'P12' }))!;
    expect(answer.raw).toEqual(crsResponse('P12', 'tu_identity_verification-tu-identity'));
  });

  test('scores what CRS says now, and flags where it moved from the snapshot', async () => {
    const sandbox = fakeSandbox({
      answer: s => {
        const r = structuredClone(s.response) as { risk: { score: number } };
        r.risk.score = 12;
        return new Response(JSON.stringify(r), { status: 200, headers: { RequestID: 'r1' } });
      },
    });
    const answer = (await liveCrs(client(sandbox.fetchImpl))('check_fraud', { subject_id: 'P13' }))!;
    expect(answer.result).toMatchObject({ score: 12, band: 'low' });
    expect(answer.crs.source).toBe('live');
    expect(answer.crs.drift).toEqual(['score', 'band']);
  });

  test('falls back to the snapshot when a call fails, and says so', async () => {
    const down = fakeSandbox({ answer: () => new Response('busy', { status: 503, headers: { RequestID: 'r2' } }) });
    const a = (await liveCrs(client(down.fetchImpl))('search_public_records', { subject_id: 'P07' }))!;
    expect(a.result).toEqual(execute(anyCase, 'search_public_records', { subject_id: 'P07' }));
    expect(a.crs).toMatchObject({ source: 'snapshot', status: 503, requestId: 'r2', error: 'HTTP 503' });

    const offline = crsClient({ username: 'u', password: 'p', fetchImpl: (async () => { throw new Error('fetch failed'); }) as typeof fetch });
    const b = (await liveCrs(offline)('criminal_check', { subject_id: 'P09' }))!;
    expect(b.result).toEqual(execute(anyCase, 'criminal_check', { subject_id: 'P09' }));
    expect(b.crs).toMatchObject({ source: 'snapshot', status: null, error: 'fetch failed' });
  });

  test('logs in once for many calls, never retries a failed login, and re-logs in once after a 401', async () => {
    const sandbox = fakeSandbox();
    const live = liveCrs(client(sandbox.fetchImpl));
    await Promise.all(PERSONAS.slice(0, 6).map(id => live('verify_identity', { subject_id: id })));
    expect(sandbox.logins()).toBe(1);

    const refused = fakeSandbox({ login: () => new Response('bad password', { status: 401 }) });
    const c = client(refused.fetchImpl);
    await expect(c.login()).rejects.toThrow(/Not retrying/);
    const after = (await liveCrs(c)('check_fraud', { subject_id: 'P01' }))!;
    expect(after.crs.source).toBe('snapshot');
    expect(refused.logins()).toBe(1);
    expect(refused.sent).toHaveLength(0);

    let first = true;
    const expiring = fakeSandbox({
      answer: s => {
        if (first) {
          first = false;
          return new Response('expired', { status: 401 });
        }
        return new Response(JSON.stringify(s.response), { status: 200 });
      },
    });
    const renewed = (await liveCrs(client(expiring.fetchImpl))('eviction_check', { subject_id: 'P11' }))!;
    expect(renewed.crs.source).toBe('live');
    expect(expiring.logins()).toBe(2);
    expect(expiring.sent.map(s => s.auth)).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  test('Script A plays the held-out cases on live answers exactly as on the snapshot, with every call recorded', async () => {
    const live = liveCrs(client(fakeSandbox().fetchImpl));
    const run = scriptDriver(policyFollower, { live });
    const runs = [];
    for (const id of TEST_CASES) {
      const scenario = SCENARIO_BY_ID[id];
      const { steps } = await run(scenario, 'house-rules');
      const offline = runBrain(policyFollower, scenario);
      expect(steps.map(s => ({ ...s, crs: undefined })), id).toEqual(offline.map(s => ({ ...s, crs: undefined })));
      expect(gateCase(scenario, steps), id).toEqual(gateCase(scenario, offline));
      expect(verify(scenario, steps), id).toEqual(verify(scenario, offline));
      runs.push(steps);
    }
    const summary = crsSummary(runs);
    expect(summary.calls).toBeGreaterThan(TEST_CASES.length);
    expect(summary).toMatchObject({ live: summary.calls, fellBack: 0, drifted: 0 });
  });
});
