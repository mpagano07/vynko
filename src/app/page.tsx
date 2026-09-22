'use client';

import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { PLANS } from '@/lib/plans';
import { isTrialExpired } from '@/lib/checkSubscription';
import { useAuth } from '@/lib/hooks/useAuth';
import { hasStoredSession, type TenantInfo } from '@/lib/contexts/auth-context';
import { SALES_EMAIL } from '@/lib/tenant-config';

import { formatARS } from '@/lib/utils/currency';

const DemoSales = dynamic(() => import('@/components/landing/DemoSales'), {
  ssr: false,
  loading: () => (
    <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-12 text-center">
      <div className="h-8 w-48 bg-gray-800 animate-pulse rounded mx-auto" />
    </div>
  ),
});

const ROICalculator = dynamic(() => import('@/components/landing/ROICalculator'), {
  ssr: false,
  loading: () => (
    <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-12 text-center">
      <div className="h-8 w-48 bg-gray-800 animate-pulse rounded mx-auto" />
    </div>
  ),
});

const DashboardPreviewChart = dynamic(() => import('@/components/landing/DashboardPreviewChart'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-end gap-1 px-2">
      {[
        { name: 'Lun', ventas: 4200 },
        { name: 'Mar', ventas: 3800 },
        { name: 'Mié', ventas: 5100 },
        { name: 'Jue', ventas: 4700 },
        { name: 'Vie', ventas: 6300 },
        { name: 'Sáb', ventas: 5500 },
        { name: 'Dom', ventas: 4800 },
      ].map((d) => (
        <div
          key={d.name}
          className="flex-1 bg-cyan-900/40 rounded-t"
          style={{ height: `${(d.ventas / 6300) * 100}%` }}
        />
      ))}
    </div>
  ),
});

