import Link from 'next/link';
import Image from 'next/image';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import {
  PLANS,
  PLAN_ORDER,
  getActivePromoPlan,
  getEffectivePrice,
  getPlanBadge,
  getTrialDays,
  getTrialPlan,
} from '@/lib/plans';
import { SALES_EMAIL } from '@/lib/tenant-config';
import { formatARS } from '@/lib/utils/currency';
import PromoCountdown from '@/components/landing/PromoCountdown';
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
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const trialDays = getTrialDays();

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildSeoJsonLd(content)) }} />

      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-gray-800/50 bg-gray-950/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            <div className="flex items-center gap-8">
              <Link href="/" className="flex items-center">
                <Image
                  src="/icons/vynkoLogout.png?v=3"
                  alt="Vynko"
                  width={1530}
                  height={590}
                  sizes="128px"
                  className="h-10 w-auto object-contain"
                />
              </Link>
              <div className="hidden md:flex items-center gap-6">
                <Link href="#funcionalidades" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Funcionalidades
                </Link>
                <Link href="#para-quien" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Para quién
                </Link>
                <Link href="#precios" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Precios
                </Link>
                <Link href="#faq" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Preguntas
                </Link>
                <Link href="/#demo" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Ver demo
                </Link>
              </div>
            </div>
            <div className="flex items-center gap-3">
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

              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <Link
                  href="/auth/signup"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-xl transition-colors"
                >
                  Comenzar gratis{trialDays ? ` — ${trialDays} días de prueba` : ''}
                </Link>
                <Link
                  href="/#demo"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-gray-900 hover:bg-gray-800 text-gray-200 font-semibold rounded-xl border border-gray-800 transition-colors"
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

      {/* Para quién es */}
      <section className="py-20 bg-gray-900/30" id="para-quien">
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
      <section className="py-20" id="precios">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold">Planes simples y transparentes</h2>
            <p className="mt-4 text-gray-400">
              {trialDays
                ? `Empezá hoy y no pagues nada por los primeros ${trialDays} días.`
                : 'Elegí el plan que mejor se adapte a tu negocio.'}
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto md:items-center">
            {PLAN_ORDER.map((id) => {
              const plan = PLANS[id];
              const isPopular = id === getActivePromoPlan();
              const badge = getPlanBadge(id);
              const isTrialPlan = id === getTrialPlan();
              const price = getEffectivePrice(id);

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
                          <span className="text-base text-gray-500 line-through">{formatARS(price)}</span>
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
                          Ahorrás <span className="text-gray-100 font-semibold">{formatARS(price)}</span> durante tu prueba.
                        </p>
                      </div>
                    ) : (
                      <>
                        <span className="text-4xl font-extrabold">{formatARS(price)}</span>
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

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 text-sm text-gray-400">
            <span>💳 Sin tarjeta de crédito requerida.</span>
            <span>⚡ Configuración lista en menos de 2 minutos.</span>
            <span>🔒 Cancelá cuando quieras sin compromisos.</span>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 bg-gray-900/30" id="faq">
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

      {/* CTA final */}
      <section className="py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-6">{content.finalCtaTitle}</h2>
          <p className="text-gray-400 mb-8 max-w-lg mx-auto">{content.finalCtaText}</p>
          <Link
            href="/auth/signup"
            className="inline-flex items-center gap-2 px-8 py-4 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-xl text-lg transition-colors"
          >
            Comenzar gratis
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 border-t border-gray-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 pb-6 mb-6 border-b border-gray-800/50 text-sm text-gray-400">
            <span className="text-xs uppercase tracking-wider text-gray-500">Soluciones</span>
            {SEO_PAGES.map((page) => (
              <Link key={page.slug} href={seoPath(page.slug)} className="hover:text-gray-200 transition-colors">
                {page.label}
              </Link>
            ))}
          </div>
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
      <div
        className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-gray-800/50 bg-gray-950/95 backdrop-blur-xl px-4 py-3"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <Link
          href="/auth/signup"
          className="flex items-center justify-center gap-2 w-full py-3.5 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-xl text-sm transition-colors shadow-lg shadow-cyan-500/20"
        >
          Comenzar gratis{trialDays ? ` — ${trialDays} días de prueba` : ''}
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
