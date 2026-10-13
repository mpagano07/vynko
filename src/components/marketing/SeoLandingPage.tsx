import Link from 'next/link';
import Image from 'next/image';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { PLANS, PLAN_ORDER, getEffectivePrice, getPlanBadge, getTrialDays } from '@/lib/plans';
import { SALES_EMAIL } from '@/lib/tenant-config';
import { formatARS } from '@/lib/utils/currency';
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

/**
 * Plantilla compartida por las landings SEO orientadas a intención de búsqueda.
 *
 * Es un Server Component: el HTML sale renderizado (con texto, precio y FAQ) sin
 * depender de JavaScript, que es lo que necesitan Google y los crawlers de IA.
 * El único JS extra es el JSON-LD, que se firma con el nonce de la CSP vigente
 * para que no lo bloquee `script-src`.
 */
export default async function SeoLandingPage({ content }: Props) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const trialDays = getTrialDays();
  const priceFrom = getEffectivePrice('starter');
  const jsonLd = serializeJsonLd(buildSeoJsonLd(content, priceFrom));
  const currentPath = seoPath(content.slug);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: jsonLd }} />

      {/* Navbar */}
      <nav className="sticky top-0 left-0 right-0 z-50 border-b border-gray-800/50 bg-gray-950/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            <Link href="/" className="flex items-center shrink-0">
              <Image
                src="/icons/vynkoLogout.png?v=3"
                alt="Vynko"
                width={1530}
                height={590}
                sizes="128px"
                className="h-10 w-auto object-contain"
              />
            </Link>
            <div className="hidden lg:flex items-center gap-6">
              {SEO_PAGES.map((page) => {
                const href = seoPath(page.slug);
                const isCurrent = href === currentPath;
                return (
                  <Link
                    key={page.slug}
                    href={href}
                    aria-current={isCurrent ? 'page' : undefined}
                    className={`text-sm transition-colors ${
                      isCurrent ? 'text-cyan-400 font-semibold' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {page.label}
                  </Link>
                );
              })}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <Link href="/login" className="hidden sm:inline text-sm font-medium text-gray-300 hover:text-white transition-colors px-3 py-2">
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

      {/* Breadcrumb + Hero */}
      <section className="relative pt-16 pb-16 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 via-transparent to-transparent" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[700px] bg-cyan-500/5 rounded-full blur-3xl" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <nav aria-label="Breadcrumb" className="mb-8 text-xs text-gray-500">
            <ol className="flex items-center gap-2">
              <li>
                <Link href="/" className="hover:text-gray-300 transition-colors">Inicio</Link>
              </li>
              <li aria-hidden="true">/</li>
              <li className="text-gray-400">{content.badge}</li>
            </ol>
          </nav>

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            {content.badge}
          </div>

          <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight tracking-tight">{content.h1}</h1>
          <p className="mt-6 text-lg text-gray-400 leading-relaxed max-w-2xl">{content.intro}</p>

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
          <p className="mt-3 text-xs text-gray-500">Sin tarjeta de crédito. Cancelá cuando quieras.</p>
        </div>
      </section>

      {/* Problemas que resuelve */}
      <section className="py-16 bg-gray-900/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold">{content.problemsTitle}</h2>
            <p className="mt-4 text-gray-400">{content.problemsIntro}</p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
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
      <section className="py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold">{content.featuresTitle}</h2>
            <p className="mt-4 text-gray-400">{content.featuresIntro}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {content.features.map((feature) => (
              <div key={feature.title} className="bg-gray-950 border border-gray-800 rounded-2xl p-6 hover:border-cyan-500/30 transition-colors">
                <div className="text-3xl mb-3">{feature.icon}</div>
                <h3 className="text-base font-bold mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Para quién es */}
      <section className="py-16 bg-gray-900/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl sm:text-4xl font-bold">{content.audienceTitle}</h2>
          <p className="mt-4 text-gray-400">{content.audienceIntro}</p>
          <ul className="mt-8 grid sm:grid-cols-2 gap-3">
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
      <section className="py-16" id="precios">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold">Planes simples y transparentes</h2>
            <p className="mt-4 text-gray-400">
              {trialDays ? `Empezá hoy y no pagues nada por los primeros ${trialDays} días.` : 'Elegí el plan que mejor se adapte a tu negocio.'}
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 md:items-center max-w-5xl mx-auto">
            {PLAN_ORDER.map((id) => {
              const plan = PLANS[id];
              const badge = getPlanBadge(id);
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
                    className="block text-center w-full py-3 rounded-lg font-semibold text-sm transition-colors bg-cyan-500 hover:bg-cyan-400 text-black"
                  >
                    Comenzar gratis
                  </Link>
                );
              }

              return (
                <div key={id} className="relative rounded-2xl p-8 flex flex-col bg-gray-950 border border-gray-800">
                  {badge && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 text-xs font-bold rounded-full whitespace-nowrap bg-cyan-500 text-black">
                      {badge}
                    </div>
                  )}
                  <h3 className="text-lg font-bold mb-2">{plan.name}</h3>
                  <div className="mb-6">
                    {id === 'enterprise' ? (
                      <span className="text-4xl font-extrabold">A medida</span>
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
                        <span className={`mt-0.5 ${f.included ? 'text-cyan-400' : 'text-gray-500'}`}>{f.included ? '✓' : '✗'}</span>
                        <span>
                          {f.label}
                          {f.value && <span className="text-gray-200 font-medium"> {f.value}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {cta}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 bg-gray-900/30">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl sm:text-4xl font-bold mb-10">{content.faqTitle}</h2>
          <div className="space-y-3">
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
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">{content.finalCtaTitle}</h2>
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
      <footer className="py-10 border-t border-gray-800/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
            <Link href="/" className="flex items-center">
              <Image
                src="/icons/vynkoLogout.png?v=3"
                alt="Vynko"
                width={1530}
                height={590}
                sizes="96px"
                className="h-10 w-auto object-contain"
              />
            </Link>
            <div className="flex flex-col sm:flex-row gap-6 sm:gap-10">
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-3">Soluciones</p>
                <ul className="space-y-2 text-sm text-gray-400">
                  {SEO_PAGES.map((page) => (
                    <li key={page.slug}>
                      <Link href={seoPath(page.slug)} className="hover:text-gray-200 transition-colors">
                        {page.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-3">Legal</p>
                <ul className="space-y-2 text-sm text-gray-400">
                  <li><Link href="/privacidad" className="hover:text-gray-200 transition-colors">Privacidad</Link></li>
                  <li><Link href="/terminos" className="hover:text-gray-200 transition-colors">Términos</Link></li>
                  <li><Link href="/cookies" className="hover:text-gray-200 transition-colors">Cookies</Link></li>
                </ul>
              </div>
            </div>
          </div>
          <p className="mt-8 text-xs text-gray-500">
            © {new Date().getFullYear()} Vynko. Todos los derechos reservados.
          </p>
        </div>
      </footer>
    </div>
  );
}
