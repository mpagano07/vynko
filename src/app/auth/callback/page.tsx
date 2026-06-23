'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Loader2 } from 'lucide-react';

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    let code = searchParams?.get('code');
    if (!code && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      code = url.searchParams.get('code');
    }

    if (!code) {
      router.replace('/login?error=missing_code');
      return;
    }

    supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) {
        console.error('exchangeCodeForSession error:', error);
        router.replace('/login?error=auth_failed');
        return;
      }
      router.replace('/');
    });
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
