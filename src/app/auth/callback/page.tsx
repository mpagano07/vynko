'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Loader2 } from 'lucide-react';

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    let cancelled = false;

    async function handleCallback() {
      try {
        let code = searchParams?.get('code');
        if (!code && typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          code = url.searchParams.get('code');
        }

        if (!code) {
          router.replace('/login?error=missing_code');
          return;
        }

        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          console.error('exchangeCodeForSession error:', exchangeError);
          router.replace('/login?error=auth_failed');
          return;
        }

        if (cancelled) return;

        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user?.email) {
          router.replace('/login');
          return;
        }

        const invRes = await fetch('/api/invitations/accept', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'x-refresh-token': session.refresh_token ?? '',
          },
        });
        const invData = await invRes.json();

        if (cancelled) return;

        if (invData.accepted > 0) {
          router.replace('/accept-invite');
          return;
        }

        const sessRes = await fetch('/api/session', {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'x-refresh-token': session.refresh_token ?? '',
          },
        });

        if (cancelled) return;

        if (!sessRes.ok) {
          router.replace('/login?error=session_failed');
          return;
        }

        const sessData = await sessRes.json();

        if (!sessData.tenant) {
          router.replace('/onboarding');
          return;
        }

        router.replace('/');
      } catch (err) {
        console.error('Callback error:', err);
        if (!cancelled) router.replace('/login?error=unexpected');
      }
    }

    handleCallback();

    return () => { cancelled = true; };
  }, [searchParams, router]);

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
