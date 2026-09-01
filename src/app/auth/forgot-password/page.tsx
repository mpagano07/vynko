'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import Link from 'next/link';
import toast from 'react-hot-toast';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al enviar email');

      setSubmitted(true);
      toast.success(data.message || 'Email de recuperación enviado');
    } catch (error: unknown) {
      const maybeError = error as { message?: string };
      toast.error(maybeError?.message || 'Error al enviar email');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 p-8">
        <Card className="w-full max-w-md p-8 bg-gray-800 border border-gray-700">
          <div className="text-center">
            <Image src="/icons/vynkoLogout.png?v=3" alt="Vynko" width={1530} height={590} sizes="128px" className="h-10 w-auto object-contain mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-white mb-2">Revisa tu email</h2>
            <p className="text-gray-400 mb-4">
              Te enviamos un link para restablecer tu contraseña a{' '}
              <strong className="text-gray-200">{email}</strong>. Si no lo encontrás, revisá spam o correo no deseado.
            </p>
            <Link href="/login">
              <Button variant="outline" className="mt-4 w-full border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white">
                Volver al inicio de sesión
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 p-8">
      <Card className="w-full max-w-md p-8 bg-gray-800 border border-gray-700">
        <div className="mb-8 text-center">
          <Image src="/icons/vynkoLogout.png?v=3" alt="Vynko" width={1530} height={590} sizes="128px" className="h-10 w-auto object-contain mx-auto mb-2" />
          <h1 className="text-2xl font-bold text-white mb-2">Recuperar contraseña</h1>
          <p className="text-gray-400">
            Ingresá tu email y te enviaremos un link para restablecer tu contraseña
          </p>
        </div>

        <form onSubmit={handleReset} className="space-y-4">
          <div>
            <label htmlFor="forgot-email" className="block text-sm font-medium mb-2 text-gray-300">
              Email
            </label>
            <Input
              type="email"
              id="forgot-email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-500"
            />
          </div>

          <Button
            type="submit"
            disabled={loading || !email}
            className="w-full"
          >
            {loading ? 'Enviando...' : 'Enviar link de recuperación'}
          </Button>
        </form>

        <p className="text-sm text-gray-400 text-center mt-6">
          <Link href="/login" className="text-indigo-400 hover:text-indigo-300 font-medium">
            Volver al inicio de sesión
          </Link>
        </p>
      </Card>
    </div>
  );
}
