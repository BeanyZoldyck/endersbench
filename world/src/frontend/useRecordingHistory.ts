import { useCallback, useEffect, useState } from 'react';
import { fetchSavedRecordings, type SavedRecording } from './run-history';

export function useRecordingHistory(enabled: boolean) {
  const [recordings, setRecordings] = useState<SavedRecording[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    const load = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      setRefreshing(true);
      try {
        const next = await fetchSavedRecordings(controller.signal);
        if (!cancelled) { setRecordings(next); setStatus('ready'); }
      } catch {
        if (!cancelled) setStatus('unavailable');
      } finally {
        clearTimeout(timeout);
        if (!cancelled) {
          setRefreshing(false);
          timer = setTimeout(() => { void load(); }, 15000);
        }
      }
    };
    void load();
    return () => { cancelled = true; clearTimeout(timer); controller?.abort(); };
  }, [enabled, revision]);
  return { recordings, status, refreshing, refresh };
}
