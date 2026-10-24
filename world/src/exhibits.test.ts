import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { EXHIBITS, exhibitHref } from './exhibits';
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
