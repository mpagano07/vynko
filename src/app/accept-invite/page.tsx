'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, CheckCircle2, XCircle, User, Lock } from 'lucide-react';
import { validatePassword, PASSWORD_MIN_LENGTH } from '@/lib/password-policy';
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
        // La sesion viaja en la cookie HttpOnly; la ruta la resuelve en el
        // servidor. Antes se mandaba el Bearer y por eso la ruta tambien tenia
        // esa rama: ya no hace falta.
        const res = await fetch('/api/invitations/accept', {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) {
          setStatus('error');
          return;
        }
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

    const check = validatePassword(password);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Las contraseñas no coinciden');
      return;
    }
    setSaving(true);

    try {
      const res = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: name.trim() }),
      });

      if (!res.ok) throw new Error('Failed to save name');

      // Endpoint propio, y no el de cambio de contrasena: ese pide la contrasena
      // actual como prueba, y una cuenta que entra por primera vez no tiene
      // ninguna. Aca la prueba es la invitacion pendiente del mismo email. El
      // servidor revoca todas las sesiones al terminar, asi que despues hay que
      // entrar de nuevo.
        const passRes = await fetch('/api/auth/invitation-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPassword: password }),
        });
        const passData = await passRes.json();
        if (!passRes.ok) {
          // 403 con este mensaje es el caso de una cuenta que ya estaba en uso: el
          // servidor no permite fijar la contrasena sin la anterior. No es un
          // error de este formulario, asi que no se lo muestra como si lo fuera.
          //
          // Va a /dashboard y no a /settings porque /settings expulsa a los
          // `member` (hace replace a /dashboard), y el `member` con una
          // invitacion nueva es justo quien cae en este 403. La sesion sigue
          // viva: el servidor solo revoca cuando efectivamente toco la
          // contrasena, que aca no ocurrio.
          if (passRes.status === 403 && /ya tiene una contraseña/i.test(passData?.error ?? '')) {
            toast.error(passData.error, { duration: 8000 });
            router.replace('/dashboard');
            return;
          }
          throw new Error(passData?.error || 'No se pudo guardar la contraseña');
        }

        toast.success('¡Listo! Iniciá sesión con tu nueva contraseña.');
        router.replace('/login');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
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
                  placeholder={`Contraseña (mín. ${PASSWORD_MIN_LENGTH} caracteres)`}
                  aria-label="Contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={PASSWORD_MIN_LENGTH}
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
                  minLength={PASSWORD_MIN_LENGTH}
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
