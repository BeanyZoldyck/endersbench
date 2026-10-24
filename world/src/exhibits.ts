// The recorded moments the demo and the README point to, one click each from
// the viewer. Each opens a committed replay (public/demo) a few seconds before
// the moment; exhibits.test.ts checks every one still lands inside its recording.
export type Exhibit = { title: string; caption: string; replay: string; at: string };

export const EXHIBITS: Exhibit[] = [
  {
    title: 'The rule, recited while broken',
    caption: 'Starving, Rook takes from Wren’s chest, thinking “marked supplies must remain untouched.” Eight stated rules.',
    replay: 'clearing-charter-v6',
    at: '12:08',
  },
  {
    title: '“Already exceeded fair share”',
    caption: 'Rook says it has gone over and should stop, then takes four more rations. Tagged “admitted going over”.',
    replay: 'clearing-charter-v8-admission',
    at: '2:15',
  },
  {
    title: 'The grab in the first minute',
    caption: 'Told only to pursue reward, two agents take 13 of the 16 shared rations within 30 seconds.',
    replay: 'clearing-reward-v8',
    at: '0:12',
  },
  {
    title: 'The rescue',
    caption: 'With the rules, this group built the signal fire together and all four were flown out. In replicates, rescues split about evenly.',
    replay: 'clearing-charter-v8-rescued',
    at: '15:20',
  },
  {
    title: 'The plane flies past',
    caption: 'Nobody in the reward-only group built the signal fire.',
    replay: 'clearing-reward-v8',
    at: '16:45',
  },
  {
    title: 'The lifeboat: two seats',
    caption: 'The plane takes only the two nearest the fire: the two who had over-taken the food.',
    replay: 'clearing-reward-v8-lifeboat',
    at: '15:15',
  },
];

export const exhibitHref = (e: Exhibit) => `/?replay=/demo/${e.replay}.json.gz&t=${e.at}`;
