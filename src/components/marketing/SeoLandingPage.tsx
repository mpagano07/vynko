import Link from 'next/link';
import Image from 'next/image';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { PLANS, PLAN_ORDER, getActivePromoPlan, getPlanBadge, getTrialDays, getTrialPlan } from '@/lib/plans';
import { SALES_EMAIL } from '@/lib/tenant-config';
import { getCountryFromHeaders, formatPriceByCountry, getDisplayPrice, type PlanId } from '@/lib/pricing';
import { getPaddleConfiguredCurrencies } from '@/lib/paddle-price-ids';
import { INSTAGRAM_URL } from '@/lib/marketing/social';
import PromoCountdown from '@/components/landing/PromoCountdown';
import ROICalculator from '@/components/landing/ROICalculator';
import {
  SEO_PAGES,
  buildSeoJsonLd,
  seoPath,
  serializeJsonLd,
  type SeoLandingContent,
} from '@/lib/marketing/seo-landing';

type Props = {
  content: SeoLandingContent;
};

// Mismas barras que el preview de la home: se replican acá para no arrastrar
// `recharts` al bundle de una página que debe salir 100% del servidor.
const PREVIEW_BARS = [
  { name: 'Lun', ventas: 4200 },
  { name: 'Mar', ventas: 3800 },
  { name: 'Mié', ventas: 5100 },
  { name: 'Jue', ventas: 4700 },
  { name: 'Vie', ventas: 6300 },
  { name: 'Sáb', ventas: 5500 },
  { name: 'Dom', ventas: 4800 },
];

const TRUST_ITEMS = ['Stock en tiempo real', 'Caja en segundos', 'Multi-sucursal', 'Control de mermas'];

/**
 * Plantilla compartida por las landings SEO orientadas a intención de búsqueda.
 *
 * Es un Server Component: el HTML sale renderizado (con texto, precio y FAQ) sin
 * depender de JavaScript, que es lo que necesitan Google y los crawlers de IA.
 * El único JS extra es el JSON-LD, que se firma con el nonce de la CSP vigente
 * para que no lo bloquee `script-src`.
 *
 * El diseño replica el de la home (`src/app/page.tsx`) —navbar fija, hero de dos
 * columnas con preview del dashboard, encabezados centrados, tarjetas de precios
 * y footer horizontal— para que una visita que entra desde un buscador sienta que
 * sigue en el mismo sitio. Se mantiene en el servidor a propósito: la versión
 * client de la home resuelve el navbar con sesión, y acá ese costo en JS no se
 * justifica.
 */
