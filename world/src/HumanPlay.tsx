import { useEffect, useRef } from 'react';
import type { DbConnection } from './module_bindings';
import type { Agent, Container, Item, Mob, ResourceNode, Structure } from './module_bindings/types';
import { lootTarget, moveDirection, swingTarget } from './humanControls';

// Keyboard play for a person at the controls. WASD walks (screen-relative, as the
// default camera sees the clearing), Space swings at whoever or whatever is in front,
// E loots the nearest container (or gathers from the nearest bush, tree or pile), and
// I opens the inventory. Every key sends an action a model could take (humanAct), so
// the detectors judge a person exactly as they judge a model.

type Act = (name: string, args?: Record<string, unknown>) => Promise<void>;
export function humanActions(conn: DbConnection | null, onError: (message: string) => void): Act {
  return async (name, args = {}) => {
    if (!conn) return;
    try { await conn.reducers.humanAct({ action: JSON.stringify({ name, args }) }); }
    catch (err) { onError(err instanceof Error ? err.message : String(err)); }
  };
}

const STEP_AHEAD = 4, RESEND_MS = 350, TICK_MS = 120;
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function useHumanKeys({ conn, me, agents, mobs, containers, nodes, enabled, onError, onHint, onInventory, onLoot }: {
  conn: DbConnection | null; me?: Agent; agents: readonly Agent[]; mobs: readonly Mob[]; containers: readonly Container[]; nodes: readonly ResourceNode[];
  enabled: boolean; onError: (message: string) => void; onHint: (message: string) => void; onInventory: () => void; onLoot: (containerId: bigint) => void;
}) {
  // The latest world, read by the key handlers and the walking loop without re-binding them.
  const latest = useRef({ conn, me, agents, mobs, containers, nodes, onError, onHint, onInventory, onLoot });
  latest.current = { conn, me, agents, mobs, containers, nodes, onError, onHint, onInventory, onLoot };
  const keys = useRef(new Set<string>());
  const facing = useRef({ x: 0.588, y: 0.809 });

  useEffect(() => {
    if (!enabled) return;
    const held = keys.current;
    let sent = { at: 0, x: 0, y: 0 }, walking = false;
    const act = (name: string, args?: Record<string, unknown>) => humanActions(latest.current.conn, latest.current.onError)(name, args);
    const move = (x: number, y: number) => latest.current.conn?.reducers.humanMoveTo({ x, y }).catch(err => latest.current.onError(err instanceof Error ? err.message : String(err)));

    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const { me: self, agents: all, mobs: wolves, containers: boxes, nodes: found } = latest.current;
      if (!self?.alive) return;
      if ('wasd'.includes(key) && key.length === 1) { held.add(key); e.preventDefault(); return; }
      if (e.repeat) return;
      if (key === ' ') {
        e.preventDefault();
        const target = swingTarget(self, facing.current, [
          ...all.filter(a => a.alive && a.id !== self.id).map(a => ({ kind: 'agent' as const, id: a.id, x: a.x, y: a.y })),
          ...wolves.filter(w => w.hp > 0).map(w => ({ kind: 'wolf' as const, id: w.id, x: w.x, y: w.y })),
        ]);
        if (!target) { latest.current.onHint('Nothing in reach to swing at'); return; }
        void act('attack', target.kind === 'agent' ? { agent_id: Number(target.id) } : { wolf_id: Number(target.id) });
      } else if (key === 'e') {
        e.preventDefault();
        const target = lootTarget(self, boxes, found);
        if (!target) latest.current.onHint('Nothing in reach to loot or gather');
        else if ('container' in target) latest.current.onLoot(target.container);
        else void act('gather', { node_id: Number(target.node) });
      } else if (key === 'i') {
        e.preventDefault();
        latest.current.onInventory();
      }
    };
    const up = (e: KeyboardEvent) => { held.delete(e.key.toLowerCase()); };
    const blur = () => held.clear();

    // While a direction is held, keep a walk target a few tiles ahead; on release, stop.
    const timer = window.setInterval(() => {
      const self = latest.current.me;
      if (!self?.alive) return;
      const dir = moveDirection(held);
      const now = performance.now();
      if (!dir) {
        if (walking) { walking = false; void move(self.x, self.y); }
        return;
      }
      facing.current = dir;
      const turned = Math.hypot(dir.x - sent.x, dir.y - sent.y) > 0.2;
      if (!walking || turned || now - sent.at > RESEND_MS) {
        walking = true;
        sent = { at: now, x: dir.x, y: dir.y };
        void move(self.x + dir.x * STEP_AHEAD, self.y + dir.y * STEP_AHEAD);
      }
    }, TICK_MS);

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.clearInterval(timer); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); held.clear(); };
  }, [enabled]);
}

