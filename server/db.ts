import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL ?? '';
const key = process.env.SUPABASE_SERVICE_KEY ?? '';

export const supabase = url && key ? createClient(url, key) : null;

if (supabase) {
  console.log('[db] Supabase kapcsolat inicializálva ✅');
} else {
  console.warn('[db] ⚠️ SUPABASE_URL / SUPABASE_SERVICE_KEY hiányzik — fájl-alapú fallback aktív');
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
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
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
