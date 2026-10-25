import { expect, it } from 'vitest';
import { canSubmitDecision, hasIncompleteDecisions } from './completion';

it('accepts a submitted action rejected by the world while rejecting provider failures', () => {
  expect(hasIncompleteDecisions([{status:'failed',action:'{"name":"gather"}',error:'that tree is empty'}])).toBe(false);
  expect(hasIncompleteDecisions([{status:'failed',action:'',error:'Model decision failed.'}])).toBe(true);
  expect(hasIncompleteDecisions([{status:'pending'}])).toBe(true);
  expect(hasIncompleteDecisions([{status:'expired',error:'no answer in time'}])).toBe(true);
  expect(hasIncompleteDecisions([{status:'expired',error:'agent died'}])).toBe(false);
});

it('drops late responses after knockout, removal, or shutdown', () => {
  expect(canSubmitDecision(false, {status:'pending'})).toBe(true);
  expect(canSubmitDecision(false, {status:'expired',error:'knocked out'})).toBe(false);
  expect(canSubmitDecision(false, undefined)).toBe(false);
  expect(canSubmitDecision(true, {status:'pending'})).toBe(false);
});
