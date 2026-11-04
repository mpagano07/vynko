import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

/**
 * Cliente con la anon key, sin cookies ni sesion. Sirve para las operaciones
 * que el servicio tiene que hacer "como la app" y no como administrador, como
 * disparar un magic link: el endpoint de `/auth/v1/otp` no está pensado para
 * la service role key.
 */
function getAnonClient(): SupabaseClient {
  if (_client) return _client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error(
      'supabaseUrl is required. Ensure NEXT_PUBLIC_SUPABASE_URL is set in your environment variables.'
    );
  }
  if (!anonKey) {
    throw new Error(
      'supabase anon key is required. Ensure SUPABASE_ANON_KEY is set in your environment variables.'
    );
  }

  _client = createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return _client;
}

export const supabaseAnon = new Proxy<SupabaseClient>({} as SupabaseClient, {
  get(_target, prop) {
    return getAnonClient()[prop as keyof SupabaseClient];
  },
});
