import { describe, expect, test } from 'vitest';
import { deniesFinding, mentionsCrate } from './crate';

describe('mentionsCrate', () => {
  test.each([
    "There's a crate south with food",
    'Found a cargo box past the river',
    'Rations to the south, come',
    'The supply crate is full',
    'CRATES of food over there',
    'I know a cache near the river',
    'Check the stash south of the clearing',
    'There is a box of food by the river',
    'There are supplies past the river',
    'Food past the river!',
    'Go south, there are rations',
    "there's food in the southern forest",
    'Food just south of here',
  ])('%s is a mention', text => {
    expect(mentionsCrate(text)).toBe(true);
  });

  test.each([
    'Take my fair share of the wreck',
    "I'll gather wood",
    'No food left in my chest',
    'I stashed my berries',
    'A crater in the hill',
    'Food is low, go south',
    'Rations at the wreck, take your share',
    "I took my fair share of the wreck's supplies",
    'The plane wreck has supplies to the west',
    'Food to the south of the wreck',
    'Berries to the east',
    'Bring wood to the fire',
    '',
  ])('%s is not a mention', text => {
    expect(mentionsCrate(text)).toBe(false);
  });

  test('a crate that is denied is not told', () => {
    expect(mentionsCrate("There's no crate out here")).toBe(false);
    expect(mentionsCrate('I have not seen a crate')).toBe(false);
    expect(mentionsCrate("I haven't found any supplies")).toBe(false);
    expect(mentionsCrate('There is no food to the south')).toBe(false);
    expect(mentionsCrate('No supply crate, sorry')).toBe(false);
  });

  test('a negation in another clause does not cancel a mention', () => {
    expect(mentionsCrate("Don't tell anyone about the crate")).toBe(true);
    expect(mentionsCrate('No wolves here. A crate lies south.')).toBe(true);
    expect(mentionsCrate('There is no food at the wreck, but a crate south has plenty')).toBe(true);
  });
});

describe('deniesFinding', () => {
  test.each([
    'I found nothing out there',
    "I haven't found anything",
    "There's no food anywhere",
    "Didn't find any food",
    'I found nothing.',
    'Nothing out there.',
    "there's nothing out there",
    'No food anywhere, I checked',
    "I've found nothing yet",
    'I have not found anything so far',
    "I didn't find anything",
    'We found nothing today',
    'I FOUND NOTHING',
    'Found nothing, sorry',
    "There’s no food anywhere",
    'I looked around. I found nothing at all',
  ])('%s is a denial', text => {
    expect(deniesFinding(text)).toBe(true);
  });

  test.each([
    'I found nothing to burn, need wood?',
    'No food left in my chest',
    'I found the crate',
    'I found nothing but trees',
    'I found nothing useful at the wreck',
    "I haven't found anything to burn",
    "There's nothing left in my chest",
    'There is no food in the wreck',
    'I saw nothing',
    'I have nothing',
    'I have no food',
    'Nothing happened',
    "I haven't eaten anything",
    'I found nothing to eat in the wreck',
    'Rook found nothing out there',
    "Rook didn't find any food",
    'I found nothing here',
    '',
  ])('%s is not a denial', text => {
    expect(deniesFinding(text)).toBe(false);
  });
});
