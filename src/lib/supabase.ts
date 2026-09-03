import { cookies } from 'next/headers';

type CookieOptions = Record<string, unknown>;

interface Cookie {
  name: string;
  value: string;
  maxAge?: number;
  domain?: string;
  path?: string;
  sameSite?: 'lax' | 'strict' | 'none';
  secure?: boolean;
  httpOnly?: boolean;
}

interface CreateClientOptions {
  cookieSetAll?: (cookies: Cookie[]) => void;
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
          opts?.cookieSetAll?.([{ name, value, ...(options as Omit<Cookie, 'name' | 'value'>) }]);
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set(name, '', { ...options, maxAge: 0 });
          opts?.cookieSetAll?.([{ name, value: '', maxAge: 0, ...(options as Omit<Cookie, 'name' | 'value'>) }]);
        },
      },
    }
  );
}
