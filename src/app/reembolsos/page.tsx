import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Política de Reembolsos y Cancelación',
  description:
    'Política de reembolsos, cancelación de suscripciones y derecho de arrepentimiento de Vynko según Ley N° 24.240.',
};

export default function ReembolsosPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <Image
              src="/icons/vynkoLogout.png?v=3"
              alt="Vynko"
              width={1530}
              height={590}
              sizes="96px"
              className="h-8 w-auto object-contain"
            />
          </Link>
          <Link
            href="/"
            className="text-sm font-medium text-gray-400 hover:text-white transition-colors"
          >
            ← Volver al inicio
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-12 leading-relaxed">
        <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">
          Política de Reembolsos y Cancelación
        </h1>
        <p className="text-sm text-gray-400 mb-8">Última actualización: Octubre 2026</p>

        <div className="space-y-6 text-gray-300">
          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">1. ÁÁmbito</h2>
            <p className="leading-relaxed">
              Esta política regula los reembolsos y la cancelación de las suscripciones de Vynko.
              Los cobros se procesan con <strong>Mercado Pago</strong> para usuarios de Argentina y
              con <strong>Paddle</strong> (Merchant of Record) para el resto de los países (ver{' '}
              <Link href="/terminos" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2">
                Términos y Condiciones
              </Link>
              , sección 4).
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">2. Derecho de Arrepentimiento (10 días)</h2>
            <p className="leading-relaxed mb-3">
              Conforme a los artículos 34 y 10 ter de la Ley N° 24.240 de Defensa del Consumidor,
              podés <strong>revocar la contratación dentro de los diez (10) días corridos</strong>{' '}
              desde la contratación online, sin costo ni trámite adicional, por el mismo medio
              electrónico en que contrataste. Si el pago se procesó dentro de esos diez días, se
              reintegra el importe abonado.
            </p>
            <p className="text-sm text-gray-300">
              Para ejercerlo: usá el <strong>botón de arrepentimiento</strong> del panel de
              Facturación o escribinos a{' '}
              <span className="text-cyan-400 font-mono">soporte@vynko.dev</span> indicando tu
              número de cuenta.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">3. Cancelación de la Suscripción</h2>
            <ul className="list-disc list-inside space-y-2 text-gray-300">
              <li>Podés cancelar en cualquier momento desde el módulo de <strong>Facturación</strong>, sin penalidad ni permanencia mínima.</li>
              <li>La cancelación frena los cobros futuros de inmediato y mantenés el acceso hasta agotar el período mensual ya abonado.</li>
              <li>También podés cancelar desde el portal del cliente de la pasarela de pago que te cobró (Mercado Pago o Paddle), según corresponda.</li>
            </ul>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">4. Cómo Solicitar un Reembolso</h2>
            <ol className="list-decimal list-inside space-y-2 text-gray-300">
              <li>
                Escribinos a <span className="text-cyan-400 font-mono">soporte@vynko.dev</span> con
                tu correo de cuenta o número de transacción y el motivo del pedido.
              </li>
              <li>
                Evaluamos el caso y, cuando corresponda, procesamos el reembolso por el{' '}
                <strong>mismo medio de pago</strong> con el que se realizó el cobro.
              </li>
              <li>
                Para cobros internacionales, Paddle actúa como Merchant of Record: una vez
                aprobado el reembolso, Paddle lo ejecuta y aplica sus propios{' '}
                <a
                  href="https://www.paddle.com/legal/buyer-terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
                >
                  Términos para compradores
                </a>
                . El plazo de acreditación depende de la entidad emisora de tu tarjeta.
              </li>
            </ol>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">5. Contacto</h2>
            <p className="leading-relaxed">
              Consultas sobre reembolsos o cancelaciones:{' '}
              <span className="text-cyan-400 font-mono">soporte@vynko.dev</span>. Revisá también
              nuestros{' '}
              <Link href="/terminos" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2">
                Términos y Condiciones
              </Link>{' '}
              y nuestra{' '}
              <Link href="/privacidad" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2">
                Política de Privacidad
              </Link>
              .
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-900 py-6 text-center space-y-2">
        <div className="flex justify-center gap-4 text-xs text-gray-400">
          <Link href="/terminos" className="hover:text-gray-200 underline underline-offset-2">Términos y Condiciones</Link>
          <Link href="/privacidad" className="hover:text-gray-200 underline underline-offset-2">Política de Privacidad</Link>
          <Link href="/cookies" className="hover:text-gray-200 underline underline-offset-2">Política de Cookies</Link>
          <Link href="/" className="hover:text-gray-200 underline underline-offset-2">Inicio</Link>
        </div>
        <p className="text-xs text-gray-400">
          © {new Date().getFullYear()} Vynko. Todos los derechos reservados. Imágenes, logotipos y marcas: propiedad de Vynko (Ley N° 11.723 y leyes de marcas aplicables).
        </p>
      </footer>
    </div>
  );
}
