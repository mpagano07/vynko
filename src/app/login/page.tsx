'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import toast from 'react-hot-toast';

export const dynamic = 'force-dynamic';

function LoginContent() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!cooldown) return;

    const timer = window.setInterval(() => {
      setCooldown((value) => Math.max(value - 1, 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [cooldown]);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();

    if (cooldown > 0) {
      toast.error(`Espera ${cooldown} segundos antes de solicitar otro link`);
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) throw error;

      setSubmitted(true);
      setCooldown(60);
      toast.success('Link de acceso enviado a tu email');
    } catch (error: unknown) {
      const maybeError = error as { status?: number; message?: string };
      if (maybeError?.status === 429) {
        setCooldown(60);
        toast.error('Demasiadas solicitudes. Espera un minuto e intenta de nuevo.');
      } else {
        toast.error(maybeError?.message || 'Error al enviar link');
      }
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md p-8">
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-2">Revisa tu email</h2>
            <p className="text-gray-600 mb-4">
              Hemos enviado un link de acceso a <strong>{email}</strong>
            </p>
            <p className="text-sm text-gray-500">
              El link expira en 24 horas
            </p>
            <Button
              onClick={() => {
                setSubmitted(false);
                setEmail('');
              }}
              variant="outline"
              className="mt-6 w-full"
            >
              Intentar con otro email
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md p-8">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold mb-2">StockPilot</h1>
          <p className="text-gray-600">Gestión de stock inteligente</p>
        </div>

        <form onSubmit={handleMagicLink} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700">
              Email
            </label>
            <Input
              type="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <Button
            type="submit"
            disabled={loading || !email || cooldown > 0}
            className="w-full"
          >
            {loading
              ? 'Enviando...'
              : cooldown > 0
              ? `Reintentar en ${cooldown}s`
              : 'Enviar link de acceso'}
          </Button>
        </form>

        <p className="text-xs text-gray-500 text-center mt-4">
          No necesitas contraseña. Usa magic link para acceder instantáneamente.
        </p>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <Card className="w-full max-w-md p-8 text-center">
            <div className="animate-pulse">Cargando...</div>
          </Card>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
