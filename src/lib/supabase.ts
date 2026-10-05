import { cookies } from 'next/headers';
import { hardenSessionCookieOptions } from '@/lib/security/session-cookie';

type CookieOptions = Record<string, unknown>;

export { hardenSessionCookieOptions };

export interface ServerCookie {
  name: string;
  value: string;
  options?: CookieOptions;
}

interface CreateClientOptions {
  cookieSetAll?: (cookies: ServerCookie[]) => void;
}

export async function createServerSupabaseClient(opts?: CreateClientOptions) {
  const { createServerClient } = await import('@supabase/ssr');
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          // Session cookies: strip maxAge/expires so the browser deletes them
          // when fully closed. Removal (maxAge: 0) goes through `remove`, so
          // it is not affected here.
          const sessionOptions = { ...options };
          delete sessionOptions.maxAge;
          delete sessionOptions.expires;
          const hardened = hardenSessionCookieOptions(sessionOptions);
          cookieStore.set(name, value, hardened);
          opts?.cookieSetAll?.([{ name, value, options: hardened }]);
        },
        remove(name: string, options: CookieOptions) {
          const removeOptions = hardenSessionCookieOptions({ ...options, maxAge: 0 });
          cookieStore.set(name, '', removeOptions);
          opts?.cookieSetAll?.([{ name, value: '', options: removeOptions }]);
        },
      },
    }
  );
}
