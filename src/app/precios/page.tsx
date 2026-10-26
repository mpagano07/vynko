import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { headers } from 'next/headers';
import {
  PLANS,
  PLAN_LIMITS,
  PLAN_ORDER,
  getPlanBadge,
  getTrialDays,
  getTrialPlan,
  type PlanId,
} from '@/lib/plans';
import {
  formatPriceByCountry,
  getCountryFromHeaders,
  getDisplayPrice,
} from '@/lib/pricing';
import { getPaddleConfiguredCurrencies } from '@/lib/paddle-price-ids';
import { SALES_EMAIL } from '@/lib/tenant-config';
import { APP_URL, serializeJsonLd } from '@/lib/marketing/structured-data';

const PATH = '/precios';

const TITLE = 'Precios de Vynko: planes y qué incluye cada uno';
const DESCRIPTION =
  'Precios de Vynko en pesos: Starter para comercios chicos, Business con productos y usuarios ilimitados y Enterprise a medida. 45 días de prueba gratis, sin tarjeta.';

export const metadata: Metadata = {
  title: 'Precios: planes de gestión de stock y ventas',
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  robots: { index: true, follow: true },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: PATH,
    siteName: 'Vynko',
    locale: 'es_AR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

/**
 * Filas de la tabla comparativa.
 *
 * Solo se listan capacidades que están declaradas en `PLANS`: si una función no
 * aparece en el plan, la tabla muestra "—". Inventar una fila para que la grilla
 * quede completa sería prometer algo que el checkout no entrega.
 */
const COMPARISON_ROWS: ReadonlyArray<{
  label: string;
  values: Record<PlanId, string>;
}> = [
  {
    label: 'Productos',
    values: {
      starter: `${PLAN_LIMITS.starter.products}`,
      business: 'Ilimitados',
      enterprise: 'Ilimitados',
    },
  },
  {
    label: 'Usuarios',
    values: {
      starter: `${PLAN_LIMITS.starter.users}`,
      business: 'Ilimitados',
      enterprise: 'Ilimitados',
    },
  },
  {
    label: 'Sucursales',
    values: { starter: '1', business: 'Hasta 5', enterprise: 'Hasta 99' },
  },
  {
    label: 'Stock en tiempo real',
    values: { starter: 'Sí', business: 'Sí', enterprise: 'Sí' },
  },
  {
    label: 'Ventas y caja',
    values: { starter: 'Sí', business: 'Sí', enterprise: 'Sí' },
  },
  {
    label: 'Compras y proveedores',
    values: { starter: 'Sí', business: 'Sí', enterprise: 'Sí' },
  },
  {
    label: 'Código de barras',
    values: { starter: 'Sí', business: 'Sí', enterprise: 'Sí' },
  },
  {
    label: 'Clientes',
    values: { starter: '—', business: 'Sí', enterprise: 'Sí' },
  },
  {
    label: 'Pronóstico de demanda',
    values: { starter: '—', business: 'Avanzado', enterprise: 'Avanzado' },
  },
  {
    label: 'Reportes',
    values: { starter: 'Básicos', business: 'Avanzados', enterprise: 'A medida' },
  },
  {
    label: 'Soporte',
    values: { starter: '—', business: 'Prioritario', enterprise: 'Dedicado + SLA' },
  },
];

const FAQ = [
  {
    q: '¿Cuánto cuesta Vynko?',
    a: 'El plan Starter cuesta lo que se muestra arriba por mes; el plan Business tiene un precio mayor porque incluye productos y usuarios ilimitados y hasta 5 sucursales. Enterprise se cotiza según la cantidad de sucursales y el acompañamiento que necesites.',
  },
  {
    q: '¿Hay prueba gratis?',
    a: `Sí. El plan Business incluye ${getTrialDays()} días de prueba sin costo y sin pedir tarjeta. Al terminar la prueba elegís si seguís con un plan pago o no.`,
  },
  {
    q: '¿Qué pasa si supero los 100 productos del plan Starter?',
    a: 'Pasás al plan Business, que no tiene límite de productos. El cambio se hace cuando quieras y tus datos, ventas e historial se mantienen.',
  },
  {
    q: '¿Puedo cambiar de plan más adelante?',
    a: 'Sí. Podés subir o bajar de plan desde Facturación. El cambio aplica al siguiente período de cobro y no perdés productos, movimientos ni configuraciones.',
  },
  {
    q: '¿Cómo se paga?',
    a: 'En Argentina el cobro se procesa por Mercado Pago, en pesos argentinos. Fuera de Argentina se cobra a través de Paddle, en la moneda local que veas en la página o en dólares si tu país no tiene una moneda habilitada.',
  },
  {
    q: '¿Hay permanencia mínima?',
    a: 'No. Podés cancelar cuando quieras desde la sección de facturación y seguís usando el servicio hasta el final del período que ya pagaste.',
  },
];

function buildPricingJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FAQPage',
        mainEntity: FAQ.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Inicio', item: APP_URL },
          { '@type': 'ListItem', position: 2, name: 'Precios', item: `${APP_URL}${PATH}` },
        ],
      },
    ],
  };
}

