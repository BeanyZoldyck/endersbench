const messages = {
  provider_auth: 'Model sign-in expired or was rejected. Sign in to the selected provider again, then start a new benchmark.',
  provider_timeout: 'The selected model did not respond in time. This benchmark is incomplete.',
  provider_failure: 'The selected model could not produce a decision. Check its connection before retrying.',
} as const;

export type FailureCode = keyof typeof messages;
export function failureCode(error: unknown): FailureCode {
  const message = error instanceof Error ? error.message : '';
  if (/refresh token|access token|unauthorized|unauthorised|authentication|invalid.api.key|sign in again|401\b/i.test(message)) return 'provider_auth';
  if (/timed out|timeout/i.test(message)) return 'provider_timeout';
  return 'provider_failure';
}
export class BenchmarkFailure extends Error {
  constructor(code: FailureCode) { super(messages[code]); }
}
export function failureFromLine(line: string): BenchmarkFailure | null {
  const code = line.replace(/^BENCHMARK_ERROR:/, '');
  return line.startsWith('BENCHMARK_ERROR:') && Object.hasOwn(messages, code)
    ? new BenchmarkFailure(code as FailureCode) : null;
}