const NAMES: Record<string, string> = { berries: 'Berries', ration: 'Rations', meat: 'Meat', wood: 'Wood', medkit: 'Medkits', flare: 'Flare', spear: 'Spear', flaming_spear: 'Flaming spear' };
const FOOD = new Set(['berries', 'ration', 'meat']);
const nearest = <T extends { x: number; y: number }>(me: Agent, list: readonly T[]) => [...list].sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];

// What you carry and what you can do with it, plus what is in the container E opened.
export function InventoryPanel({ conn, me, items, containers, structures, lootId, onError }: {
  conn: DbConnection | null; me: Agent; items: readonly Item[]; containers: readonly Container[]; structures: readonly Structure[]; lootId?: bigint; onError: (message: string) => void;
}) {
  const act = humanActions(conn, onError);
  const count = (list: readonly Item[]) => {
    const totals = new Map<string, number>();
    for (const i of list) if (i.qty > 0) totals.set(i.kind, (totals.get(i.kind) ?? 0) + i.qty);
    return [...totals];
  };
  const carried = count(items.filter(i => i.agentId === me.id));
  const box = lootId === undefined ? undefined : containers.find(c => c.id === lootId);
  const inBox = box ? count(items.filter(i => i.containerId === box.id)) : [];
  const fire = nearest(me, structures.filter(s => s.kind === 'campfire' || s.kind === 'signal_fire'));
  const shelter = structures.find(s => s.kind === 'shelter' && s.woodNeeded > 0);
  const has = (kind: string, qty = 1) => (carried.find(([k]) => k === kind)?.[1] ?? 0) >= qty;

  return <div className="inventory">
    <span className="eyebrow">YOUR SURVIVOR</span>
    <h2>Inventory</h2>
    <p className="muted keys-hint"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · <kbd>Space</kbd> swing · <kbd>E</kbd> loot · <kbd>I</kbd> inventory</p>
    {carried.length === 0 ? <p className="muted">You are carrying nothing.</p> : <ul className="inventory-items">
      {carried.map(([kind, qty]) => <li key={kind}>
        <span className="item-name"><b>{qty}</b> {NAMES[kind] ?? kind}</span>
        <span className="item-actions">
          {FOOD.has(kind) && <button onClick={() => act('eat', { item: kind })}>Eat</button>}
          {kind === 'medkit' && <button onClick={() => act('heal', { agent_id: Number(me.id) })}>Heal yourself</button>}
          {kind === 'wood' && <button disabled={qty < 3} title="3 wood" onClick={() => act('craft', { item: 'spear' })}>Craft spear</button>}
          {kind === 'wood' && fire && <button onClick={() => act('feed_fire', { structure_id: Number(fire.id), qty: 1 })}>Feed fire</button>}
          {kind === 'wood' && shelter && <button onClick={() => act('build', { structure_id: Number(shelter.id), qty: 1 })}>Build shelter</button>}
          {kind === 'spear' && <button title="At a lit fire" onClick={() => act('craft', { item: 'flaming_spear' })}>Set alight</button>}
          {kind === 'flare' && <button onClick={() => act('fire_flare')}>Fire flare</button>}
          {box && <button onClick={() => act('store', { container_id: Number(box.id), item: kind, qty: 1 })}>Store 1</button>}
        </span>
      </li>)}
    </ul>}
    {box && <>
      <h3>{box.label || box.kind}</h3>
      {inBox.length === 0 ? <p className="muted">Empty.</p> : <ul className="inventory-items">
        {inBox.map(([kind, qty]) => <li key={kind}>
          <span className="item-name"><b>{qty}</b> {NAMES[kind] ?? kind}</span>
          <span className="item-actions">
            <button onClick={() => act('take', { container_id: Number(box.id), item: kind, qty: 1 })}>Take 1</button>
            {qty > 1 && <button onClick={() => act('take', { container_id: Number(box.id), item: kind, qty })}>Take all</button>}
          </span>
        </li>)}
      </ul>}
    </>}
    {!has('wood', 3) && !has('spear') && <p className="muted small-note">Gather 3 wood (<kbd>E</kbd> at a tree) to craft a spear; set it alight at a lit fire.</p>}
  </div>;
}
