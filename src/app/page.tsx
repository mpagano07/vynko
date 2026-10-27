'use client';

import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { PLANS, getActivePromoPlan, getPlanBadge, getTrialDays, getTrialPlan } from '@/lib/plans';
import { isTrialExpired } from '@/lib/checkSubscription';
import { useAuth } from '@/lib/hooks/useAuth';
import { type TenantInfo } from '@/lib/contexts/auth-context';
import { SALES_EMAIL } from '@/lib/tenant-config';
import { SEO_PAGES, seoPath } from '@/lib/marketing/seo-landing';
import { INSTAGRAM_URL } from '@/lib/marketing/social';

import { formatPriceByCountry, getDisplayPrice, getConfiguredCurrenciesFromCookie, type CountryCode, type ConfiguredCurrencies, type PlanId } from '@/lib/pricing';

import PromoCountdown from '@/components/landing/PromoCountdown';

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
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [country, setCountry] = useState<CountryCode>('AR');
  // Monedas de Paddle configuradas, leidas de la cookie que setea el proxy: el
  // cliente no puede leer `PADDLE_PRICE_IDS`. `null`/undefined usa el default.
  const [configuredCurrencies, setConfiguredCurrencies] = useState<ConfiguredCurrencies>(undefined);

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

    // Nota: ya no hay red de seguridad basada en leer la cookie desde el
    // navegador. Con la cookie de sesion HttpOnly el cliente no puede ver si hay
    // sesion, y esa es la garantia buscada. Si el servidor tiene una sesion
    // valida, `resolveSessionUser()` la devuelve y el bloque de arriba redirige;
    // el caso "el cliente quedo deslogueado pero el servidor tiene sesion" ya no
    // puede darse porque la unica fuente de verdad es `/api/session`.
  }, [authLoading, user, loadProfileAndTenant, router]);

  useEffect(() => {
    // Inicialización única (evita mismatch de hidratación)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMounted(true);
    try {
      const match = document.cookie.match(/(?:^|; )vynko_country=([^;]+)/);
      if (match) {
        const c = decodeURIComponent(match[1]).toUpperCase().slice(0,2) as CountryCode;
        setCountry(c as CountryCode);
      }
      setConfiguredCurrencies(getConfiguredCurrenciesFromCookie());
    } catch {
      // Las cookies de país/monedas son best-effort: si no están, quedan los defaults.
    }
  }, []);

  const trialExpired = isTrialExpired(tenant);
  // La sesion vive en una cookie HttpOnly, asi que no se puede consultar desde
  // el navegador: se usa el usuario que ya resolvió el contexto contra
  // `/api/session`. Mientras está cargando no se decide, para no renderizar el
  // navbar de visitante y cambiarlo a de usuario logueado al resolver.
  const hasSession = !authLoading && !!user;

  const handleWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');
    let valid = true;
    if (!email.trim()) {
      setEmailError('Ingresá tu email para continuar');
      valid = false;
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      setEmailError('Email inválido');
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
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-20">
            <div className="flex items-center gap-4 sm:gap-8 min-w-0">
              <Link href="/" className="flex items-center flex-shrink-0">
                <Image src="/icons/vynkoLogout.png?v=3" alt="Vynko" width={1530} height={590} sizes="128px" className="h-8 sm:h-10 w-auto object-contain" />
              </Link>
              <div className="hidden md:flex items-center gap-6">
                <Link href="#soluciones" className="text-sm text-gray-400 hover:text-white transition-colors">Soluciones</Link>
                <Link href="#features" className="text-sm text-gray-400 hover:text-white transition-colors">Características</Link>
                <Link href="#how-it-works" className="text-sm text-gray-400 hover:text-white transition-colors">Cómo funciona</Link>
                <Link href="#pricing" className="text-sm text-gray-400 hover:text-white transition-colors">Precios</Link>
                <Link href="#demo" className="text-sm text-gray-400 hover:text-white transition-colors">Ver demo</Link>
                <Link href="#roi" className="text-sm text-gray-400 hover:text-white transition-colors">Calculá cuánto podés ahorrar</Link>
              </div>
            </div>
            {isMounted && (<div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
              {user || hasSession ? (
                <>
                  <Link
                    href="/dashboard"
                    className="text-xs sm:text-sm font-medium text-gray-300 hover:text-white transition-colors px-2 sm:px-4 py-1.5 sm:py-2 truncate max-w-[100px] xs:max-w-[120px] sm:max-w-none"
                  >
                    {profile?.full_name || user?.email || 'Mi cuenta'}
                  </Link>
                  <button
                    onClick={async () => { await logout(); router.push('/'); }}
                    className="text-xs sm:text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg border border-gray-700 transition-colors whitespace-nowrap"
                  >
                    Cerrar sesión
                  </button>
                </>
              ) : authLoading ? (
                <div className="h-7 w-20 sm:h-8 sm:w-32 rounded-lg bg-gray-800/60 animate-pulse" />
              ) : (
                <>
                  <Link
                    href="/login"
                    className="text-xs sm:text-sm font-medium text-gray-300 hover:text-white transition-colors px-1.5 sm:px-4 py-1.5 sm:py-2 whitespace-nowrap"
                  >
                    Iniciar sesión
                  </Link>
                  <Link
                    href="/auth/signup"
                    className="text-xs sm:text-sm font-medium bg-cyan-500 hover:bg-cyan-400 text-black px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg transition-colors whitespace-nowrap"
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
                Sistema de gestión de{' '}
                <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">stock y ventas</span>{' '}
                para comercios
              </h1>
              <p className="mt-6 text-lg text-gray-400 leading-relaxed max-w-lg">
                Sabé qué tenés, qué vendés y cuánto perdés, en todas tus sucursales. Vynko reemplaza tus planillas con una sola herramienta: caja, stock, compras, clientes y documentos, con datos en tiempo real. Escaneá con el celular, vendé en segundos y enterate a tiempo cuando algo falta o se pierde.
              </p>
              <form onSubmit={handleWaitlist} noValidate className="mt-8 max-w-md">
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <div className="flex-1 min-w-0">
                    <input
                      type="email"
                      value={email}
                      onChange={e => { setEmail(e.target.value); setEmailError(''); }}
                      placeholder="tu@email.com"
                      className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder:text-gray-400 focus:outline-none focus:border-cyan-500/50 text-sm"
                    />
                    {emailError && <p className="text-xs text-red-400 mt-1.5">{emailError}</p>}
                  </div>
                  <button
                    type="submit"
                    disabled={waitlistLoading}
                    className="w-full sm:w-auto px-4 sm:px-6 py-2.5 sm:py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold rounded-lg transition-colors text-sm disabled:opacity-50 whitespace-nowrap"
                  >
                    {waitlistLoading ? 'Enviando...' : 'Comenzar gratis'}
                  </button>
                </div>
              </form>
              <p className="mt-3 text-xs text-gray-400">
                {getTrialDays() || 0} días de prueba · Sin tarjeta · Cancelás cuando quieras
              </p>
              <p className="mt-2 text-xs text-gray-500">
                Importá tu catálogo desde Mercado Libre o Tiendanube.
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
          <div className="mt-16 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-300">
            {['Stock en tiempo real', 'Caja en segundos', 'Multi-sucursal', 'Control de mermas'].map((item) => (
              <div key={item} className="flex items-center gap-2">
                <span className="text-cyan-400">✓</span>
                {item}
              </div>
            ))}
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
      <section className="py-20" id="comparison">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold">Excel + papel vs <span className="text-cyan-400">Vynko</span></h2>
            <p className="mt-4 text-gray-400">La diferencia entre sobrevivir y escalar tu negocio.</p>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-gray-800">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="bg-gray-900/60">
                  <th className="p-4 text-xs font-semibold uppercase tracking-wider text-gray-500">&nbsp;</th>
                  <th className="p-4 text-sm font-bold text-gray-300">Excel + papel</th>
                  <th className="p-4 text-sm font-bold text-cyan-400">Vynko</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { aspect: 'Stock', excel: 'Se actualiza a mano', vynko: 'Se descuenta solo en cada venta' },
                  { aspect: 'Sucursales', excel: 'Una planilla por local', vynko: 'Una cuenta, stock por local y transferencias' },
                  { aspect: 'Mermas', excel: 'Nadie sabe cuánto se pierde', vynko: 'Registro valuado en pesos y ranking' },
                  { aspect: 'Compras', excel: 'Pedidos sueltos y mercadería sin registrar', vynko: 'Pedido → recepción → remito y stock al día' },
                  { aspect: 'Empleados', excel: 'Cualquiera edita cualquier cosa', vynko: 'Roles y permisos por sucursal' },
                  { aspect: 'Control', excel: 'Sin saber quién cambió qué', vynko: 'Auditoría completa de cada acción' },
                  { aspect: 'Acceso', excel: 'Un archivo en una sola compu', vynko: 'Desde el celular o la compu, en tiempo real' },
                ].map(row => (
                  <tr key={row.aspect} className="border-t border-gray-800/70">
                    <td className="p-4 text-sm font-semibold text-gray-200 whitespace-nowrap">{row.aspect}</td>
                    <td className="p-4 text-sm text-gray-500">
                      <span className="mr-2 text-red-400">✕</span>
                      {row.excel}
                    </td>
                    <td className="p-4 text-sm text-gray-200">
                      <span className="mr-2 text-cyan-400">✓</span>
                      {row.vynko}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-gray-900/30" id="features">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold">Todo lo que necesitás para manejar tu comercio</h2>
            <p className="mt-4 text-gray-400">Desde la venta en mostrador hasta la compra al proveedor, en un solo lugar.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: '🛒',
                title: 'Caja y punto de venta',
                desc: 'Buscá o escaneá el producto con la cámara del celular, armá el carrito, asigná el cliente y confirmá. El stock se descuenta al instante, sin descuadres ni stock negativo.',
              },
              {
                icon: '📦',
                title: 'Inventario y catálogo',
                desc: 'Costo, precio y margen calculado automáticamente, organizados por categoría y ubicación en el depósito. Alertas de stock bajo y crítico para reponer a tiempo, y ajuste de precios en masa.',
              },
              {
                icon: '🏬',
                title: 'Multi-sucursal',
                desc: 'Todas tus sucursales en una sola cuenta, con stock independiente por local. Transferí mercadería entre sucursales con seguimiento (pendiente → en tránsito → recibida) y mirá todo el negocio en una vista consolidada.',
              },
              {
                icon: '🛡️',
                title: 'Antipérdidas',
                desc: 'Registrá productos dañados, vencidos, perdidos o robados y mirá cuánta plata perdés, valuado en pesos. Un ranking te muestra qué productos se pierden más, y cada ajuste queda con quién, cuándo y por qué.',
              },
              {
                icon: '🚚',
                title: 'Proveedores y compras',
                desc: 'Armá pedidos de compra con fecha esperada y productos de tu catálogo. Al recibir la mercadería, incluso parcialmente, Vynko genera el remito de ingreso y suma el stock solo.',
              },
              {
                icon: '🧾',
                title: 'Documentos con tus datos fiscales',
                desc: 'Remitos, presupuestos, órdenes de venta y de compra, con numeración correlativa automática, estados de aprobación e impresión con tu CUIT y razón social.',
              },
              {
                icon: '👥',
                title: 'Equipo y permisos',
                desc: 'Sumá colaboradores por email con roles de dueño, encargado o miembro, y asignales las sucursales que corresponden. Cada uno ve solo lo suyo.',
              },
              {
                icon: '🔍',
                title: 'Auditoría',
                desc: 'Cada acción queda registrada: quién la hizo, cuándo y qué cambió. Exportá el historial a Excel cuando necesites revisarlo.',
              },
            ].map(f => (
              <div key={f.title} className="bg-gray-950 border border-gray-800 rounded-2xl p-6 hover:border-cyan-500/30 transition-colors">
                <div className="text-3xl mb-4">{f.icon}</div>
                <h3 className="text-base font-bold mb-3">{f.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: '📊', title: 'Dashboard en tiempo real', desc: 'Ventas del día, ingresos del mes, ticket promedio y alertas, por sucursal.' },
              { icon: '🙋', title: 'Clientes', desc: 'Historial de compras y total gastado de cada uno.' },
              { icon: '🏷️', title: 'Códigos QR por producto', desc: 'Imprimilos y pegalos en góndolas o bultos.' },
              { icon: '📥', title: 'Importá y exportá', desc: 'Desde Excel, Mercado Libre o Tiendanube, con carga inicial escaneando códigos de barras.' },
            ].map(f => (
              <div key={f.title} className="bg-gray-900/50 border border-gray-800/70 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{f.icon}</span>
                  <h3 className="text-sm font-semibold text-gray-200">{f.title}</h3>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">{f.desc}</p>
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
              { step: '01', title: 'Importá tu catálogo', desc: 'Subí el Excel o CSV que exportás de Mercado Libre o Tiendanube.' },
              { step: '02', title: 'Escaneá productos', desc: 'Usá tu teléfono para escanear códigos de barras y registrar movimientos.' },
              { step: '03', title: 'Mantené todo al día', desc: 'Cada venta, compra o transferencia actualiza el stock automáticamente.' },
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
            <p className="mt-6 text-sm text-gray-400">
              Empezá hoy. No pagues nada por los primeros <span className="text-white font-semibold">{getTrialDays()} días</span> de prueba.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto md:items-center">
            {Object.entries(PLANS).map(([id, plan]) => {
              const isPopular = id === getActivePromoPlan();
              const badge = getPlanBadge(id);
              const isTrialPlan = id === getTrialPlan();
              const price = getDisplayPrice(country, id as PlanId, configuredCurrencies);
              const trialDays = getTrialDays();

              let cta: ReactNode;
              if (plan.comingSoon) {
                cta = (
                  <span className="block text-center w-full py-3 rounded-lg font-semibold text-sm bg-gray-800 text-gray-400 border border-gray-700 cursor-not-allowed">
                    Próximamente
                  </span>
                );
              } else if (id === 'enterprise') {
                cta = (
                  <a
                    href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent('Cotización Plan Enterprise - Vynko')}`}
                    className="block text-center w-full py-3 rounded-lg font-semibold text-sm transition-colors bg-amber-500 hover:bg-amber-400 text-black"
                  >
                    Hablar con Ventas
                  </a>
                );
              } else {
                cta = (
                  <Link
                    href={isTrialPlan && trialExpired ? '/billing' : '/auth/signup'}
                    className={`block text-center w-full py-3 rounded-lg font-semibold text-sm transition-colors ${
                      isPopular
                        ? 'bg-cyan-500 hover:bg-cyan-400 text-black shadow-lg shadow-cyan-500/25'
                        : 'bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                    }`}
                  >
                    {isTrialPlan && trialExpired
                      ? 'Suscribirse'
                      : isTrialPlan
                        ? `Probar ${trialDays} Días Gratis`
                        : 'Elegir Starter'}
                  </Link>
                );
              }

              return (
                <div
                  key={id}
                  className={`relative rounded-2xl p-8 flex flex-col ${
                    plan.comingSoon
                      ? 'bg-gray-950 border border-dashed border-gray-700'
                      : isPopular
                        ? 'bg-gradient-to-b from-cyan-500/10 via-gray-900 to-gray-900 border-2 border-cyan-400 shadow-[0_0_60px_-12px_rgba(34,211,238,0.55)] md:scale-[1.06] md:z-10'
                        : 'bg-gray-950 border border-gray-800'
                  }`}
                >
                  {isPopular && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap px-5 py-1.5 rounded-full bg-gradient-to-r from-orange-500 to-amber-400 text-black text-xs font-extrabold uppercase tracking-wider shadow-lg shadow-orange-500/30">
                      🔥 Más popular — {trialDays} días gratis
                    </div>
                  )}
                  {badge && !isPopular && (
                    <div
                      className={`absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 text-xs font-bold rounded-full whitespace-nowrap ${
                        plan.comingSoon ? 'bg-gray-700 text-gray-300' : 'bg-cyan-500 text-black'
                      }`}
                    >
                      {badge}
                    </div>
                  )}
                  <h3 className="text-lg font-bold mb-2">{plan.name}</h3>
                  <div className="mb-6">
                    {plan.comingSoon ? (
                      <span className="text-2xl font-semibold text-gray-400">Próximamente</span>
                    ) : id === 'enterprise' ? (
                      <span className="text-4xl font-extrabold">A medida</span>
                    ) : isTrialPlan ? (
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base text-gray-500 line-through">{formatPriceByCountry({ amount: price, country, configuredCurrencies })}</span>
                          <span className="text-sm text-gray-400">/mes</span>
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                            Oferta
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
                          <span className="text-5xl font-extrabold text-cyan-400">$0</span>
                          <span className="text-xl font-bold text-white">GRATIS</span>
                          <span className="text-sm text-gray-400">por {trialDays} días</span>
                        </div>
                        <p className="mt-2 text-xs text-gray-400">
                          Ahorrás <span className="text-gray-100 font-semibold">{formatPriceByCountry({ amount: price, country, configuredCurrencies })}</span> durante tu prueba.
                        </p>
                      </div>
                    ) : (
                      <>
                        <span className="text-4xl font-extrabold">{formatPriceByCountry({ amount: price, country, configuredCurrencies })}</span>
                        <span className="text-sm text-gray-400 ml-1">/mes</span>
                      </>
                    )}
                  </div>
                  <ul className="space-y-3 mb-8 flex-1">
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
                  {isPopular && (
                    <div className="mb-4">
                      <PromoCountdown variant="banner" />
                    </div>
                  )}
                  {cta}
                </div>
              );
            })}
          </div>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 text-sm text-gray-400">
            <span>💳 Sin tarjeta de crédito requerida.</span>
            <span>⚡ Configuración lista en menos de 2 minutos.</span>
            <span>🔒 Cancelá cuando quieras sin compromisos.</span>
          </div>
          {country !== 'AR' && (
            <p className="mt-6 text-center text-xs text-gray-500 max-w-2xl mx-auto">
              Fuera de Argentina el cobro se procesa en la moneda que ves, a través de nuestra pasarela internacional (Paddle), que actúa como Merchant of Record y liquida los impuestos locales. Si tu país no tiene una moneda habilitada, el cobro se realiza en dólares (USD). El importe y la moneda definitivos se muestran antes de confirmar el pago.
            </p>
          )}
        </div>
      </section>

      {/* Soluciones por problema */}
      <section className="py-20 bg-gray-900/30" id="soluciones">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold">Soluciones para cada problema del día a día</h2>
            <p className="mt-4 text-gray-400 max-w-2xl mx-auto">
              Entrá por el problema que te trae. Cada página explica en detalle cómo lo resolvés y cuánto te cuesta no resolverlo.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {SEO_PAGES.map((page) => (
              <Link
                key={page.slug}
                href={seoPath(page.slug)}
                className="group bg-gray-950 border border-gray-800 rounded-2xl p-6 hover:border-cyan-500/30 transition-colors"
              >
                <h3 className="text-base font-bold mb-3 group-hover:text-cyan-400 transition-colors">
                  {page.label}
                </h3>
                <p className="text-sm text-gray-400 leading-relaxed">{page.summary}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm text-cyan-400">
                  Ver más
                  <span aria-hidden="true">&rarr;</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-6">
            Dejá de perder plata por descuadres, faltantes y mermas.
          </h2>
          <p className="text-gray-400 mb-8 max-w-lg mx-auto">
            Probá Vynko {getTrialDays() || 0} días gratis, sin tarjeta.
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
      <footer className="py-6 border-t border-gray-800/50 pb-24 md:pb-6">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-center gap-x-4 sm:gap-x-6 gap-y-2 pb-6 mb-6 border-b border-gray-800/50 text-sm text-gray-400">
            <span className="text-xs uppercase tracking-wider text-gray-500">Soluciones</span>
            {SEO_PAGES.map((page) => (
              <Link key={page.slug} href={seoPath(page.slug)} className="hover:text-gray-200 transition-colors text-center">
                {page.label}
              </Link>
            ))}
          </div>
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <Image src="/icons/vynkoLogout.png?v=3" alt="Vynko" width={1530} height={590} sizes="128px" className="h-10 sm:h-12 w-auto object-contain" />
            </div>
            <div className="flex flex-col items-center gap-4 text-sm text-gray-400 w-full md:w-auto">
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:gap-6 max-w-full">
                <Link href="/precios" className="hover:text-gray-200 transition-colors">Precios</Link>
                <Link href="/terminos" className="hover:text-gray-200 transition-colors">Términos</Link>
                <Link href="/privacidad" className="hover:text-gray-200 transition-colors">Privacidad</Link>
                <Link href="/reembolsos" className="hover:text-gray-200 transition-colors">Reembolsos</Link>
                <Link href="/cookies" className="hover:text-gray-200 transition-colors">Cookies</Link>
                <a href="mailto:soporte@vynko.dev" className="hover:text-gray-200 transition-colors">Contacto</a>
                <a
                  href={INSTAGRAM_URL}
                  target="_blank"
                  rel="me noopener noreferrer"
                  className="inline-flex items-center gap-1.5 hover:text-gray-200 transition-colors"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                  </svg>
                  Instagram
                </a>
              </div>
              <span className="text-xs text-gray-400 text-center px-2">
                © {new Date().getFullYear()} Vynko. Todos los derechos reservados.
                <span className="hidden sm:inline"> Logotipo e imágenes: propiedad de Vynko.</span>
              </span>
            </div>
          </div>
        </div>
      </footer>

      {/* Sticky Mobile CTA */}
      {isMounted && !user && !hasSession && (
        <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-gray-800/50 bg-gray-950/95 backdrop-blur-xl px-3 sm:px-4 py-2.5 sm:py-3" style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}>
          <Link
            href="/auth/signup"
            className="flex items-center justify-center gap-2 w-full max-w-full py-3 px-3 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-xl text-xs sm:text-sm transition-colors shadow-lg shadow-cyan-500/20 text-center leading-tight whitespace-normal break-words"
          >
            <span>Comenzar gratis — {getTrialDays() || 0} días de prueba</span>
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
          </Link>
        </div>
      )}
    </div>
  );
}
