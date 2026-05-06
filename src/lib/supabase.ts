import { createClient, SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;
let initPromise: Promise<SupabaseClient | null> | null = null;

export async function getSupabaseClient(): Promise<SupabaseClient | null> {
  if (client) return client;
  if (initPromise) return initPromise;

  initPromise = fetch('/api/config')
    .then(r => r.json())
    .then(({ supabaseUrl, supabaseAnonKey }) => {
      if (!supabaseUrl || !supabaseAnonKey) return null;
      client = createClient(supabaseUrl, supabaseAnonKey);
      return client;
    })
    .catch(() => null);

  return initPromise;
}
