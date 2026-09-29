'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { validatePassword, PASSWORD_MIN_LENGTH } from '@/lib/password-policy';

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [failed, setFailed] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // El `code` viaja intacto hasta el envio: no se canjea al abrir la pagina.
  // Canjearlo al abrir dejaba una sesion completa de por medio, y ademas hacia
  // fallar el link entero si el usuario tardaba en escribir la contrasena. El
  // canje ocurre junto con el cambio, en un solo pedido al servidor.
  //
  // Por eso no hay estado de "cargando": nada se verifica al montar. O hay `code`
  // y se muestra el formulario, o no hay y se muestra el aviso.
  const code = searchParams?.get('code') ?? '';
  const linkUsable = Boolean(code) && !failed;

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error('Las contraseñas no coinciden');
      return;
    }

    const check = validatePassword(password);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Un `code` sin su cookie de verifier llega como "Link invalido o
        // expirado", pero la causa real suele ser que el link se abrio en otro
        // navegador. El aviso de abajo lo dice, para no ficar en un loop de
        // reintentos.
        setFailed(true);
        throw new Error(data?.error || 'Link inválido o expirado');
      }

      // El servidor ya revoco todas las sesiones, asi que no hace falta un
      // logout aparte: la cookie de recuperacion ya no existe.
      toast.success('Contraseña actualizada. Podés iniciar sesión.');
      router.replace('/login');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la contraseña');
    } finally {
      setLoading(false);
    }
  };

  if (!linkUsable) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 p-8">
        <Card className="w-full max-w-md p-8 text-center bg-gray-800 border border-gray-700">
          <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
          <h1 className="text-2xl font-bold text-white mt-4 mb-2">Link inválido o expirado</h1>
          <p className="text-gray-400">
            Los links de recuperación son de un solo uso, vencen después de un rato y
            solo funcionan en el navegador donde los pediste. Pedí uno nuevo para
            seguir.
          </p>
          <a
            href="/auth/forgot-password"
            className="mt-6 inline-block text-indigo-400 hover:text-indigo-300 font-medium"
          >
            Pedir un link nuevo
          </a>
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
              placeholder={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={PASSWORD_MIN_LENGTH}
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
              minLength={PASSWORD_MIN_LENGTH}
              className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-400"
            />
          </div>
          <p className="text-xs text-gray-500">
            Al cambiarla se cierran todas las sesiones abiertas en cualquier dispositivo.
          </p>

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
