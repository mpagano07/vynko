'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { isPlatformAuthenticatorAvailable, getStoredCredential, registerBiometric, storeRefreshToken } from '@/lib/webauthn';
import { supabase } from '@/lib/supabaseClient';
import toast from 'react-hot-toast';
import { Fingerprint, Smartphone, Check } from 'lucide-react';

interface Props {
  onComplete: () => void;
  onSkip: () => void;
}

export default function FingerprintSetup({ onComplete, onSkip }: Props) {
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    isPlatformAuthenticatorAvailable().then(setAvailable);
  }, []);

  if (!available) return null;

  const handleEnable = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No hay sesión activa');

      await registerBiometric(
        session.user.id,
        session.user.email ?? '',
        session.user.user_metadata?.full_name ?? session.user.email ?? '',
      );

      storeRefreshToken(session.refresh_token);
      setDone(true);
      toast.success('Ingreso con huella activado');
      setTimeout(onComplete, 1500);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? 'Error al configurar huella';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  if (getStoredCredential()) return null;

  return (
    <div className="mt-6 rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-indigo-500/20 p-2">
          <Fingerprint className="h-5 w-5 text-indigo-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-medium text-white">
            {done ? '¡Activado!' : 'Ingreso rápido con huella digital'}
          </h3>
          <p className="mt-1 text-xs text-gray-400">
            Ingresá con tu huella en el celular sin necesidad de escribir email y contraseña
          </p>
          <div className="mt-3 flex gap-2">
            {done ? (
              <Button size="sm" disabled className="gap-1.5">
                <Check className="h-4 w-4" /> Activado
              </Button>
            ) : (
              <>
                <Button size="sm" onClick={handleEnable} disabled={loading} className="gap-1.5">
                  <Smartphone className="h-4 w-4" />
                  {loading ? 'Configurando...' : 'Activar'}
                </Button>
                <Button size="sm" variant="outline" onClick={onSkip}>
                  Ahora no
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
