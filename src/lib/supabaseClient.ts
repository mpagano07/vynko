'use client';

import { createBrowserClient } from '@supabase/ssr';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

// During static generation env vars may be unavailable; use placeholder
// values so createBrowserClient doesn't throw. The real client is used
// at runtime when the env vars are present.
export const supabase = createBrowserClient(
  url || 'https://placeholder.supabase.co',
  key || 'placeholder',
);

export default supabase;
