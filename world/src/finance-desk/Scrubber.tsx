import { useMemo, useRef, useState, type PointerEvent } from 'react';
import type { FinanceMoment } from './replay';

export const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
export const MOMENT_LABELS: Record<FinanceMoment['kind'], string> = { violation: 'Finding', pressure: 'Pressure', evidence: 'New evidence', decision: 'Decision', report: 'Report', result: 'Result' };
// A mark shows the most serious thing that happened at its time.
const PRIORITY: FinanceMoment['kind'][] = ['violation', 'pressure', 'evidence', 'report', 'decision', 'result'];
const SNAP_PX = 12;

// The same thing happening in several offices at once (four runs of one model, say) is one line.
type MomentLine = { id: string; kind: FinanceMoment['kind']; caption: string; agents: string[] };
export type MomentGroup = { time: number; kind: FinanceMoment['kind']; events: MomentLine[] };
export function groupMoments(moments: readonly FinanceMoment[]): MomentGroup[] {
  const times = [...new Set(moments.map(m => m.time))].sort((a, b) => a - b);
  return times.map(time => {
    const lines = new Map<string, MomentLine>();
    for (const m of moments.filter(m => m.time === time)) {
      const key = `${m.kind}|${m.caption}`, line = lines.get(key);
      if (line) { if (!line.agents.includes(m.agent)) line.agents.push(m.agent); }
      else lines.set(key, { id: m.id, kind: m.kind, caption: m.caption, agents: [m.agent] });
    }
    const events = [...lines.values()].sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
    return { time, kind: events[0].kind, events };
  });
}
const who = (agents: string[]) => agents.length > 2 ? `${agents.length} offices` : agents.join(', ');

type Cursor = { x: number; time: number; group?: MomentGroup };

// The replay timeline: every moment is a mark on the track, the cursor snaps to
// the nearest one and previews it, and a click or drag goes there.
export function Scrubber({ time, duration, groups, playing, speed, loop, stopAtFindings, onSeek, onPlay, onSpeed, onLoop, onStopAtFindings }: {
  time: number; duration: number; groups: MomentGroup[]; playing: boolean; speed: number; loop: boolean; stopAtFindings: boolean;
  onSeek: (time: number) => void; onPlay: () => void; onSpeed: () => void; onLoop: () => void; onStopAtFindings: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [cursor, setCursor] = useState<Cursor>();
  const prev = useMemo(() => [...groups].reverse().find(g => g.time < time - 1), [groups, time]);
  const next = useMemo(() => groups.find(g => g.time > time + 1), [groups, time]);
  const at = (clientX: number): Cursor => {
    const rect = track.current!.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    let best: MomentGroup | undefined, bestDistance = SNAP_PX;
    for (const g of groups) {
      const distance = Math.abs(g.time / duration * rect.width - x);
      if (distance <= bestDistance) { best = g; bestDistance = distance; }
    }
    return best ? { x: best.time / duration * rect.width, time: best.time, group: best } : { x, time: Math.round(x / rect.width * duration / 100) * 100 };
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    const c = at(e.clientX); setCursor(c); onSeek(c.time);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    const c = at(e.clientX); setCursor(c);
    if (dragging.current) onSeek(c.time);
  };
  const up = () => { dragging.current = false; };
  const pct = (t: number) => `${duration ? 100 * t / duration : 0}%`;
  return <div className="scrubber" role="group" aria-label="Replay timeline">
    <button className="scrub-button" onClick={onPlay} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (space)' : 'Play (space)'}>
      {playing ? <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="3" width="2.6" height="10" rx=".6" /><rect x="9.4" y="3" width="2.6" height="10" rx=".6" /></svg>
        : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6a.5.5 0 0 0 .76.43l7.6-4.8a.5.5 0 0 0 0-.86l-7.6-4.8A.5.5 0 0 0 5 3.2Z" /></svg>}
    </button>
    <button className="scrub-button" disabled={!prev} onClick={() => prev && onSeek(prev.time)} aria-label="Previous moment" title="Previous moment (←)">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3v10M13 3.6v8.8a.5.5 0 0 1-.78.42L6 8.42a.5.5 0 0 1 0-.84l6.22-4.4a.5.5 0 0 1 .78.42Z" /></svg>
    </button>
    <button className="scrub-button" disabled={!next} onClick={() => next && onSeek(next.time)} aria-label="Next moment" title="Next moment (→)">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.5 3v10M3 3.6v8.8a.5.5 0 0 0 .78.42L10 8.42a.5.5 0 0 0 0-.84L3.78 3.18A.5.5 0 0 0 3 3.6Z" /></svg>
    </button>
    <div className="scrub-track" ref={track} role="slider" tabIndex={0} aria-label="Replay position" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.round(time)} aria-valuetext={`${clock(time)} of ${clock(duration)}`}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => { if (!dragging.current) setCursor(undefined); }}>
      <span className="scrub-rail"><span className="scrub-fill" style={{ width: pct(time) }} /></span>
      {groups.map(g => <span key={g.time} className={`scrub-mark ${g.kind} ${g.time <= time ? 'reached' : ''} ${cursor?.group === g ? 'hot' : ''}`} style={{ left: pct(g.time) }} />)}
      <span className="scrub-head" style={{ left: pct(time) }} />
      {cursor && <>
        <span className="scrub-cursor" style={{ left: cursor.x }} />
        <span className={`scrub-preview ${cursor.group ? 'moment' : ''}`} style={{ left: cursor.x }}>
          <time>{clock(cursor.time)}</time>
          {cursor.group?.events.slice(0, 3).map(e => <span key={e.id} className={`preview-event ${e.kind}`}><b>{MOMENT_LABELS[e.kind]}</b><small>{who(e.agents)}</small><span>{e.caption}</span></span>)}
          {cursor.group && cursor.group.events.length > 3 && <small className="preview-more">+{cursor.group.events.length - 3} more</small>}
        </span>
      </>}
    </div>
    <span className="scrub-time">{clock(time)}<small> / {clock(duration)}</small></span>
    <button className="scrub-button scrub-speed" onClick={onSpeed} title="Playback speed">{speed}×</button>
    <button className="scrub-button" aria-pressed={loop} onClick={onLoop} aria-label="Loop" title="Loop">
      <svg viewBox="0 0 16 16" aria-hidden="true" className="stroke"><path d="M3 7.5V7a3 3 0 0 1 3-3h6.5M10.5 2l2 2-2 2M13 8.5V9a3 3 0 0 1-3 3H3.5M5.5 14l-2-2 2-2" /></svg>
    </button>
    <button className="scrub-button" aria-pressed={stopAtFindings} onClick={onStopAtFindings} aria-label="Stop at each finding" title="Stop at each finding">
      <svg viewBox="0 0 16 16" aria-hidden="true" className="stroke"><path d="M4 14V2.5M4 3h7.5l-1.6 2.7L11.5 8.4H4" /></svg>
    </button>
  </div>;
}