export default function LandingPage() {
  const router = useRouter();
  const { user, profile, tenant, tenants, logout, loading: authLoading, loadProfileAndTenant } = useAuth();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [termsError, setTermsError] = useState('');
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const tenantRef = useRef<TenantInfo | null>(null);
  const tenantsRef = useRef<TenantInfo[]>([]);
  const redirectedRef = useRef(false);

  useEffect(() => { tenantRef.current = tenant; }, [tenant]);
  useEffect(() => { tenantsRef.current = tenants; }, [tenants]);
  useEffect(() => { if (!user) redirectedRef.current = false; }, [user]);

  useEffect(() => {
    if (redirectedRef.current || authLoading) return;

    if (user) {
      redirectedRef.current = true;
      (async () => {
        try {
          await loadProfileAndTenant();
        } catch {
          // fall through with current state; the app's own guards redirect next
        }
        const hasTenants = !!tenantRef.current || tenantsRef.current.length > 0;
        router.replace(hasTenants ? '/dashboard' : '/onboarding');
      })();
      return;
    }

    // Safety net: the auth client can end up "settled logged-out" while a
    // session cookie still exists (e.g. a failed token refresh after the email
    // confirmation exchange). The user IS authenticated server-side, so don't
    // leave them staring at the marketing navbar — /onboarding re-checks
    // /api/session and bounces existing customers to /dashboard.
    if (hasStoredSession()) {
      redirectedRef.current = true;
      router.replace('/onboarding');
    }
  }, [authLoading, user, loadProfileAndTenant, router]);

  useEffect(() => {
    // Inicialización única (evita mismatch de hidratación)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMounted(true);
  }, []);

  const trialExpired = isTrialExpired(tenant);
  const hasSession = hasStoredSession();

  const handleWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');
    setTermsError('');
    let valid = true;
    if (!email.trim()) {
      setEmailError('Ingresá tu email para continuar');
      valid = false;
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      setEmailError('Email inválido');
      valid = false;
    }
    if (!acceptedTerms) {
      setTermsError('Debés aceptar los Términos, la Política de Privacidad y la Política de Cookies');
      valid = false;
    }
    if (!valid) return;
    setWaitlistLoading(true);
    await new Promise(r => setTimeout(r, 600));
    setWaitlistLoading(false);
    router.push(`/auth/signup?email=${encodeURIComponent(email.trim())}`);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-gray-800/50 bg-gray-950/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            <div className="flex items-center gap-8">
              <Link href="/" className="flex items-center">
                <Image src="/icons/vynkoLogout.png?v=3" alt="Vynko" width={1530} height={590} sizes="128px" className="h-10 w-auto object-contain" />
              </Link>
              <div className="hidden md:flex items-center gap-6">
                <Link href="#features" className="text-sm text-gray-400 hover:text-white transition-colors">Características</Link>
                <Link href="#how-it-works" className="text-sm text-gray-400 hover:text-white transition-colors">Cómo funciona</Link>
                <Link href="#pricing" className="text-sm text-gray-400 hover:text-white transition-colors">Precios</Link>
              </div>
            </div>
            {isMounted && (<div className="flex items-center gap-3">
              {user || hasSession ? (
                <>
                  <Link
                    href="/dashboard"
                    className="text-sm font-medium text-gray-300 hover:text-white transition-colors px-4 py-2"
                  >
                    {profile?.full_name || user?.email || 'Mi cuenta'}
                  </Link>
                  <button
                    onClick={async () => { await logout(); router.push('/'); }}
                    className="text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded-lg border border-gray-700 transition-colors"
                  >
                    Cerrar sesión
                  </button>
                </>
              ) : authLoading ? (
                <div className="h-8 w-32 rounded-lg bg-gray-800/60 animate-pulse" />
              ) : (
                <>
                  <Link
                    href="/login"
                    className="text-sm font-medium text-gray-300 hover:text-white transition-colors px-4 py-2"
                  >
                    Iniciar sesión
                  </Link>
                  <Link
                    href="/auth/signup"
                    className="text-sm font-medium bg-cyan-500 hover:bg-cyan-400 text-black px-4 py-2 rounded-lg transition-colors"
                  >
                    Comenzar gratis
                  </Link>
                </>
              )}
            </div> )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-36 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 via-transparent to-transparent" />
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-cyan-500/5 rounded-full blur-3xl" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-medium mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                Gestión de stock
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight">
                Controlá tu{' '}
                <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">inventario</span>
                {' '}en tiempo real
              </h1>
              <p className="mt-6 text-lg text-gray-400 leading-relaxed max-w-lg">
                Olvidate de las planillas. Escaneá productos con tu teléfono, sincronizá al instante con tu negocio y recibí alertas automáticas de reposición.
              </p>
              <form onSubmit={handleWaitlist} noValidate className="mt-8 max-w-md">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <input
                      type="email"
                      value={email}
                      onChange={e => { setEmail(e.target.value); setEmailError(''); }}
                      placeholder="tu@email.com"
                      className="w-full px-4 py-3 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder:text-gray-400 focus:outline-none focus:border-cyan-500/50 text-sm"
                    />
                    {emailError && <p className="text-xs text-red-400 mt-1.5">{emailError}</p>}
                  </div>
                  <button
                    type="submit"
                    disabled={waitlistLoading}
                    className="px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold rounded-lg transition-colors text-sm disabled:opacity-50 h-fit"
                  >
                    {waitlistLoading ? 'Enviando...' : 'Comenzar gratis'}
                  </button>
                </div>
                <div className="mt-4 flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    id="landingAcceptedTerms"
                    checked={acceptedTerms}
                    onChange={(e) => {
                      setAcceptedTerms(e.target.checked);
                      if (e.target.checked) setTermsError('');
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-gray-700 bg-gray-900 text-cyan-500 focus:ring-cyan-500 cursor-pointer"
                  />
                  <label htmlFor="landingAcceptedTerms" className="text-xs text-gray-400 leading-relaxed cursor-pointer select-none">
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
                    </Link>.
                  </label>
                </div>
                {termsError && <p className="text-xs text-red-400 mt-1.5">{termsError}</p>}
              </form>
              <p className="mt-3 text-xs text-gray-400">
                Sin compromiso. 45 días de prueba gratuita.
              </p>
            </div>

            {/* Dashboard Preview */}
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-tr from-cyan-500/10 via-transparent to-blue-500/10 rounded-2xl blur-2xl" />
              <div className="relative bg-gray-900/80 backdrop-blur-xl border border-gray-800 rounded-2xl p-6 shadow-2xl">
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="ml-2 text-xs text-gray-400">Dashboard Preview</span>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-6">
                  {[
                    { label: 'Ventas hoy', value: '$4.850', color: 'text-cyan-400' },
                    { label: 'Productos', value: '1.247', color: 'text-blue-400' },
                    { label: 'Alertas', value: '3', color: 'text-amber-400' },
                  ].map(k => (
                    <div key={k.label} className="bg-gray-950/60 rounded-lg p-3 border border-gray-800/50">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider">{k.label}</p>
                      <p className={`text-lg font-bold mt-1 ${k.color}`}>{k.value}</p>
                    </div>
                  ))}
                </div>
                <div className="h-32">
                  {isMounted ? (
                    <DashboardPreviewChart />
                  ) : (
                    <div className="w-full h-full flex items-end gap-1 px-2">
                      {[
                        { name: 'Lun', ventas: 4200 },
                        { name: 'Mar', ventas: 3800 },
                        { name: 'Mié', ventas: 5100 },
                        { name: 'Jue', ventas: 4700 },
                        { name: 'Vie', ventas: 6300 },
                        { name: 'Sáb', ventas: 5500 },
                        { name: 'Dom', ventas: 4800 },
                      ].map((d) => (
                        <div
                          key={d.name}
                          className="flex-1 bg-cyan-900/40 rounded-t"
                          style={{ height: `${(d.ventas / 6300) * 100}%` }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div className="mt-4 flex items-center gap-3 p-3 bg-amber-500/5 border border-amber-500/10 rounded-lg">
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <p className="text-xs text-amber-400/90"><span className="font-semibold">Alerta:</span> 3 productos con stock crítico</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Demo Section */}
      <section className="py-20 bg-gray-900/30" id="demo">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-medium mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Prueba ahora — sin registro
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold">Probá Vynko <span className="text-cyan-400">en acción</span></h2>
            <p className="mt-4 text-gray-400 max-w-lg mx-auto">Sumá productos al carrito, simulá una venta y experimentá la interfaz. Sin crear cuenta, sin compromiso.</p>
          </div>
          <div className="max-w-5xl mx-auto">
            <DemoSales />
          </div>
        </div>
      </section>

      {/* Comparison Section */}
      <section className="py-20" id="features">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold">El método antiguo vs <span className="text-cyan-400">Vynko</span></h2>
            <p className="mt-4 text-gray-400">La diferencia entre sobrevivir y escalar tu negocio.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-8">
              <div className="text-4xl mb-4">📋</div>
              <h3 className="text-xl font-bold text-gray-300 mb-4">Excel + papel</h3>
              <ul className="space-y-3">
                {[
                  'Actualización manual de stock',
                  'Errores de tipeo y descuadres',
                  'Sin alertas de reposición',
                  'Datos desactualizados',
                  'Difícil de compartir con el equipo',
                ].map(item => (
                  <li key={item} className="flex items-start gap-3 text-sm text-gray-400">
                    <span className="text-red-400 mt-0.5">✕</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-2xl p-8 relative">
              <div className="absolute -top-3 left-8 px-3 py-1 bg-cyan-500 text-black text-xs font-bold rounded-full">Recomendado</div>
              <div className="text-4xl mb-4">🚀</div>
              <h3 className="text-xl font-bold text-cyan-400 mb-4">Vynko</h3>
              <ul className="space-y-3">
                {[
                  'Escaneo móvil en tiempo real',
                  'Sincronización automática 2-way',
                  'Alertas de bajo stock',
                  'Pronósticos',
                  'Acceso multi-dispositivo',
                ].map(item => (
                  <li key={item} className="flex items-start gap-3 text-sm text-gray-300">
                    <span className="text-cyan-400 mt-0.5">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-gray-900/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold">Todo lo que necesitás para gestionar tu stock</h2>
            <p className="mt-4 text-gray-400">Una plataforma completa para tu negocio.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-8 max-w-2xl mx-auto">
            {[
              {
                icon: '📱',
                title: 'Teléfono como escáner',
                desc: 'Usá la cámara de tu celular para escanear códigos de barras y actualizar el stock al instante.',
              },
              {
                icon: '🔔',
                title: 'Alertas de bajo stock',
                desc: 'Recibí notificaciones cuando un producto está por debajo del mínimo. Nunca más te quedés sin stock.',
              },
            ].map(f => (
              <div key={f.title} className="bg-gray-950 border border-gray-800 rounded-2xl p-8 hover:border-cyan-500/30 transition-colors">
                <div className="text-4xl mb-4">{f.icon}</div>
                <h3 className="text-lg font-bold mb-3">{f.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ROI Calculator Section */}
      <section className="py-20 bg-gray-950" id="roi">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold">¿Cuánto <span className="text-cyan-400">podés ahorrar</span>?</h2>
            <p className="mt-4 text-gray-400">Ingresá los datos de tu negocio y calculá el impacto real.</p>
          </div>
          <div className="max-w-4xl mx-auto">
            <ROICalculator />
          </div>
        </div>
      </section>

      {/* How it works - 3 steps */}
      <section className="py-20" id="how-it-works">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold">Empezá en <span className="text-cyan-400">3 pasos</span></h2>
            <p className="mt-4 text-gray-400">Menos de 5 minutos y ya estás operando.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: '01', title: 'Importá tu catálogo', desc: 'Subí tu lista de productos desde Excel.' },
              { step: '02', title: 'Escaneá productos', desc: 'Usá tu teléfono para escanear códigos de barras y registrar movimientos.' },
              { step: '03', title: 'Sincronizá todo', desc: 'El stock se actualiza automáticamente en todos tus canales de venta.' },
            ].map(s => (
              <div key={s.step} className="text-center">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-6">
                  <span className="text-2xl font-bold text-cyan-400">{s.step}</span>
                </div>
                <h3 className="text-lg font-bold mb-3">{s.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-20 bg-gray-900/30" id="pricing">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold">Planes simples y transparentes</h2>
            <p className="mt-4 text-gray-400">Elegí el plan que mejor se adapte a tu negocio.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {Object.entries(PLANS).map(([id, plan]) => {
              const isPopular = id === 'starter';
              return (
                <div
                  key={id}
                  className={`relative rounded-2xl p-8 ${
                    plan.comingSoon
                      ? 'bg-gray-950 border border-dashed border-gray-700'
                      : isPopular
                        ? 'bg-gray-900 border-2 border-cyan-500/40 shadow-xl shadow-cyan-500/5'
                        : 'bg-gray-950 border border-gray-800'
                  }`}
                >
                  {plan.badge && (
                    <div
                      className={`absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 text-xs font-bold rounded-full whitespace-nowrap ${
                        plan.comingSoon ? 'bg-gray-700 text-gray-300' : 'bg-cyan-500 text-black'
                      }`}
                    >
                      {plan.badge}
                    </div>
                  )}
                  <h3 className="text-lg font-bold mb-2">{plan.name}</h3>
                  <div className="mb-6">
                    {plan.comingSoon ? (
                      <span className="text-2xl font-semibold text-gray-400">Próximamente</span>
                    ) : id === 'enterprise' ? (
                      <span className="text-4xl font-extrabold">A medida</span>
                    ) : (
                      <>
                        <span className="text-4xl font-extrabold">{formatARS(plan.price)}</span>
                        <span className="text-sm text-gray-400 ml-1">/mes</span>
                      </>
                    )}
                  </div>
                  <ul className="space-y-3 mb-8">
                    {plan.features.map((f, i) => (
                      <li
                        key={i}
                        className={`flex items-start gap-3 text-sm ${f.included ? 'text-gray-400' : 'text-gray-500'}`}
                      >
                        <span className={`mt-0.5 ${f.included ? 'text-cyan-400' : 'text-gray-500'}`}>
                          {f.included ? '✓' : '✗'}
                        </span>
                        <span>
                          {f.label}
                          {f.value && <span className="text-gray-200 font-medium"> {f.value}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {plan.comingSoon ? (
                    <span className="block text-center w-full py-3 rounded-lg font-semibold text-sm bg-gray-800 text-gray-400 border border-gray-700 cursor-not-allowed">
                      Próximamente
                    </span>
                  ) : id === 'enterprise' ? (
                    <a
                      href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent('Cotización Plan Enterprise - Vynko')}`}
                      className="block text-center w-full py-3 rounded-lg font-semibold text-sm transition-colors bg-amber-500 hover:bg-amber-400 text-black"
                    >
                      Pensado a tu medida
                    </a>
                  ) : (
                    <Link
                      href={id === 'starter' && trialExpired ? '/billing' : '/auth/signup'}
                      className={`block text-center w-full py-3 rounded-lg font-semibold text-sm transition-colors ${
                        isPopular
                          ? 'bg-cyan-500 hover:bg-cyan-400 text-black'
                          : 'bg-gray-800 hover:bg-gray-700 text-white border border-gray-700'
                      }`}
                    >
                      {id === 'starter' && trialExpired ? 'Suscribirse' : id === 'starter' ? 'Comenzar gratis' : 'Suscribirse'}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-6">
            ¿Listo para dejar atrás las planillas?
          </h2>
          <p className="text-gray-400 mb-8 max-w-lg mx-auto">
            Comenzá a gestionar tu inventario y ventas con Vynko hoy mismo.
          </p>
          <Link
            href="/auth/signup"
            className="inline-flex items-center gap-2 px-8 py-4 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-xl text-lg transition-colors"
          >
            Comenzar gratis
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 border-t border-gray-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <Image src="/icons/vynkoLogout.png?v=3" alt="Vynko" width={1530} height={590} sizes="128px" className="h-12 w-auto object-contain" />
            </div>
            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6 text-sm text-gray-400">
              <div className="flex items-center gap-6">
                <Link href="/privacidad" className="hover:text-gray-200 transition-colors">Privacidad</Link>
                <Link href="/terminos" className="hover:text-gray-200 transition-colors">Términos</Link>
                <Link href="/cookies" className="hover:text-gray-200 transition-colors">Cookies</Link>
              </div>
              <span className="text-xs text-gray-400">
                © {new Date().getFullYear()} Vynko. Todos los derechos reservados.
                <span className="hidden sm:inline"> Logotipo e imágenes: propiedad de Vynko.</span>
              </span>
            </div>
          </div>
        </div>
      </footer>

      {/* Sticky Mobile CTA */}
      {isMounted && !user && !hasSession && (
        <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-gray-800/50 bg-gray-950/95 backdrop-blur-xl px-4 py-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <Link
            href="/auth/signup"
            className="flex items-center justify-center gap-2 w-full py-3.5 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-xl text-sm transition-colors shadow-lg shadow-cyan-500/20"
          >
            Comenzar gratis — 45 días de prueba
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
          </Link>
        </div>
      )}
    </div>
  );
}
