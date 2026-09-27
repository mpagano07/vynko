'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let code = searchParams?.get('code');
    if (!code && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      code = url.searchParams.get('code');
    }

    // El canje del codigo por una sesion lo hace el servidor, para que la
    // cookie de recuperacion quede HttpOnly y ningun token llegue al JS.
    const establish = async () => {
      if (code) {
        const res = await fetch('/api/auth/recover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        if (!res.ok) {
          toast.error('Link inválido o expirado');
          router.push('/login');
          return;
        }
        setReady(true);
        return;
      }

      // Sin `code` (el enlace se abrio en otra pestana y ya se canjeo): se
      // consulta al servidor si la sesion de recuperacion sigue vigente.
      const res = await fetch('/api/session', { credentials: 'include' });
      const data = await res.json();
      if (res.ok && data?.user) {
        setReady(true);
      } else {
        toast.error('Link inválido o expirado');
        router.push('/login');
      }
    };

    void establish();
  }, [searchParams, router]);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error('Las contraseñas no coinciden');
      return;
    }

    if (password.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'change', newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'No se pudo actualizar la contraseña');

      toast.success('Contraseña actualizada correctamente');
      // La sesion de recuperacion ya no sirve: se cierra desde el servidor para
      // no dejar viva la sesion con la que se entro por el link.
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      router.push('/login');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la contraseña');
    } finally {
      setLoading(false);
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <Card className="w-full max-w-md p-8 text-center bg-gray-800 border border-gray-700">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-500 mx-auto" />
          <p className="mt-4 text-gray-400">Verificando link...</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 p-8">
      <Card className="w-full max-w-md p-8 bg-gray-800 border border-gray-700">
        <div className="mb-8 text-center">
          <Image src="/icons/vynkoLogout.png?v=3" alt="Vynko" width={1530} height={590} sizes="128px" className="h-10 w-auto object-contain mx-auto mb-2" />
          <p className="text-gray-400">Nueva contraseña</p>
        </div>

        <form onSubmit={handleReset} className="space-y-4">
          <div>
            <label htmlFor="new-password" className="block text-sm font-medium mb-2 text-gray-300">
              Nueva contraseña
            </label>
            <Input
              type="password"
              id="new-password"
              placeholder="Mínimo 6 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-400"
            />
          </div>

          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium mb-2 text-gray-300">
              Confirmar contraseña
            </label>
            <Input
              type="password"
              id="confirm-password"
              placeholder="Repite la contraseña"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-400"
            />
          </div>

          <Button
            type="submit"
            disabled={loading || !password || !confirmPassword}
            className="w-full"
          >
            {loading ? 'Actualizando...' : 'Actualizar contraseña'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-900">
          <Card className="w-full max-w-md p-8 text-center bg-gray-800 border border-gray-700">
            <div className="animate-pulse text-gray-400">Cargando...</div>
          </Card>
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
