import { createClient, SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';

// Initialized lazily via initDb() so .env is loaded first by index.ts
export let supabase: SupabaseClient | null = null;

export function initDb(): void {
  const url = process.env.SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_KEY ?? '';
  if (!url || !key) {
    console.warn('[db] ⚠️ SUPABASE_URL / SUPABASE_SERVICE_KEY hiányzik — fájl-alapú fallback aktív');
    return;
  }
  supabase = createClient(url, key, { realtime: { transport: ws as any } });
  console.log('[db] Supabase kapcsolat inicializálva ✅');
}

// ── Journal ───────────────────────────────────────────────────────────────────

export async function loadJournal(): Promise<any[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('app_data')
      .select('value')
      .eq('key', 'journal')
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return (data?.value as any[]) ?? [];
  } catch (e) {
    console.error('[db] loadJournal hiba:', e);
    return [];
  }
}

export async function saveJournalDb(entries: any[]): Promise<void> {
  if (!supabase) return;
  try {
    await supabase
      .from('app_data')
      .upsert({ key: 'journal', value: entries }, { onConflict: 'key' });
  } catch (e) {
    console.error('[db] saveJournalDb hiba:', e);
  }
}
