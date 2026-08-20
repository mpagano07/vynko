'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Eye, EyeOff } from 'lucide-react';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const validate = () => {
    let valid = true;
    setEmailError('');
    setPasswordError('');
    setConfirmError('');

    if (!email.trim()) {
      setEmailError('Ingresá tu email para continuar');
      valid = false;
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      setEmailError('Email inválido');
      valid = false;
    }

    if (!password) {
      setPasswordError('Ingresá una contraseña');
      valid = false;
    } else if (password.length < 6) {
      setPasswordError('Mínimo 6 caracteres');
      valid = false;
    }

    if (!confirmPassword) {
      setConfirmError('Confirmá tu contraseña');
      valid = false;
    } else if (confirmPassword !== password) {
      setConfirmError('Las contraseñas no coinciden');
      valid = false;
    }

    return valid;
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      if (error) throw error;

      if (data?.user?.identities?.length === 0) {
        toast.error('Este email ya está registrado. Usá "Olvidé mi contraseña" para acceder.');
        setEmail('');
        setPassword('');
        setConfirmPassword('');
        return;
      }

      if (data?.session) {
        await fetch('/api/invitations/accept', { method: 'POST' });
        toast.success('Cuenta creada correctamente');
        router.push('/dashboard');
        router.refresh();
      } else {
        toast.success('Cuenta creada. Revisá tu email para confirmar el registro.');
        router.push('/login');
      }
    } catch (error: unknown) {
      const maybeError = error as { message?: string };
      toast.error(maybeError?.message || 'Error al crear cuenta');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
    } catch (error: unknown) {
      const maybeError = error as { message?: string };
      toast.error(maybeError?.message || 'Error al iniciar con Google');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-gray-900">
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center p-12">
        <div className="max-w-md">
          <div className="mb-6">
            <Image src="/icons/vynkoLogout.png?v=3" alt="Vynko" width={1530} height={590} className="h-10 w-auto object-contain" />
          </div>
          <p className="text-gray-400 text-lg leading-relaxed">
            Gestioná tu stock, ventas y proveedores en un solo lugar con inteligencia artificial.
          </p>
          <div className="mt-12 space-y-6">
            <div className="flex items-start gap-4">
              <div className="h-8 w-8 rounded-full bg-cyan-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <svg className="h-4 w-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-medium">Control de inventario</h3>
                <p className="text-gray-500 text-sm">Seguimiento en tiempo real de tu stock</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="h-8 w-8 rounded-full bg-cyan-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <svg className="h-4 w-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-medium">Pronóstico con IA</h3>
                <p className="text-gray-500 text-sm">Predicciones de demanda y alertas de reposición</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="h-8 w-8 rounded-full bg-cyan-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <svg className="h-4 w-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-medium">Gestión de ventas</h3>
                <p className="text-gray-500 text-sm">Facturación y seguimiento de clientes</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex justify-center mb-8">
            <Image src="/icons/vynkoLogout.png?v=3" alt="Vynko" width={1530} height={590} className="h-8 w-auto object-contain" />
          </div>

          <h2 className="text-2xl font-bold text-white mb-1">Crear cuenta</h2>
          <p className="text-gray-400 mb-8">Completá los datos para registrarte</p>

          <form onSubmit={handleSignup} noValidate className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5 text-gray-300">Email</label>
              <Input
                type="email"
                name="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setEmailError(''); }}
                className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500"
              />
              {emailError && <p className="text-xs text-red-400 mt-1">{emailError}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5 text-gray-300">Contraseña</label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setPasswordError(''); }}
                  className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-200"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {passwordError && <p className="text-xs text-red-400 mt-1">{passwordError}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5 text-gray-300">Confirmar contraseña</label>
              <div className="relative">
                <Input
                  type={showConfirmPassword ? 'text' : 'password'}
                  name="confirmPassword"
                  placeholder="Repetí la contraseña"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setConfirmError(''); }}
                  className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-200"
                  aria-label={showConfirmPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {confirmError && <p className="text-xs text-red-400 mt-1">{confirmError}</p>}
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Creando cuenta...' : 'Crear cuenta'}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-700" /></div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-gray-900 px-2 text-gray-500">O continuar con</span>
            </div>
          </div>

          <Button type="button" variant="outline" onClick={handleGoogleLogin} disabled={loading}
            className="w-full flex items-center justify-center gap-2 border-gray-700 text-gray-300 hover:bg-gray-800">
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Google
          </Button>

          <p className="text-sm text-gray-500 text-center mt-8">
            ¿Ya tenés cuenta?{' '}
            <Link href="/login" className="text-cyan-400 hover:text-cyan-300 font-medium">Iniciá sesión</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
