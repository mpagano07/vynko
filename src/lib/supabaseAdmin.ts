import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient {
  if (_client) return _client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error(
      'supabaseUrl is required. Ensure NEXT_PUBLIC_SUPABASE_URL is set in your environment variables.'
    );
  }
  if (!serviceRoleKey) {
    throw new Error(
      'supabase service role key is required. Ensure SUPABASE_SERVICE_ROLE_KEY is set in your environment variables.'
    );
  }

  _client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return _client;
}

export const supabaseAdmin = new Proxy<SupabaseClient>({} as SupabaseClient, {
  get(_target, prop) {
    return getAdminClient()[prop as keyof SupabaseClient];
  },
});
