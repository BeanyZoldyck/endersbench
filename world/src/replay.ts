export type ReplayIdentity = { hex: string };
export type ReplayRow = Record<string, unknown>;
export type ReplayTables = Record<string, ReplayRow[]>;

export type ReplayFrame = {
  t: number;
  gameTimeMs: number;
  tables: ReplayTables;
};

export type ReplayEvent = {
  t: number;
  table: 'hit_event' | 'transfer_event' | 'world_event';
  row: ReplayRow;
};

export type Replay = {
  version: 1;
  db: string;
  recordedAt: string;
  frames: ReplayFrame[];
  events: ReplayEvent[];
};

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKey(value: RecordValue, key: string): boolean {
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === key;
}

function decimal(value: unknown, wrapper: string): bigint {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
    throw new Error(`Invalid ${wrapper} replay value`);
  }
  return BigInt(value);
}

export function encode(value: unknown): unknown {
  if (typeof value === 'bigint') return { $big: value.toString() };
  if (Array.isArray(value)) return value.map(encode);
  if (!isRecord(value)) return value;

  const micros = value.microsSinceUnixEpoch;
  if (typeof micros === 'bigint') return { $ts: micros.toString() };

  const toHexString = value.toHexString;
  if (typeof toHexString === 'function') {
    return { $id: (toHexString as () => string).call(value) };
  }

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
}

export function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (!isRecord(value)) return value;

  if (hasOnlyKey(value, '$big')) return decimal(value.$big, '$big');
  if (hasOnlyKey(value, '$ts')) return decimal(value.$ts, '$ts');
  if (hasOnlyKey(value, '$id')) {
    if (typeof value.$id !== 'string') throw new Error('Invalid $id replay value');
    return { hex: value.$id } satisfies ReplayIdentity;
  }

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
}

function expectRecord(value: unknown, label: string): RecordValue {
  if (!isRecord(value)) throw new Error(`Invalid replay ${label}`);
  return value;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid replay ${label}`);
  return value;
}

function expectNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid replay ${label}`);
  return value;
}

function parseTables(value: unknown, label: string): ReplayTables {
  const source = expectRecord(value, label);
  return Object.fromEntries(Object.entries(source).map(([name, rows]) => {
    if (!Array.isArray(rows)) throw new Error(`Invalid replay ${label}.${name}`);
    return [name, rows.map((row, index) => expectRecord(row, `${label}.${name}[${index}]`))];
  }));
}

function parseFrames(value: unknown): ReplayFrame[] {
  if (!Array.isArray(value)) throw new Error('Invalid replay frames');
  // Recordings made with a wall clock can step backwards; order by time
  // (stably) rather than reject them.
  return value.map((item, index) => {
    const frame = expectRecord(item, `frames[${index}]`);
    const t = expectNumber(frame.t, `frames[${index}].t`);
    return {
      t,
      gameTimeMs: expectNumber(frame.gameTimeMs, `frames[${index}].gameTimeMs`),
      tables: parseTables(frame.tables, `frames[${index}].tables`),
    };
  }).map((frame, index) => ({ frame, index })).sort((a, b) => a.frame.t - b.frame.t || a.index - b.index).map(({ frame }) => frame);
}

function parseEvents(value: unknown): ReplayEvent[] {
  if (!Array.isArray(value)) throw new Error('Invalid replay events');
  return value.map((item, index) => {
    const event = expectRecord(item, `events[${index}]`);
    const table = event.table;
    if (table !== 'hit_event' && table !== 'transfer_event' && table !== 'world_event') {
      throw new Error(`Invalid replay events[${index}].table`);
    }
    return {
      t: expectNumber(event.t, `events[${index}].t`),
      table,
      row: expectRecord(event.row, `events[${index}].row`),
    };
  });
}

export function parseReplay(json: unknown): Replay {
  const encoded = expectRecord(json, 'document');
  if (encoded.version !== 1) throw new Error(`Unsupported replay version: ${String(encoded.version)}`);
  const replay = expectRecord(decode(encoded), 'document');
  return {
    version: 1,
    db: expectString(replay.db, 'db'),
    recordedAt: expectString(replay.recordedAt, 'recordedAt'),
    frames: parseFrames(replay.frames),
    events: parseEvents(replay.events),
  };
}

export function frameAt(replay: Replay, tMs: number): ReplayFrame {
  const tables: ReplayTables = {};
  let t = 0;
  let gameTimeMs = 0;
  for (const frame of replay.frames) {
    if (frame.t > tMs) break;
    t = frame.t;
    gameTimeMs = frame.gameTimeMs;
    Object.assign(tables, frame.tables);
  }
  return { t, gameTimeMs, tables };
}

export function eventsBetween(replay: Replay, fromMs: number, toMs: number): ReplayEvent[] {
  return replay.events.filter(event => event.t > fromMs && event.t <= toMs);
}

export function duration(replay: Replay): number {
  let result = 0;
  for (const frame of replay.frames) result = Math.max(result, frame.t);
  for (const event of replay.events) result = Math.max(result, event.t);
  return result;
}
