'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Eye, EyeOff } from 'lucide-react';
import BiometricLogin from '@/components/auth/BiometricLogin';
import FingerprintSetup from '@/components/auth/FingerprintSetup';

export const dynamic = 'force-dynamic';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [showBiometricSetup, setShowBiometricSetup] = useState(false);

  const redirectTo = searchParams?.get('redirect') || '/dashboard';

  useEffect(() => {
    const saved = localStorage.getItem('stockpilot_remember');
    if (saved) {
      try {
        const { email: savedEmail, password: savedPassword } = JSON.parse(saved);
        if (savedEmail) {
          setEmail(savedEmail);
          if (savedPassword) setPassword(savedPassword);
          setRemember(true);
        }
      } catch {}
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const emailVal = email;
    const passwordVal = password;

    if (!emailVal.trim() || !passwordVal.trim()) {
      toast.error('Completá ambos campos para iniciar sesión');
      setLoading(false);
      return;
    }

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: emailVal,
        password: passwordVal,
      });

      if (error) throw error;

      if (remember) {
        localStorage.setItem('stockpilot_remember', JSON.stringify({ email: emailVal, password: passwordVal }));
      } else {
        localStorage.removeItem('stockpilot_remember');
      }

      toast.success('Sesión iniciada correctamente');
      setShowBiometricSetup(true);
    } catch (error: unknown) {
      const maybeError = error as { message?: string };
      toast.error(maybeError?.message || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
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
          <div className="flex items-center gap-3 mb-6">
            <div className="h-10 w-10 rounded-lg bg-indigo-500 flex items-center justify-center">
              <span className="text-white font-bold text-lg">S</span>
            </div>
            <h1 className="text-2xl font-bold text-white">StockPilot</h1>
          </div>
          <p className="text-gray-400 text-lg leading-relaxed">
            Gestión de stock inteligente. Controlá tu inventario, ventas y
            proveedores en un solo lugar.
          </p>
          <div className="mt-12 space-y-6">
            <div className="flex items-start gap-4">
              <div className="h-8 w-8 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <svg className="h-4 w-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-medium">Control de inventario</h3>
                <p className="text-gray-500 text-sm">Seguimiento en tiempo real de tu stock</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="h-8 w-8 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <svg className="h-4 w-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-medium">Pronóstico con IA</h3>
                <p className="text-gray-500 text-sm">Predicciones de demanda y alertas de reposición</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="h-8 w-8 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <svg className="h-4 w-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="h-9 w-9 rounded-lg bg-indigo-500 flex items-center justify-center">
              <span className="text-white font-bold text-base">S</span>
            </div>
            <h1 className="text-xl font-bold text-white">StockPilot</h1>
          </div>

          <h2 className="text-2xl font-bold text-white mb-1">Iniciar sesión</h2>
          <p className="text-gray-400 mb-8">Ingresá tus credenciales para continuar</p>

          <form onSubmit={handleLogin} noValidate className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5 text-gray-300">
                Email
              </label>
              <Input
                type="email"
                name="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5 text-gray-300">
                Contraseña
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0"
                />
                <span className="text-sm text-gray-400">Recordarme</span>
              </label>
              <Link
                href="/auth/forgot-password"
                className="text-sm text-indigo-400 hover:text-indigo-300 font-medium"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full"
            >
              {loading ? 'Iniciando sesión...' : 'Iniciar sesión'}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-700" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-gray-900 px-2 text-gray-500">O continuar con</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 border-gray-700 text-gray-300 hover:bg-gray-800"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Google
          </Button>

          <BiometricLogin />

          {showBiometricSetup && (
            <FingerprintSetup
              onComplete={() => {
                router.push(redirectTo);
                router.refresh();
              }}
              onSkip={() => {
                router.push(redirectTo);
                router.refresh();
              }}
            />
          )}

          <p className="text-sm text-gray-500 text-center mt-8">
            ¿No tienes cuenta?{' '}
            <Link
              href="/auth/signup"
              className="text-indigo-400 hover:text-indigo-300 font-medium"
            >
              Registrate
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-900">
          <div className="animate-pulse text-gray-500">Cargando...</div>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
