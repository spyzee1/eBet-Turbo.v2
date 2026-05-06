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

export async function loadJournal(userId?: string): Promise<any[]> {
  if (!supabase || !userId) return [];
  try {
    const { data, error } = await supabase
      .from('journals')
      .select('entries')
      .eq('user_id', userId)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return (data?.entries as any[]) ?? [];
  } catch (e) {
    console.error('[db] loadJournal hiba:', e);
    return [];
  }
}

export async function loadSettings(userId?: string): Promise<Record<string, any> | null> {
  if (!supabase || !userId) return null;
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('settings')
      .eq('user_id', userId)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return (data?.settings as Record<string, any>) ?? null;
  } catch (e) {
    console.error('[db] loadSettings hiba:', e);
    return null;
  }
}

export async function saveSettings(userId: string | undefined, settings: Record<string, any>): Promise<void> {
  if (!supabase || !userId) return;
  try {
    await supabase
      .from('user_settings')
      .upsert({ user_id: userId, settings, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  } catch (e) {
    console.error('[db] saveSettings hiba:', e);
  }
}

export async function saveJournalDb(userId: string | undefined, entries: any[]): Promise<void> {
  if (!supabase || !userId) return;
  try {
    await supabase
      .from('journals')
      .upsert({ user_id: userId, entries, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  } catch (e) {
    console.error('[db] saveJournalDb hiba:', e);
  }
}
