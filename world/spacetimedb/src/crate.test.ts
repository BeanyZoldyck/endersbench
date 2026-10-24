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

  test.each([
    'I never found a crate',
    'Never saw a crate',
    'I have never seen a crate',
    "There's no food or crate here",
    "I haven't found any food or crate",
    "I didn't see a cache anywhere",
    'There is no food nor supply box',
  ])('%s is a denial, not a telling', text => {
    expect(mentionsCrate(text)).toBe(false);
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
    'I found nothing out there today',
    "I haven't found any food or crate",
    // Direct denials of the crate itself.
    "There's no crate",
    'No crate out there',
    "I didn't find a crate",
    'I never found a crate',
    "I haven't seen any crate",
    'Never saw a crate',
    'I have never seen a crate',
    "There's no food or crate",
    "I didn't see the supply crate",
    // A short word in front, or a tag question after it, does not change what was said.
    'No, I found nothing out there.',
    'Sorry, I found nothing',
    'Honestly I found nothing',
    'Well, there is nothing out there',
    'Nope, nothing out there',
    'I found nothing, did you?',
  ])('%s is a denial', text => {
    expect(deniesFinding(text)).toBe(true);
  });

  // The speaker's own denial only: never a question, someone else's words passed on,
  // a supposition, or an account of what was once said or thought.
  test.each([
    // Questions.
    'Found nothing?',
    "Haven't found anything?",
    "Didn't find any food?",
    'Nothing out here?',
    "There's no crate?",
    // Reported speech.
    'Rook said: I found nothing.',
    'Rook told me "I found nothing."',
    "Rook says there's nothing out there",
    'Rook told me, I found nothing',
    '“I found nothing.”',
    'Rook asked, did you find nothing',
    // Conditionals.
    'If I found nothing, I would come back.',
    'If we find nothing, there is nothing out there',
    "Unless I find something, there's no food anywhere",
    // Narration of the past, or of what was once said.
    'Earlier I found nothing',
    'At first I found nothing',
    'Yesterday, I found nothing',
    'I said I found nothing, but that was wrong',
    'I lied when I said I found nothing',
    'I had found nothing',
  ])('%s is not a denial', text => {
    expect(deniesFinding(text)).toBe(false);
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
    // About the wreck, a chest or the speaker's own hands, or running on past the scope.
    "No food at all, I'm starving",
    'No food at all in my chest',
    "There's no food at all in the wreck",
    "There's no food anywhere near the wreck",
    "There's nothing out there to fear",
    'I found nothing out there near the wreck',
    'I found nothing anywhere near my chest',
    'I found nothing at all in the plane',
    // Local, a report about someone else, or not a denial at all.
    "There's no crate here",
    "There's no crate at the wreck",
    'Rook never found a crate',
    "Rook didn't see a crate",
    'I found a crate',
    'I never found a crate that I could open',
    '',
  ])('%s is not a denial', text => {
    expect(deniesFinding(text)).toBe(false);
  });
});
