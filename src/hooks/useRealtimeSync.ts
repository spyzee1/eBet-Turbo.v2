import { useEffect, useRef } from 'react';
import { getSupabaseClient } from '../lib/supabase';
import { saveJournal, saveCheckedMatches } from '../api';

const JOURNAL_KEY = 'betting_journal';
const CHECKED_KEY = 'checked_green_matches';

export function useRealtimeSync(authed: boolean) {
  const channelRef = useRef<any>(null);

  useEffect(() => {
    if (!authed) return;

    getSupabaseClient().then(sb => {
      if (!sb) return;

      channelRef.current = sb.channel('user-data-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'journals' }, payload => {
          const newEntries = (payload.new as any)?.entries;
          if (!Array.isArray(newEntries)) return;
          const local: any[] = (() => { try { return JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]'); } catch { return []; } })();
          // Merge: remote entries take priority by matchId
          const merged = new Map<string, any>();
          for (const e of local) if (e?.matchId) merged.set(e.matchId, e);
          for (const e of newEntries) if (e?.matchId) merged.set(e.matchId, e);
          const result = Array.from(merged.values());
          localStorage.setItem(JOURNAL_KEY, JSON.stringify(result));
          window.dispatchEvent(new Event('journal-updated'));
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'user_checked_matches' }, payload => {
          const newEntries = (payload.new as any)?.entries;
          if (!Array.isArray(newEntries)) return;
          const local: any[] = (() => { try { return JSON.parse(localStorage.getItem(CHECKED_KEY) || '[]'); } catch { return []; } })();
          // Merge by matchId — remote wins
          const merged = new Map<string, any>();
          for (const e of local) if (e?.matchId) merged.set(e.matchId, e);
          for (const e of newEntries) if (e?.matchId) merged.set(e.matchId, e);
          localStorage.setItem(CHECKED_KEY, JSON.stringify(Array.from(merged.values())));
          window.dispatchEvent(new Event('checked-matches-updated'));
        })
        .subscribe();
    });

    return () => { channelRef.current?.unsubscribe(); };
  }, [authed]);
}

// Debounced save helpers — called from App.tsx event listeners
let journalSaveTimer: ReturnType<typeof setTimeout> | null = null;
export function debouncedSaveJournal(entries: any[], delay = 1500) {
  if (journalSaveTimer) clearTimeout(journalSaveTimer);
  journalSaveTimer = setTimeout(() => saveJournal(entries), delay);
}

let checkedSaveTimer: ReturnType<typeof setTimeout> | null = null;
export function debouncedSaveChecked(entries: any[], delay = 1500) {
  if (checkedSaveTimer) clearTimeout(checkedSaveTimer);
  checkedSaveTimer = setTimeout(() => saveCheckedMatches(entries), delay);
}
