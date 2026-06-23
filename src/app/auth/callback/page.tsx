'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Loader2 } from 'lucide-react';

function CallbackContent() {
  const searchParams = useSearchParams();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    let code = searchParams?.get('code');
    if (!code && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      code = url.searchParams.get('code');
    }

    if (!code) {
      window.location.href = '/login?error=missing_code';
      return;
    }

    const check = async () => {
      try {
        const { error } = await supabase.auth.exchangeCodeForSession(code as string);
        if (error) {
          console.error('Error exchanging code:', error);
          window.location.href = `/login?error=${encodeURIComponent(error.message)}`;
          return;
        }
        window.location.href = '/';
      } catch (err: any) {
        console.error('Unexpected callback error:', err);
        window.location.href = '/login?error=callback_exception';
      }
    };
    check();
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-900">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
