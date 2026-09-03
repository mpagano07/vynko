import { cookies } from 'next/headers';

type CookieOptions = Record<string, unknown>;

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
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set(name, value, options);
          opts?.cookieSetAll?.([{ name, value, options }]);
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set(name, '', { ...options, maxAge: 0 });
          opts?.cookieSetAll?.([{ name, value: '', options: { ...options, maxAge: 0 } }]);
        },
      },
    }
  );
}
