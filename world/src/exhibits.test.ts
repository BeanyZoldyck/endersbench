import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { EXHIBITS, exhibitHref, nextTourHref, tourStep } from './exhibits';
import { duration, parseReplay, startSeconds } from './replay';

describe('exhibits', () => {
  test.each(EXHIBITS.map(e => [e.title, e]))('"%s" opens a committed replay inside its recording', (_, exhibit) => {
    const href = exhibitHref(exhibit);
    const file = new URL(`../public${new URLSearchParams(href.slice(href.indexOf('?'))).get('replay')}`, import.meta.url);
    const replay = parseReplay(JSON.parse(gunzipSync(readFileSync(file)).toString()));
    expect(startSeconds(href.slice(href.indexOf('?'))) * 1000).toBeLessThan(duration(replay));
  });

  test('a link carries the replay and its start time', () => {
    expect(exhibitHref({ title: 'x', caption: 'y', replay: 'clearing-reward-v8', at: '0:12' })).toBe('/?replay=/demo/clearing-reward-v8.json.gz&t=0:12');
  });
});

describe('the booth tour', () => {
  test('?tour starts at the first exhibit, ?tour=N is the Nth', () => {
    expect(tourStep('?tour')).toBe(0);
    expect(tourStep('?replay=/demo/x.json.gz&t=1:00&tour=2')).toBe(2);
    expect(tourStep('?replay=/demo/x.json.gz')).toBeNull();
  });

  test('each step links to the next exhibit, and the last wraps to the first', () => {
    expect(nextTourHref(0)).toBe(`${exhibitHref(EXHIBITS[1])}&tour=1`);
    expect(nextTourHref(EXHIBITS.length - 1)).toBe(`${exhibitHref(EXHIBITS[0])}&tour=0`);
  });
});
