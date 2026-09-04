'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { CookieMethodsBrowser, CookieOptions } from '@supabase/ssr';
import { parse, serialize } from 'cookie';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

function getAllCookies() {
  if (typeof document === 'undefined') return [];
  return Object.entries(parse(document.cookie))
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, value]) => ({ name, value }));
}

// Session cookies: written without `expires`/`maxAge` so the browser deletes
// them when it is fully closed, ending the session for security. `httpOnly`
// can't be set via document.cookie, and `secure` is added only over HTTPS.
function setAllCookies(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
  if (typeof document === 'undefined') return;
  for (const { name, value, options } of cookiesToSet) {
    if (value === '') {
      document.cookie = serialize(name, '', { path: '/', expires: new Date(0), maxAge: 0 });
      continue;
    }
    document.cookie = serialize(name, value, {
      path: '/',
      sameSite: options?.sameSite ?? 'lax',
      secure:
        options?.secure ?? (typeof window !== 'undefined' && window.location.protocol === 'https:'),
    });
  }
}

// During static generation env vars may be unavailable; use placeholder
// values so createBrowserClient doesn't throw. The real client is used
// at runtime when the env vars are present.
export const supabase = createBrowserClient(url || 'https://placeholder.supabase.co', key || 'placeholder', {
  cookies: {
    getAll: getAllCookies,
    setAll: setAllCookies,
  } satisfies CookieMethodsBrowser,
});

export default supabase;
