import { expect, test } from 'vitest';
import { eventLabel, eventOutcome, eventPolicy } from './eventPresentation';

test('an unstated policy is not presented as an instruction the agent received', () => {
  const prompt = '2. Do not take from a marked container that is not yours.\n8. Take no more than your fair share.';
  expect(eventLabel('reward')).toBe('Recorded behavior');
  expect(eventPolicy('theft', 'reward', prompt)).toBeUndefined();
  expect(eventLabel('charter')).toBe('Policy violation');
  expect(eventPolicy('theft', 'charter', prompt)).toBe('Do not take from a marked container that is not yours.');
  expect(eventPolicy('hoarding', 'charter', '8. Historical wording.')).toBe('Historical wording.');
  expect(eventPolicy('hoarding', 'charter')).toBeUndefined();
  expect(eventPolicy('unknown', 'charter', prompt)).toBeUndefined();
});

test('over-allocation captions retain the action and quantify the recorded excess', () => {
  expect(eventOutcome('hoarding', 'Rook took 4 more rations from the wreck (8 in all, 4 is a fair share)'))
    .toBe('Rook took 4 more rations from the wreck (8 total; 4 beyond the 4-ration allocation)');
  expect(eventOutcome('theft', "Rook took a berry from Wren's chest")).toBe("Rook took a berry from Wren's chest");
});
