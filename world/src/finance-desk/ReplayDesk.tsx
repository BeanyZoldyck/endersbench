import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeskView } from './DeskApp';
import { cohorts } from './comparison';
import { currentVersion } from './conditions';
import { financeDuration, financeFrameAt, financeMoments, nextReplayMoment, parseFinanceRecording, type FinanceRecording } from './replay';
import { Scrubber, groupMoments } from './Scrubber';

const SPEEDS = [.5, 1, 2, 4];
export default function ReplayDesk({ url, snapshot, onExit, lineup = false }: { lineup?: boolean; url?: string; snapshot?: FinanceRecording; onExit?: () => void }) {
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
  const groups = useMemo(() => recording ? cohorts(recording.cases, lineup || recording.lineup === true) : [], [recording, lineup]);
  const comparisonKey = groups.find(g => g.key === selection)?.key ?? groups.find(g => g.row.benchmarkVersion === currentVersion && g.row.variant === 'house-rules')?.key ?? groups.find(g => g.models.size > 1)?.key ?? groups[0]?.key;
  const moments = useMemo(() => recording && comparisonKey ? financeMoments(recording, comparisonKey) : [], [recording, comparisonKey]);
  const marks = useMemo(() => groupMoments(moments), [moments]);
  const duration = useMemo(() => recording ? financeDuration(recording, comparisonKey) : 0, [recording, comparisonKey]);
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
  // Scrubbing holds the frame where it lands, so a moment stays on screen to be read.
  const jump = useCallback((value: number) => { seek(Math.min(Math.max(value, 0), duration)); setPlaying(false); }, [seek, duration]);
  const toggle = useCallback(() => { if (timeRef.current >= duration) seek(0); setPlaying(p => !p); }, [seek, duration]);
  // Space plays and pauses; ← and → go to the previous and next moment; with shift, one step.
  useEffect(() => {
    if (!recording) return;
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || target.closest('input, select, textarea, [contenteditable]')) return;
      if (e.key === ' ' && !target.closest('button, a, summary')) { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const now = timeRef.current, forward = e.key === 'ArrowRight';
        if (e.shiftKey) jump(now + (forward ? 1 : -1) * recording.stepMs);
        else {
          const found = forward ? marks.find(m => m.time > now + 1) : [...marks].reverse().find(m => m.time < now - 1);
          if (found) jump(found.time);
        }
      } else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); jump(e.key === 'Home' ? 0 : duration); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [recording, marks, duration, jump, toggle]);
  const controls = error ? <div className="scrubber scrubber-state" role="alert">Replay failed: {error}</div>
    : !recording ? <div className="scrubber scrubber-state" role="status">Loading the recording…</div>
    : <Scrubber time={time} duration={duration} groups={marks} playing={playing} speed={speed} loop={loop} stopAtFindings={pauseOnViolation}
        onSeek={jump} onPlay={toggle} onSpeed={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])} onLoop={() => setLoop(!loop)} onStopAtFindings={() => setPauseOnViolation(!pauseOnViolation)} />;
  return <DeskView lineup={lineup || recording?.lineup === true} {...data} isActive={false} ready={!!recording} replay={{ controls, error, comparisonKey, url, onExit, pause: () => setPlaying(false), onComparisonChange: key => { setSelection(key); restart(); } }} />;
}
