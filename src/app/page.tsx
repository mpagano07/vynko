'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PLANS } from '@/lib/plans';
import { useAuth } from '@/lib/hooks/useAuth';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
} from 'recharts';

const chartData = [
  { name: 'Lun', ventas: 4200 },
  { name: 'Mar', ventas: 3800 },
  { name: 'Mié', ventas: 5100 },
  { name: 'Jue', ventas: 4700 },
  { name: 'Vie', ventas: 6300 },
  { name: 'Sáb', ventas: 5500 },
  { name: 'Dom', ventas: 4800 },
];

export default function LandingPage() {
  const router = useRouter();
  const { user, profile, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [waitlistDone, setWaitlistDone] = useState(false);

  const handleWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');
    if (!email.trim()) {
      setEmailError('Ingresá tu email para continuar');
      return;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      setEmailError('Email inválido');
      return;
    }
    setWaitlistLoading(true);
    await new Promise(r => setTimeout(r, 1000));
    setWaitlistDone(true);
    setWaitlistLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-gray-800/50 bg-gray-950/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-8">
              <Link href="/" className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-cyan-500 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">S</span>
                </div>
                <span className="text-lg font-bold text-white">StockPilot</span>
              </Link>
              <div className="hidden md:flex items-center gap-6">
                <Link href="#features" className="text-sm text-gray-400 hover:text-white transition-colors">Características</Link>
                <Link href="#how-it-works" className="text-sm text-gray-400 hover:text-white transition-colors">Cómo funciona</Link>
                <Link href="#pricing" className="text-sm text-gray-400 hover:text-white transition-colors">Precios</Link>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {user ? (
                <>
                  <Link
                    href="/dashboard"
                    className="text-sm font-medium text-gray-300 hover:text-white transition-colors px-4 py-2"
                  >
                    {profile?.full_name || user.email}
                  </Link>
                  <button
                    onClick={async () => { await logout(); router.push('/'); }}
                    className="text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded-lg border border-gray-700 transition-colors"
                  >
                    Cerrar sesión
                  </button>
                </>
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
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 via-transparent to-transparent" />
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-cyan-500/5 rounded-full blur-3xl" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-medium mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                Gestión de stock con IA
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight">
                Controlá tu{' '}
                <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">inventario</span>
                {' '}en tiempo real
              </h1>
              <p className="mt-6 text-lg text-gray-400 leading-relaxed max-w-lg">
                Olvidate de las planillas. Escaneá productos con tu teléfono, sincronizá al instante con tu negocio y recibí alertas inteligentes de reposición.
              </p>
              <form onSubmit={handleWaitlist} noValidate className="mt-8 flex gap-3 max-w-md">
                <div className="flex-1">
                  <input
                    type="email"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setEmailError(''); }}
                    placeholder="tu@email.com"
                    className="w-full px-4 py-3 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder:text-gray-600 focus:outline-none focus:border-cyan-500/50 text-sm"
                  />
                  {emailError && <p className="text-xs text-red-400 mt-1.5">{emailError}</p>}
                </div>
                <button
                  type="submit"
                  disabled={waitlistLoading || waitlistDone}
                  className="px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold rounded-lg transition-colors text-sm disabled:opacity-50 h-fit"
                >
                  {waitlistLoading ? 'Enviando...' : waitlistDone ? '¡Registrado!' : 'Comenzar gratis'}
                </button>
              </form>
              <p className="mt-3 text-xs text-gray-600">Sin compromiso. 30 días de prueba gratuita.</p>
            </div>

            {/* Dashboard Preview */}
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-tr from-cyan-500/10 via-transparent to-blue-500/10 rounded-2xl blur-2xl" />
              <div className="relative bg-gray-900/80 backdrop-blur-xl border border-gray-800 rounded-2xl p-6 shadow-2xl">
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="ml-2 text-xs text-gray-500">Dashboard Preview</span>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-6">
                  {[
                    { label: 'Ventas hoy', value: '$4.850', color: 'text-cyan-400' },
                    { label: 'Productos', value: '1.247', color: 'text-blue-400' },
                    { label: 'Alertas', value: '3', color: 'text-amber-400' },
                  ].map(k => (
                    <div key={k.label} className="bg-gray-950/60 rounded-lg p-3 border border-gray-800/50">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{k.label}</p>
                      <p className={`text-lg font-bold mt-1 ${k.color}`}>{k.value}</p>
                    </div>
                  ))}
                </div>
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} />
                      <YAxis hide />
                      <Bar dataKey="ventas" fill="#06b6d4" radius={[4, 4, 0, 0]} maxBarSize={24} />
                    </BarChart>
                  </ResponsiveContainer>
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

      {/* Comparison Section */}
      <section className="py-20" id="features">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold">El método antiguo vs <span className="text-cyan-400">StockPilot</span></h2>
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
                  <li key={item} className="flex items-start gap-3 text-sm text-gray-500">
                    <span className="text-red-400 mt-0.5">✕</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-2xl p-8 relative">
              <div className="absolute -top-3 left-8 px-3 py-1 bg-cyan-500 text-black text-xs font-bold rounded-full">Recomendado</div>
              <div className="text-4xl mb-4">🚀</div>
              <h3 className="text-xl font-bold text-cyan-400 mb-4">StockPilot</h3>
              <ul className="space-y-3">
                {[
                  'Escaneo móvil en tiempo real',
                  'Sincronización automática 2-way',
                  'Alertas inteligentes de bajo stock',
                  'Pronósticos con IA',
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
            {Object.entries(PLANS).map(([id, plan], idx) => {
              const isPopular = id === 'starter';
              return (
                <div
                  key={id}
                  className={`relative rounded-2xl p-8 ${
                    isPopular
                      ? 'bg-gray-900 border-2 border-cyan-500/40 shadow-xl shadow-cyan-500/5'
                      : 'bg-gray-950 border border-gray-800'
                  }`}
                >
                  {isPopular && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 bg-cyan-500 text-black text-xs font-bold rounded-full">
                      30 días de prueba gratis
                    </div>
                  )}
                  <h3 className="text-lg font-bold mb-2">{plan.name}</h3>
                  <div className="mb-6">
                    <span className="text-4xl font-extrabold">${plan.price.toLocaleString('es-AR')}</span>
                    <span className="text-sm text-gray-500 ml-1">/mes</span>
                  </div>
                  <ul className="space-y-3 mb-8">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-3 text-sm text-gray-400">
                        <span className="text-cyan-400 mt-0.5">✓</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/auth/signup"
                    className={`block text-center w-full py-3 rounded-lg font-semibold text-sm transition-colors ${
                      isPopular
                        ? 'bg-cyan-500 hover:bg-cyan-400 text-black'
                        : 'bg-gray-800 hover:bg-gray-700 text-white border border-gray-700'
                    }`}
                  >
                    {id === 'enterprise' ? 'Contactar' : 'Comenzar gratis'}
                  </Link>
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
            Unite a los cientos de negocios que ya gestionan su stock con StockPilot.
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
      <footer className="py-12 border-t border-gray-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-cyan-500 flex items-center justify-center">
                <span className="text-white font-bold text-xs">S</span>
              </div>
              <span className="text-sm font-bold text-white">StockPilot</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-500">
              <Link href="#" className="hover:text-gray-300 transition-colors">Privacidad</Link>
              <Link href="#" className="hover:text-gray-300 transition-colors">Términos</Link>
              <span>© 2026 StockPilot</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
