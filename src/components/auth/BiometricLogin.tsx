'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabaseClient';
import {
  isPlatformAuthenticatorAvailable,
  getStoredCredential,
  getStoredRefreshToken,
  clearStoredCredential,
  clearStoredRefreshToken,
  authenticateBiometric,
} from '@/lib/webauthn';
import toast from 'react-hot-toast';
import { Fingerprint } from 'lucide-react';

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

  const handleBiometricLogin = async () => {
    setLoading(true);
    try {
      const valid = await authenticateBiometric();
      if (!valid) throw new Error('Verificación biométrica fallida');

      const refreshToken = getStoredRefreshToken();
      if (!refreshToken) {
        clearStoredCredential();
        throw new Error('No hay sesión guardada');
      }

      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data.session) {
        clearStoredCredential();
        clearStoredRefreshToken();
        throw error ?? new Error('Error al restaurar sesión');
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
