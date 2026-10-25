import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeskView } from './DeskApp';
import { cohorts } from './comparison';
import { currentVersion } from './conditions';
import { financeDuration, financeFrameAt, financeMoments, nextReplayMoment, parseFinanceRecording, type FinanceRecording } from './replay';

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
export default function ReplayDesk({ url, snapshot, onExit }: { url?: string; snapshot?: FinanceRecording; onExit?: () => void }) {
  const [recording, setRecording] = useState<FinanceRecording | undefined>(snapshot);
  const [error, setError] = useState('');
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(true), [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true), [pauseOnViolation, setPauseOnViolation] = useState(false);
  const [selection, setSelection] = useState('');
  const timeRef = useRef(0);
  const seek = useCallback((value: number) => { timeRef.current = value; setTime(value); }, []);
  useEffect(() => {
    if (snapshot) { setRecording(snapshot); return; }
    if (!url) return;
    const abort = new AbortController();
    setRecording(undefined); setError(''); seek(0); setSelection(''); setPlaying(true);
    fetch(url, { signal: abort.signal }).then(response => {
      if (!response.ok) throw new Error(`Replay returned ${response.status}`);
      return response.json();
    }).then(json => { if (!abort.signal.aborted) setRecording(parseFinanceRecording(json)); })
      .catch(err => { if (!abort.signal.aborted) setError(String(err.message ?? err)); });
    return () => abort.abort();
  }, [url, snapshot, seek]);
  const groups = useMemo(() => recording ? cohorts(recording.cases) : [], [recording]);
  const comparisonKey = groups.find(g => g.key === selection)?.key ?? groups.find(g => g.row.benchmarkVersion === currentVersion && g.row.variant === 'house-rules')?.key ?? groups.find(g => g.models.size > 1)?.key ?? groups[0]?.key;
  const moments = useMemo(() => recording && comparisonKey ? financeMoments(recording, comparisonKey) : [], [recording, comparisonKey]);
  const duration = recording ? financeDuration(recording) : 0;
  useEffect(() => {
    if (!recording || !playing) return;
    let frame = 0, previous = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min(now - previous, 250) * speed; previous = now;
      const proposed = Math.min(duration, timeRef.current + elapsed);
      const violation = pauseOnViolation ? nextReplayMoment(moments, timeRef.current, 'violation') : undefined;
      if (violation && violation.time <= proposed) { seek(violation.time); setPlaying(false); return; }
      if (proposed >= duration) {
        if (loop) seek(0); else { seek(duration); setPlaying(false); return; }
      } else seek(proposed);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [recording, playing, speed, duration, loop, moments, pauseOnViolation, seek]);
  const turn = Math.floor(time / (recording?.stepMs ?? 1));
  const data = useMemo(() => recording ? financeFrameAt(recording, turn * recording.stepMs) : { cases: [], steps: [], verdicts: [] }, [recording, turn]);
  const restart = () => { seek(0); setPlaying(true); };
  const next = nextReplayMoment(moments, time);
  const eventGroups = useMemo(() => [...new Set(moments.map(m => m.time))].map(at => ({ time: at, events: moments.filter(m => m.time === at) })), [moments]);
  const controls = <div className="finance-replay-bar" role="group" aria-label="Replay controls">
    <span className="finance-replay-tag">REPLAY</span>
    {error ? <span role="alert">Replay failed: {error}</span> : !recording ? <span>Loading recorded cases…</span> : <>
      <button aria-label={playing ? 'Pause replay' : 'Play replay'} onClick={() => { if (time >= duration) seek(0); setPlaying(!playing); }}>{playing ? 'Pause' : 'Play'}</button>
      <button onClick={restart}>Restart</button>
      <input type="range" min={0} max={duration} step={100} value={time} aria-label="Replay position" onChange={e => seek(Number(e.target.value))} />
      <span className="finance-replay-time">{clock(time)} / {clock(duration)}</span>
      <select aria-label="Replay speed" value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[.5, 1, 2, 4].map(s => <option key={s} value={s}>{s}×</option>)}</select>
      <button aria-pressed={loop} onClick={() => setLoop(!loop)}>Loop</button>
      <button aria-label="Next important event" disabled={!next} onClick={() => { if (next) { seek(next.time); setPlaying(false); } }}>Next event →</button>
      <button aria-pressed={pauseOnViolation} onClick={() => setPauseOnViolation(!pauseOnViolation)}>Pause on violation</button>
      <div className="replay-moment-rail" aria-label="Important replay moments">{eventGroups.map(group => {
        const kind = group.events.some(e => e.kind === 'violation') ? 'violation' : group.events[0].kind;
        const kinds = [...new Set(group.events.map(e => e.kind))].join(', ');
        return <button key={group.time} className={`replay-moment ${kind} ${group.time <= time ? 'reached' : ''}`} style={{ left: `${100 * group.time / duration}%` }} aria-label={`Jump to ${kinds} at ${clock(group.time)}`} title={`${kinds} · ${clock(group.time)}`} onClick={() => { seek(group.time); setPlaying(false); }} />;
      })}</div>
      <span className="replay-moment-key">Amber: pressure · Red: policy finding · Teal: decision · Purple: report</span>
    </>}
  </div>;
  return <DeskView {...data} isActive={false} ready={!!recording} replay={{ controls, error, comparisonKey, onExit, pause: () => setPlaying(false), onComparisonChange: key => { setSelection(key); restart(); } }} />;
}
