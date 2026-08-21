'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, CheckCircle2, XCircle, User, Lock } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AcceptInvitePage() {
  const router = useRouter();
  const [status, setStatus] = useState<'processing' | 'accepted' | 'error'>('processing');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function accept() {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          setStatus('error');
          return;
        }

        const res = await fetch('/api/invitations/accept', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'x-refresh-token': session.refresh_token ?? '',
          },
        });
        const data = await res.json();

        if (data.accepted > 0) {
          setStatus('accepted');
        } else {
          router.push('/dashboard');
        }
      } catch {
        setStatus('error');
      }
    }
    accept();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (password.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Las contraseñas no coinciden');
      return;
    }
    setSaving(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ full_name: name.trim() }),
      });

      if (!res.ok) throw new Error('Failed to save name');

      const { error: passError } = await supabase.auth.updateUser({ password });
      if (passError) throw passError;

      toast.success('¡Bienvenido!');
      router.push('/dashboard');
    } catch {
      toast.error('Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        {status === 'processing' && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-indigo-500 mx-auto" />
            <p className="mt-4 text-gray-600">Aceptando invitación...</p>
          </>
        )}
        {status === 'accepted' && (
          <div className="max-w-sm mx-auto">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
            <p className="mt-4 text-gray-600">¡Invitación aceptada!</p>
            <p className="text-sm text-gray-400 mt-1">Completa tus datos para continuar</p>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4 text-left">
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Tu nombre"
                  aria-label="Tu nombre"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="pl-9"
                  required
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="password"
                  placeholder="Contraseña (mín. 6 caracteres)"
                  aria-label="Contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9"
                  required
                  minLength={6}
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="password"
                  placeholder="Repetir contraseña"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-9"
                  required
                  minLength={6}
                />
              </div>
              <Button type="submit" className="w-full" disabled={saving || !name.trim() || !password || !confirmPassword}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Comenzar'
                )}
              </Button>
            </form>
          </div>
        )}
        {status === 'error' && (
          <>
            <XCircle className="h-12 w-12 text-red-500 mx-auto" />
            <p className="mt-4 text-gray-600">
              Error al aceptar la invitación. Intenta iniciar sesión.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
