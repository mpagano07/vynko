'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabaseClient';
import {
  isPlatformAuthenticatorAvailable,
  getStoredCredential,
  getStoredRefreshToken,
  clearStoredRefreshToken,
  storeRefreshToken,
  authenticateBiometric,
} from '@/lib/webauthn';
import toast from 'react-hot-toast';
import { Fingerprint } from 'lucide-react';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default function BiometricLogin() {
  const router = useRouter();
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const stored = getStoredCredential();
    if (!stored) return;
    isPlatformAuthenticatorAvailable().then(setAvailable);
  }, []);

  if (!available || !getStoredCredential()) return null;

  async function exchangeRefreshToken(token: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ refresh_token: token }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = await res.json();
      const { data: sessionData, error } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      } as any);
      return error ? null : sessionData.session;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  const handleBiometricLogin = async () => {
    setLoading(true);
    try {
      await authenticateBiometric();

      let session = null;

      const { data: existing } = await supabase.auth.getSession();
      if (existing?.session) {
        session = existing.session;
      }

      if (!session) {
        const { data, error } = await supabase.auth.refreshSession();
        if (!error && data?.session) {
          session = data.session;
        }
      }

      if (!session) {
        const refreshToken = getStoredRefreshToken();
        if (refreshToken) {
          session = await exchangeRefreshToken(refreshToken);
        }
      }

      if (!session) {
        clearStoredRefreshToken();
        throw new Error('No se pudo restaurar la sesión. Iniciá sesión con email.');
      }

      if (session.refresh_token) {
        storeRefreshToken(session.refresh_token);
      }

      toast.success('Sesión iniciada con huella');
      router.push('/dashboard');
      router.refresh();
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? 'Error al autenticar con huella';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4">
      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-700" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-gray-900 px-2 text-gray-500">O ingresá rápido</span>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={handleBiometricLogin}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/10 hover:text-indigo-300"
      >
        <Fingerprint className="h-5 w-5" />
        {loading ? 'Escaneando huella...' : 'Ingresar con huella digital'}
      </Button>
    </div>
  );
}