export default async function PreciosPage() {
  const h = await headers();
  const nonce = h.get('x-nonce') ?? undefined;
  const country = getCountryFromHeaders(h);
  const configuredCurrencies = new Set(getPaddleConfiguredCurrencies());
  const trialDays = getTrialDays();
  const trialPlan = getTrialPlan();
  const popularPlan = trialPlan ?? 'business';

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildPricingJsonLd()) }}
      />

      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-gray-800/50 bg-gray-950/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            <div className="flex items-center gap-8">
              <Link href="/" className="flex items-center" aria-label="Vynko, inicio">
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
                <Link href="/#soluciones" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Soluciones
                </Link>
                <Link href="/#demo" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Ver demo
                </Link>
                <Link href="/#roi" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Calculá cuánto podés ahorrar
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
      <section className="relative pt-36 pb-12 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 via-transparent to-transparent" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <nav aria-label="Breadcrumb" className="mb-8 text-xs text-gray-500">
            <ol className="flex items-center gap-2">
              <li>
                <Link href="/" className="hover:text-gray-300 transition-colors">
                  Inicio
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li className="text-gray-400">Precios</li>
            </ol>
          </nav>
          <div className="text-center max-w-3xl mx-auto">
            <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight tracking-tight">
              Precios claros, sin permanencia
            </h1>
            <p className="mt-6 text-lg text-gray-400 leading-relaxed">
              Elegí el plan según cuántos productos y sucursales manejás. Empezás con la prueba
              gratis, sin tarjeta, y cambiás de plan cuando quieras.
            </p>
          </div>
        </div>
      </section>

      {/* Planes */}
      <section className="py-12" id="planes">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-3 gap-8 items-start">
            {PLAN_ORDER.map((id) => {
              const plan = PLANS[id];
              const price = getDisplayPrice(country, id, configuredCurrencies);
              const isPopular = id === popularPlan;
              const isTrial = id === trialPlan;
              const badge = getPlanBadge(id);

              return (
                <div
                  key={id}
                  className={`relative rounded-2xl p-8 flex flex-col ${
                    isPopular
                      ? 'bg-gradient-to-b from-cyan-500/10 via-gray-900 to-gray-900 border-2 border-cyan-400 shadow-[0_0_60px_-12px_rgba(34,211,238,0.55)]'
                      : 'bg-gray-950 border border-gray-800'
                  }`}
                >
                  {isPopular && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap px-5 py-1.5 rounded-full bg-gradient-to-r from-orange-500 to-amber-400 text-black text-xs font-extrabold uppercase tracking-wider">
                      Más elegido
                    </div>
                  )}
                  {badge && !isPopular && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 text-xs font-bold rounded-full whitespace-nowrap bg-cyan-500 text-black">
                      {badge}
                    </div>
                  )}

                  <h2 className="text-lg font-bold mb-2">{plan.name}</h2>

                  <div className="mb-6">
                    {id === 'enterprise' ? (
                      <span className="text-4xl font-extrabold">A medida</span>
                    ) : isTrial ? (
                      <div>
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-5xl font-extrabold text-cyan-400">$0</span>
                          <span className="text-sm text-gray-400">por {trialDays} días</span>
                        </div>
                        <p className="mt-2 text-sm text-gray-400">
                          Después{' '}
                          <span className="text-gray-200 font-semibold">
                            {formatPriceByCountry({ amount: price, country, configuredCurrencies })}
                          </span>{' '}
                          /mes
                        </p>
                      </div>
                    ) : (
                      <>
                        <span className="text-4xl font-extrabold">
                          {formatPriceByCountry({ amount: price, country, configuredCurrencies })}
                        </span>
                        <span className="text-sm text-gray-400 ml-1">/mes</span>
                      </>
                    )}
                  </div>

                  <ul className="space-y-3 mb-8 flex-1">
                    {plan.features.map((feature) => (
                      <li key={feature.label} className="flex items-start gap-3 text-sm text-gray-400">
                        <span className="mt-0.5 text-cyan-400">✓</span>
                        <span>
                          {feature.label}
                          {feature.value && (
                            <span className="text-gray-200 font-medium"> {feature.value}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {id === 'enterprise' ? (
                    <a
                      href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent('Cotización Plan Enterprise - Vynko')}`}
                      className="block text-center w-full py-3 rounded-lg font-semibold text-sm bg-amber-500 hover:bg-amber-400 text-black transition-colors"
                    >
                      Hablar con ventas
                    </a>
                  ) : (
                    <Link
                      href="/auth/signup"
                      className={`block text-center w-full py-3 rounded-lg font-semibold text-sm transition-colors ${
                        isPopular
                          ? 'bg-cyan-500 hover:bg-cyan-400 text-black'
                          : 'bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                      }`}
                    >
                      {isTrial ? `Probar ${trialDays} días gratis` : 'Comenzar gratis'}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>

          {country !== 'AR' && (
            <p className="mt-8 text-center text-xs text-gray-500 max-w-2xl mx-auto">
              Fuera de Argentina el cobro se procesa en la moneda que ves, a través de nuestra
              pasarela internacional (Paddle), que actúa como Merchant of Record y liquida los
              impuestos locales. Si tu país no tiene una moneda habilitada, el cobro se realiza en
              dólares (USD). El importe y la moneda definitivos se muestran antes de confirmar el
              pago.
            </p>
          )}
        </div>
      </section>

      {/* Tabla comparativa */}
      <section className="py-20 bg-gray-900/30" id="comparativa">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold">Qué incluye cada plan</h2>
            <p className="mt-4 text-gray-400 max-w-2xl mx-auto">
              La diferencia entre planes es el volumen: productos, usuarios y sucursales. Las
              funciones de stock, ventas y compras están en todos.
            </p>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-950 text-gray-300">
                <tr>
                  <th scope="col" className="text-left font-semibold px-4 py-4">
                    Función
                  </th>
                  {PLAN_ORDER.map((id) => (
                    <th key={id} scope="col" className="text-center font-semibold px-4 py-4">
                      {PLANS[id].name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.label} className="bg-gray-950/60">
                    <th scope="row" className="text-left font-normal text-gray-400 px-4 py-3">
                      {row.label}
                    </th>
                    {PLAN_ORDER.map((id) => (
                      <td key={id} className="text-center text-gray-200 px-4 py-3">
                        {row.values[id]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-gray-500 text-center">
            Los precios se muestran en pesos argentinos con Mercado Pago. Fuera de Argentina se
            muestra y cobra en la moneda local disponible.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20" id="faq">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-12">
            Preguntas frecuentes sobre precios
          </h2>
          <div className="space-y-3">
            {FAQ.map((item) => (
              <details
                key={item.q}
                className="group bg-gray-950 border border-gray-800 rounded-xl p-5 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex items-center justify-between gap-4 cursor-pointer text-base font-semibold text-gray-100">
                  {item.q}
                  <span className="text-cyan-400 text-xl leading-none transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm text-gray-400 leading-relaxed">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-gray-900/30">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-6">
            Probá {trialDays} días gratis, sin tarjeta
          </h2>
          <p className="text-gray-400 mb-8 max-w-lg mx-auto">
            Cargá tu catálogo, hacé una venta y mirá el stock actualizarse solo. Si no te sirve, no
            pagás nada.
          </p>
          <Link
            href="/auth/signup"
            className="inline-flex items-center gap-2 px-8 py-4 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-xl text-lg transition-colors"
          >
            Comenzar gratis
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-gray-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-sm text-gray-400">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <Link href="/" className="hover:text-gray-200 transition-colors">
              Vynko
            </Link>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              <Link href="/#soluciones" className="hover:text-gray-200 transition-colors">
                Soluciones
              </Link>
              <Link href="/privacidad" className="hover:text-gray-200 transition-colors">
                Privacidad
              </Link>
              <Link href="/terminos" className="hover:text-gray-200 transition-colors">
                Términos
              </Link>
              <Link href="/reembolsos" className="hover:text-gray-200 transition-colors">
                Reembolsos
              </Link>
              <Link href="/cookies" className="hover:text-gray-200 transition-colors">
                Cookies
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
