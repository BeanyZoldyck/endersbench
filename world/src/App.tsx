import { useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { DbConnection, tables } from './module_bindings';
import type { Agent } from './module_bindings/types.ts';
import { WorldScene } from './scene/WorldScene.tsx';

const FEED_SIZE = 12;

export default function App() {
  const { isActive, identity, getConnection } = useSpacetimeDB();
  const conn = getConnection() as DbConnection | null;

  const [worlds] = useTable(tables.world);
  const [agents] = useTable(tables.agent);
  const [nodes] = useTable(tables.resourceNode);
  const [containers] = useTable(tables.container);
  const [items] = useTable(tables.item);
  const [messages] = useTable(tables.message);
  const [pending] = useTable(tables.decisionRequest.where(r => r.status.eq('pending')));
  const [log] = useTable(tables.actionLog);

  const world = worlds[0];
  const me = agents.find(a => a.controller && identity && a.controller.isEqual(identity));
  const thinking = new Set(pending.map(r => r.agentId));
  const names = new Map(agents.map(a => [a.id, a.name]));
  const feed = [...log].sort((a, b) => b.gameTimeMs - a.gameTimeMs).slice(0, FEED_SIZE);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Ender's Bench</h1>
        <span className={isActive ? 'status on' : 'status off'}>{isActive ? 'live' : 'connecting…'}</span>
        {world && (
          <span className="clock">
            game {(world.gameTimeMs / 1000).toFixed(1)} s · tick {String(world.tick)} · {world.timeScale}x
            {!world.running && ' · paused'}
          </span>
        )}
      </header>
      <main className="layout">
        <section className="stage">
          {world ? (
            <WorldScene
              world={world}
              agents={agents}
              messages={messages}
              thinking={thinking}
              nodes={nodes}
              containers={containers}
              items={items}
              meId={me?.id}
              onClickTile={(x, y) => me && conn?.reducers.humanMoveTo({ x, y }).catch(console.error)}
            />
          ) : (
            <p className="empty">Waiting for the world…</p>
          )}
          <HumanControls conn={conn} me={me} />
        </section>
        <aside className="rail">
          <h2>Agents</h2>
          {agents.length === 0 && <p className="empty">No agents yet. Start the harness.</p>}
          {[...agents]
            .sort((a, b) => Number(a.id - b.id))
            .map(a => (
              <div key={String(a.id)} className="card">
                <div className="card-head">
                  <span className="dot" style={{ background: a.color }} />
                  <strong>{a.name}</strong>
                  <span className="model">{a.modelId}</span>
                </div>
                <div className="card-body">
                  {thinking.has(a.id) ? <em>thinking…</em> : describe(a, names)}
                </div>
                {a.thought && <div className="thought">“{a.thought}”</div>}
              </div>
            ))}
          <h2>Decisions</h2>
          <ol className="feed">
            {feed.map(entry => (
              <li key={String(entry.id)} className={entry.ok ? '' : 'bad'}>
                <span className="who">{names.get(entry.agentId) ?? '?'}</span> {summarize(entry.action)}
                {!entry.ok && <span className="err"> · {entry.error}</span>}
              </li>
            ))}
          </ol>
        </aside>
      </main>
    </div>
  );
}

function describe(a: Agent, names: Map<bigint, string>) {
  switch (a.intentKind) {
    case 'move_to':
      return `walking to (${a.targetX.toFixed(0)}, ${a.targetY.toFixed(0)})`;
    case 'follow':
      return `following ${names.get(a.targetAgentId) ?? 'someone'}`;
    default:
      return 'idle';
  }
}

function summarize(raw: string) {
  try {
    const { name, args } = JSON.parse(raw);
    if (name === 'say') return `said “${args.text}”`;
    if (name === 'move_to') return `moves to (${Number(args.x).toFixed(0)}, ${Number(args.y).toFixed(0)})`;
    if (name === 'follow') return `follows #${args.agent_id}`;
    return name;
  } catch {
    return raw;
  }
}

function HumanControls({ conn, me }: { conn: DbConnection | null; me?: Agent }) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  if (!conn) return null;
  if (!me) {
    return (
      <form
        className="controls"
        onSubmit={e => {
          e.preventDefault();
          if (name.trim()) conn.reducers.joinAsHuman({ name: name.trim() }).catch(console.error);
        }}
      >
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" maxLength={24} />
        <button type="submit">Join the world</button>
      </form>
    );
  }
  return (
    <form
      className="controls"
      onSubmit={e => {
        e.preventDefault();
        if (text.trim()) conn.reducers.humanSay({ text: text.trim() }).catch(console.error);
        setText('');
      }}
    >
      <span className="hint">You are {me.name}. Click the map to walk.</span>
      <input value={text} onChange={e => setText(e.target.value)} placeholder="Say something" maxLength={200} />
      <button type="submit">Say</button>
    </form>
  );
}
