'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Eye, EyeOff } from 'lucide-react';
import { EmailVerificationModal } from '@/components/ui/email-verification-modal';
import { FormLabel } from '@/components/ui/form-label';
import { authErrorMessage } from '@/lib/auth-errors';
import { PASSWORD_MIN_LENGTH, validatePassword } from '@/lib/password-policy';

function SignupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [companyError, setCompanyError] = useState('');
  const [ownerError, setOwnerError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [termsError, setTermsError] = useState('');

  const validate = () => {
    let valid = true;
    setEmailError('');
    setPasswordError('');
    setConfirmError('');
    setCompanyError('');
    setOwnerError('');
    setTermsError('');

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
    } else {
      // La misma politica que aplica la ruta del servidor. Si divergen, el
      // cliente deja pasar algo que el servidor va a rechazar: el usuario escribe
      // la contraseña dos veces y se come un error seco al final.
      const policy = validatePassword(password, { email: email.trim() });
      if (!policy.ok) {
        setPasswordError(policy.error);
        valid = false;
      }
    }

    if (!confirmPassword) {
      setConfirmError('Confirmá tu contraseña');
      valid = false;
    } else if (confirmPassword !== password) {
      setConfirmError('Las contraseñas no coinciden');
      valid = false;
    }

    if (!companyName.trim()) {
      setCompanyError('Ingresá el nombre de tu empresa');
      valid = false;
    }

    if (!ownerName.trim()) {
      setOwnerError('Ingresá tu nombre');
      valid = false;
    }

    if (!acceptedTerms) {
      setTermsError('Debés aceptar los Términos y la Política de Privacidad');
      valid = false;
    }

    return valid;
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          companyName: companyName.trim(),
          fullName: ownerName.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo crear la cuenta');

      if (!data.requiresConfirmation) {
        await fetch('/api/invitations/accept', { method: 'POST' });
        toast.success('Cuenta creada correctamente');
        router.push('/dashboard');
        router.refresh();
      } else {
        // Sin sesión hasta confirmar el email: nombre/empresa viajan en
        // user_metadata para que el server cree la empresa al confirmar.
        setRegisteredEmail(email.trim());
        setVerificationOpen(true);
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : authErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (!acceptedTerms) {
      setTermsError('Para continuar con Google, primero aceptá los Términos, la Política de Privacidad y la Política de Cookies');
      return;
    }
    setTermsError('');
    setLoading(true);
    try {
      // El flujo arranca en el servidor: el verifier PKCE queda en una cookie
      // HttpOnly y el canje final lo hace `/auth/callback`, que ya es de servidor.
      const res = await fetch('/api/auth/oauth?provider=google');
      const data = await res.json();
      if (!res.ok || !data?.url) {
        throw new Error(data?.error || 'No se pudo iniciar el login con Google');
      }
      // Navegacion real: el proveedor toma el control de la pestana y el estado
      // local (loading) no sobrevive al viaje de ida y vuelta.
      window.location.href = data.url;
    } catch (error: unknown) {
      toast.error(authErrorMessage(error));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-gray-900">
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center p-12">
        <div className="max-w-md">
          <div className="mb-6">
            <Image src="/icons/vynkoLogout.png?v=3" alt="Vynko" width={1530} height={590} sizes="128px" className="h-10 w-auto object-contain" />
          </div>
          <p className="text-gray-400 text-lg leading-relaxed">
            Gestioná tu stock, ventas y proveedores en un solo lugar.
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
                <p className="text-gray-400 text-sm">Seguimiento en tiempo real de tu stock</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="h-8 w-8 rounded-full bg-cyan-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <svg className="h-4 w-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-medium">Pronóstico</h3>
                <p className="text-gray-400 text-sm">Predicciones de demanda y alertas de reposición</p>
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
                <p className="text-gray-400 text-sm">Facturación y seguimiento de clientes</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex justify-center mb-8">
            <Image src="/icons/vynkoLogout.png?v=3" alt="Vynko" width={1530} height={590} sizes="96px" className="h-8 w-auto object-contain" />
          </div>

          <h2 className="text-2xl font-bold text-white mb-1">Crear cuenta</h2>
          <p className="text-gray-400 mb-8">Completá los datos para registrarte</p>

          <form onSubmit={handleSignup} noValidate className="space-y-4">
            <div>
              <FormLabel variant="default" className="text-gray-300 mb-1.5">Tu nombre</FormLabel>
              <Input
                type="text"
                name="ownerName"
                placeholder="Juan Pérez"
                value={ownerName}
                onChange={(e) => { setOwnerName(e.target.value); setOwnerError(''); }}
                className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-400"
              />
              {ownerError && <p className="text-xs text-red-400 mt-1">{ownerError}</p>}
            </div>
            <div>
              <FormLabel variant="default" className="text-gray-300 mb-1.5">Nombre de tu empresa</FormLabel>
              <Input
                type="text"
                name="companyName"
                placeholder="Mi Tienda"
                value={companyName}
                onChange={(e) => { setCompanyName(e.target.value); setCompanyError(''); }}
                className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-400"
              />
              {companyError && <p className="text-xs text-red-400 mt-1">{companyError}</p>}
            </div>
            <div>
              <FormLabel variant="default" className="text-gray-300 mb-1.5">Email</FormLabel>
              <Input
                type="email"
                name="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setEmailError(''); }}
                className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-400"
              />
              {emailError && <p className="text-xs text-red-400 mt-1">{emailError}</p>}
            </div>
            <div>
              <FormLabel variant="default" className="text-gray-300 mb-1.5">Contraseña</FormLabel>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  placeholder={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres`}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setPasswordError(''); }}
                  className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-400 pr-10"
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
              <FormLabel variant="default" className="text-gray-300 mb-1.5">Confirmar contraseña</FormLabel>
              <div className="relative">
                <Input
                  type={showConfirmPassword ? 'text' : 'password'}
                  name="confirmPassword"
                  placeholder="Repetí la contraseña"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setConfirmError(''); }}
                  className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-400 pr-10"
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

            <div className="pt-1">
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="acceptedTerms"
                  checked={acceptedTerms}
                  onChange={(e) => {
                    setAcceptedTerms(e.target.checked);
                    if (e.target.checked) setTermsError('');
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-gray-700 bg-gray-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-gray-900 cursor-pointer"
                />
                <label htmlFor="acceptedTerms" className="text-xs text-gray-300 leading-relaxed cursor-pointer select-none">
                  Acepto los{' '}
                  <Link href="/terminos" target="_blank" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2">
                    Términos y Condiciones
                  </Link>
                  , la{' '}
                  <Link href="/privacidad" target="_blank" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2">
                    Política de Privacidad
                  </Link>{' '}
                  y la{' '}
                  <Link href="/cookies" target="_blank" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2">
                    Política de Cookies
                  </Link>
                  .
                </label>
              </div>
              {termsError && <p className="text-xs text-red-400 mt-1">{termsError}</p>}
            </div>

            <Button type="submit" disabled={loading || !acceptedTerms} className="w-full">
              {loading ? 'Creando cuenta...' : 'Crear cuenta'}
            </Button>
            {!acceptedTerms && (
              <p className="text-xs text-amber-400/90 text-center">
                Marcá la casilla de aceptación para habilitar el botón.
              </p>
            )}
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-700" /></div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-gray-900 px-2 text-gray-400">O continuar con</span>
            </div>
          </div>

          <Button type="button" variant="outline" onClick={handleGoogleLogin} disabled={loading || !acceptedTerms}
            className="w-full flex items-center justify-center gap-2 border-gray-700 text-gray-300 hover:bg-gray-800 disabled:hover:bg-transparent disabled:opacity-50">
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Google
          </Button>

          <p className="text-xs text-gray-400 text-center mt-3 leading-relaxed">
            Al continuar con Google, aceptás los{' '}
            <Link href="/terminos" target="_blank" className="text-cyan-400 hover:underline">
              Términos
            </Link>
            , la{' '}
            <Link href="/privacidad" target="_blank" className="text-cyan-400 hover:underline">
              Privacidad
            </Link>{' '}
            y la{' '}
            <Link href="/cookies" target="_blank" className="text-cyan-400 hover:underline">
              Política de Cookies
            </Link>
            .
          </p>

          <p className="text-sm text-gray-400 text-center mt-8">
            ¿Ya tenés cuenta?{' '}
            <Link href="/login" className="text-cyan-400 hover:text-cyan-300 font-medium">Iniciá sesión</Link>
          </p>
        </div>
      </div>

      <EmailVerificationModal
        open={verificationOpen}
        email={registeredEmail}
        onClose={() => {
          setVerificationOpen(false);
          router.push('/login');
        }}
        onGoToLogin={() => {
          setVerificationOpen(false);
          router.push('/login');
        }}
      />
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gray-900"><div className="animate-pulse text-gray-500">Cargando...</div></div>}>
      <SignupContent />
    </Suspense>
  );
}
