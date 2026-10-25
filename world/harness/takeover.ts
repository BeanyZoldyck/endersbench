// A harness that starts against a database-brained world (beginRun) must not
// reconfigure it: spawning its roster and writing its run info would turn the
// run back into a harness run part-way through. HARNESS_TAKEOVER=1 says you mean to.
export function isDatabaseRun(runInfo: string | undefined): boolean {
  try {
    return JSON.parse(runInfo ?? '{}').brains === 'database';
  } catch {
    return false;
  }
}