export default async function SeoLandingPage({ content }: Props) {
  const h = await headers();
  const nonce = h.get('x-nonce') ?? undefined;
  const country = getCountryFromHeaders(h);
  // Monedas de Paddle configuradas: si la local no tiene `price_id`, el precio
  // se muestra y se cobra en USD (misma resolución que el checkout).
  const configuredCurrencies = new Set(getPaddleConfiguredCurrencies());
  const trialDays = getTrialDays();

  // La guia tiene un numero de pasos distinto en cada landing, asi que el grid
  // se acomoda en vez de dejar una fila de cards desbalanceada.
  const stepColumns =
    content.howTo.length >= 5
      ? 'md:grid-cols-2 lg:grid-cols-5'
      : content.howTo.length === 4
        ? 'md:grid-cols-2 lg:grid-cols-4'
        : 'md:grid-cols-3';

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildSeoJsonLd(content)) }} />

      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-gray-800/50 bg-gray-950/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-20">
            <div className="flex items-center gap-4 sm:gap-8 min-w-0">
              <Link href="/" className="flex items-center flex-shrink-0">
                <Image
                  src="/icons/vynkoLogout.png?v=3"
                  alt="Vynko"
                  width={1530}
                  height={590}
                  sizes="128px"
                  className="h-8 sm:h-10 w-auto object-contain"
                />
              </Link>
              <div className="hidden md:flex items-center gap-6">
                <Link href="#funcionalidades" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Características
                </Link>
                <Link href="#como-funciona" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Cómo funciona
                </Link>
                <Link href="#precios" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Precios
                </Link>
                <Link href="/#demo" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Ver demo
                </Link>
                <Link href="#roi" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Calculá cuánto podés ahorrar
                </Link>
              </div>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
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
            </div>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-36 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 via-transparent to-transparent" />
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-cyan-500/5 rounded-full blur-3xl" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <nav aria-label="Breadcrumb" className="mb-8 text-xs text-gray-500">
            <ol className="flex items-center gap-2">
              <li>
                <Link href="/" className="hover:text-gray-300 transition-colors">Inicio</Link>
              </li>
              <li aria-hidden="true">/</li>
              <li className="text-gray-400">{content.badge}</li>
            </ol>
          </nav>

          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-medium mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                {content.badge}
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight">
                {content.h1}
              </h1>
              <p className="mt-6 text-lg text-gray-400 leading-relaxed max-w-lg">{content.intro}</p>

              <div className="mt-8 flex flex-col sm:flex-row gap-2 sm:gap-3">
                <Link
                  href="/auth/signup"
                  className="inline-flex items-center justify-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-xl transition-colors text-sm sm:text-base"
                >
                  <span className="text-center leading-tight">Comenzar gratis{trialDays ? ` — ${trialDays} días de prueba` : ''}</span>
                </Link>
                <Link
                  href="/#demo"
                  className="inline-flex items-center justify-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 bg-gray-900 hover:bg-gray-800 text-gray-200 font-semibold rounded-xl border border-gray-800 transition-colors text-sm sm:text-base"
                >
                  Ver demo interactiva
                </Link>
              </div>
              <p className="mt-3 text-xs text-gray-400">
                {trialDays || 0} días de prueba · Sin tarjeta · Cancelás cuando quieras
              </p>
            </div>

            {/* Dashboard preview (estático, renderizado en el servidor) */}
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
                  ].map((k) => (
                    <div key={k.label} className="bg-gray-950/60 rounded-lg p-3 border border-gray-800/50">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider">{k.label}</p>
                      <p className={`text-lg font-bold mt-1 ${k.color}`}>{k.value}</p>
                    </div>
                  ))}
                </div>
                <div className="h-32">
                  <div className="w-full h-full flex items-end gap-1 px-2">
                    {PREVIEW_BARS.map((d) => (
                      <div
                        key={d.name}
                        className="flex-1 bg-cyan-900/40 rounded-t"
                        style={{ height: `${(d.ventas / 6300) * 100}%` }}
                      />
                    ))}
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-3 p-3 bg-amber-500/5 border border-amber-500/10 rounded-lg">
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <p className="text-xs text-amber-400/90"><span className="font-semibold">Alerta:</span> 3 productos con stock crítico</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-16 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-gray-300">
            {TRUST_ITEMS.map((item) => (
              <div key={item} className="flex items-center gap-2">
                <span className="text-cyan-400">✓</span>
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Problemas que resuelve */}
      <section className="py-20 bg-gray-900/30" id="problemas">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold">{content.problemsTitle}</h2>
            <p className="mt-4 text-gray-400 max-w-2xl mx-auto">{content.problemsIntro}</p>
          </div>
          <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
            {content.problems.map((item) => (
              <div key={item.problem} className="bg-gray-950 border border-gray-800 rounded-2xl p-6">
                <p className="flex items-start gap-3 text-sm text-gray-400">
                  <span className="text-red-400 mt-0.5 shrink-0">✕</span>
                  {item.problem}
                </p>
                <p className="mt-4 flex items-start gap-3 text-sm text-gray-200 border-t border-gray-800 pt-4">
                  <span className="text-cyan-400 mt-0.5 shrink-0">✓</span>
                  {item.solution}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Guia "como hacer X" */}
      <section className="py-20" id="como-funciona">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold">{content.howToTitle}</h2>
            <p className="mt-4 text-gray-400 max-w-2xl mx-auto">{content.howToIntro}</p>
          </div>
          <div className={`grid gap-8 max-w-5xl mx-auto ${stepColumns}`}>
            {content.howTo.map((item, index) => (
              <div key={item.title} className="text-center">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-6">
                  <span className="text-xl font-extrabold text-cyan-400">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </div>
                <h3 className="text-lg font-bold mb-3">{item.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Funcionalidades */}
      <section className="py-20" id="funcionalidades">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold">{content.featuresTitle}</h2>
            <p className="mt-4 text-gray-400 max-w-2xl mx-auto">{content.featuresIntro}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {content.features.map((feature) => (
              <div key={feature.title} className="bg-gray-950 border border-gray-800 rounded-2xl p-6 hover:border-cyan-500/30 transition-colors">
                <div className="text-3xl mb-4">{feature.icon}</div>
                <h3 className="text-base font-bold mb-3">{feature.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparativa */}
      <section className="py-20" id="comparativa">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold">{content.comparisonTitle}</h2>
            <p className="mt-4 text-gray-400 max-w-2xl mx-auto">{content.comparisonIntro}</p>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-gray-800">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="bg-gray-900/60">
                  <th className="px-6 py-4 font-semibold text-gray-400">&nbsp;</th>
                  <th className="px-6 py-4 font-semibold text-gray-300">📋 Excel + papel</th>
                  <th className="px-6 py-4 font-semibold text-cyan-400">⚡ Vynko</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {content.comparison.map((row) => (
                  <tr key={row.label} className="bg-gray-950">
                    <td className="px-6 py-4 font-medium text-gray-200">{row.label}</td>
                    <td className="px-6 py-4 text-gray-500">
                      <span className="flex items-start gap-2">
                        <span className="text-red-400/80 shrink-0">✕</span>
                        {row.excel}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-200">
                      <span className="flex items-start gap-2">
                        <span className="text-cyan-400 shrink-0">✓</span>
                        {row.vynko}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Calculadora de ahorro */}
      <section className="py-20 bg-gray-900/30" id="roi">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold">{content.roiTitle}</h2>
            <p className="mt-4 text-gray-400 max-w-2xl mx-auto">{content.roiIntro}</p>
          </div>
          <div className="max-w-4xl mx-auto">
            <ROICalculator />
          </div>
        </div>
      </section>

      {/* Para quién es */}
      <section className="py-20" id="para-quien">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold">{content.audienceTitle}</h2>
            <p className="mt-4 text-gray-400 max-w-2xl mx-auto">{content.audienceIntro}</p>
          </div>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
            {content.audience.map((item) => (
              <li key={item} className="flex items-start gap-3 bg-gray-950 border border-gray-800 rounded-xl p-4 text-sm text-gray-300">
                <span className="text-cyan-400 mt-0.5 shrink-0">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Precios */}
      <section className="py-20 bg-gray-900/30" id="precios">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold">{content.pricingTitle}</h2>
            <p className="mt-4 text-gray-400 max-w-2xl mx-auto">{content.pricingIntro}</p>
            {trialDays > 0 && (
              <p className="mt-3 text-sm font-semibold text-cyan-400">
                Empezá hoy y no pagues nada por los primeros {trialDays} días.
              </p>
            )}
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto md:items-center">
            {PLAN_ORDER.map((id) => {
              const plan = PLANS[id];
              const isPopular = id === getActivePromoPlan();
              const badge = getPlanBadge(id);
              const isTrialPlan = id === getTrialPlan();
              const price = getDisplayPrice(country, id as PlanId, configuredCurrencies);

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
                    href="/auth/signup"
                    className={`block text-center w-full py-3 rounded-lg font-semibold text-sm transition-colors ${
                      isPopular
                        ? 'bg-cyan-500 hover:bg-cyan-400 text-black shadow-lg shadow-cyan-500/25'
                        : 'bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                    }`}
                  >
                    {isTrialPlan ? `Probar ${trialDays} Días Gratis` : 'Comenzar gratis'}
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
                      <li key={i} className={`flex items-start gap-3 text-sm ${f.included ? 'text-gray-400' : 'text-gray-500'}`}>
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
          <div className="mt-10 text-center">
            {/* Link interno a la pagina de precios: consolida la senal de la
                consulta "cuanto cuesta" en una URL propia en vez de repartirla
                entre nueve landings con un ancla. */}
            <Link
              href="/precios"
              className="inline-flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              Ver la comparativa completa de planes
              <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>
          {country !== 'AR' && (
            <p className="mt-8 text-center text-xs text-gray-500 max-w-2xl mx-auto">
              Fuera de Argentina el cobro se procesa en la moneda que ves, a través de nuestra pasarela internacional (Paddle), que actúa como Merchant of Record y liquida los impuestos locales. Si tu país no tiene una moneda habilitada, el cobro se realiza en dólares (USD). El importe y la moneda definitivos se muestran antes de confirmar el pago.
            </p>
          )}
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20" id="faq">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold">{content.faqTitle}</h2>
          </div>
          <div className="max-w-3xl mx-auto space-y-3">
            {content.faq.map((item) => (
              <details key={item.q} className="group bg-gray-950 border border-gray-800 rounded-xl p-5 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex items-center justify-between gap-4 cursor-pointer text-base font-semibold text-gray-100">
                  {item.q}
                  <span className="text-cyan-400 text-xl leading-none transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm text-gray-400 leading-relaxed">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Enlaces internos a landings relacionadas */}
      {content.related.length > 0 && (
        <section className="py-20" id="relacionadas">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold">Otras soluciones de Vynko</h2>
              <p className="mt-4 text-gray-400 max-w-2xl mx-auto">
                Si tu problema es otro, estos son los módulos donde lo resolvés.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
              {content.related.map((item) => (
                <Link
                  key={item.slug}
                  href={seoPath(item.slug)}
                  className="group bg-gray-950 border border-gray-800 rounded-2xl p-6 hover:border-cyan-500/30 transition-colors"
                >
                  <h3 className="text-base font-bold mb-3 group-hover:text-cyan-400 transition-colors">
                    {item.title}
                  </h3>
                  <p className="text-sm text-gray-400 leading-relaxed">{item.desc}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm text-cyan-400">
                    Ver más
                    <span aria-hidden="true">&rarr;</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Confianza y garantía */}
      <section className="py-20 bg-gray-900/30" id="garantia">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold">{content.guaranteeTitle}</h2>
            <p className="mt-4 text-gray-400 max-w-2xl mx-auto">{content.guaranteeIntro}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            {[
              { icon: '💳', title: 'Sin tarjeta', desc: 'Empezás la prueba sin cargar datos de pago.' },
              { icon: '🔓', title: 'Cancelás cuando quieras', desc: 'Sin contratos largos ni permanencia mínima.' },
              { icon: '🇦🇷', title: 'Soporte en español', desc: 'Te respondemos en tu idioma, de persona a persona.' },
              { icon: '🔒', title: 'Datos protegidos', desc: 'Conexión cifrada y permisos por rol para tu equipo.' },
            ].map((item) => (
              <div key={item.title} className="bg-gray-950 border border-gray-800 rounded-2xl p-6 text-center">
                <div className="text-3xl mb-3">{item.icon}</div>
                <h3 className="text-base font-bold mb-2">{item.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-6">{content.finalCtaTitle}</h2>
          <p className="text-gray-400 mb-8 max-w-lg mx-auto">{content.finalCtaText}</p>
          <Link
            href="/auth/signup"
            className="inline-flex items-center gap-2 px-6 sm:px-8 py-3 sm:py-4 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-xl text-base sm:text-lg transition-colors"
          >
            Comenzar gratis
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
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
                <Link href="/privacidad" className="hover:text-gray-200 transition-colors">Privacidad</Link>
                <Link href="/terminos" className="hover:text-gray-200 transition-colors">Términos</Link>
                <Link href="/reembolsos" className="hover:text-gray-200 transition-colors">Reembolsos</Link>
                <Link href="/cookies" className="hover:text-gray-200 transition-colors">Cookies</Link>
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
      <div
        className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-gray-800/50 bg-gray-950/95 backdrop-blur-xl px-3 sm:px-4 py-2.5 sm:py-3"
        style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}
      >
        <Link
          href="/auth/signup"
          className="flex items-center justify-center gap-2 w-full max-w-full py-3 px-3 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-xl text-xs sm:text-sm transition-colors shadow-lg shadow-cyan-500/20 text-center leading-tight whitespace-normal break-words"
        >
          <span>Comenzar gratis{trialDays ? ` — ${trialDays} días de prueba` : ''}</span>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
