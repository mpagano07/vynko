'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { supabase } from '@/lib/supabaseClient';
import {
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  getStoredCredential,
  clearStoredCredential,
  clearStoredRefreshToken,
  registerBiometric,
  storeRefreshToken,
} from '@/lib/webauthn';
import toast from 'react-hot-toast';
import { Fingerprint, Smartphone, Trash2, RefreshCw, Loader2, Check, X } from 'lucide-react';

export default function BiometricSettings() {
  const [supported, setSupported] = useState(false);
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const check = async () => {
      const supp = isWebAuthnSupported();
      setSupported(supp);
      if (supp) {
        setAvailable(await isPlatformAuthenticatorAvailable());
      }
      setEnabled(!!getStoredCredential());
    };
    check();
  }, []);

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
      setEnabled(true);
      toast.success('Ingreso con huella activado');
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? 'Error al configurar huella';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = () => {
    clearStoredCredential();
    clearStoredRefreshToken();
    setEnabled(false);
    toast.success('Ingreso con huella desactivado');
  };

  if (!supported) return null;

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Fingerprint className="h-5 w-5 text-indigo-500" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Ingreso con huella digital
        </h2>
      </div>

      {!available ? (
        <p className="text-sm text-gray-500">
          Este dispositivo no tiene un sensor biométrico disponible o no está configurado.
          Asegurate de tener una huella digital o Face ID configurado en el dispositivo.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`rounded-full p-2 ${enabled ? 'bg-green-100 dark:bg-green-900/30' : 'bg-gray-100 dark:bg-gray-800'}`}>
                {enabled ? (
                  <Smartphone className="h-5 w-5 text-green-600 dark:text-green-400" />
                ) : (
                  <Smartphone className="h-5 w-5 text-gray-400" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {enabled ? 'Activado' : 'Desactivado'}
                </p>
                <p className="text-xs text-gray-500">
                  {enabled
                    ? 'Podés ingresar con tu huella digital desde la pantalla de login'
                    : 'Activá el ingreso con huella para no tener que escribir tu email y contraseña'}
                </p>
              </div>
            </div>

            {enabled ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisable}
                className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Desactivar
              </Button>
            ) : (
              <Button size="sm" onClick={handleEnable} disabled={loading} className="gap-1.5">
                {loading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Activando...</>
                ) : (
                  <><Check className="h-4 w-4" /> Activar</>
                )}
              </Button>
            )}
          </div>

          {enabled && (
            <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
              <Button
                variant="outline"
                size="sm"
                onClick={handleEnable}
                disabled={loading}
                className="gap-1.5"
              >
                <RefreshCw className="h-4 w-4" />
                Volver a registrar huella
              </Button>
              <p className="text-xs text-gray-400 mt-1">
                Útil si cambiás de dispositivo o querés actualizar el registro
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
