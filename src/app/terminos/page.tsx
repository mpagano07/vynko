import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Términos y Condiciones | Vynko',
  description: 'Términos y condiciones de uso de la plataforma Vynko.',
};

export default function TerminosPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <Image src="/icons/vynkoLogout.png?v=2" alt="Vynko" width={120} height={38} className="h-8 w-auto object-contain" />
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
          Términos y Condiciones de Uso
        </h1>
        <p className="text-sm text-gray-400 mb-8">Última actualización: Agosto 2026</p>

        <div className="space-y-6 text-gray-300">
          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">1. Aceptación de los Términos</h2>
            <p>
              Al registrarte o utilizar la plataforma Vynko, aceptas expresamente estos Términos y Condiciones de Uso. Si no estás de acuerdo con alguna de las disposiciones aquí establecidas, no debes utilizar el servicio.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">2. Descripción del Servicio</h2>
            <p>
              Vynko es una plataforma SaaS B2B destinada a la gestión comercial, inventario, ventas y análisis de comercios. Nos reservamos el derecho de actualizar, modificar o discontinuar funciones con previo aviso a los usuarios activos.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">3. Cuentas y Responsabilidad de Seguridad</h2>
            <p>
              Eres responsable de mantener la confidencialidad de tus credenciales de acceso y de todas las actividades asociadas a tu cuenta. Notifica de inmediato cualquier uso no autorizado de tu cuenta a nuestro equipo de soporte.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">4. Suscripciones y Pagos</h2>
            <ul className="list-disc list-inside space-y-2 text-gray-300">
              <li>Los servicios se facturan de forma recurrente mensual a través de Mercado Pago según el plan seleccionado.</li>
              <li>Puedes cancelar tu suscripción en cualquier momento desde el módulo de Facturación. La cancelación evitará futuros cobros recurrentes.</li>
              <li>Nos reservamos el derecho de modificar los precios con previo aviso a los suscriptores.</li>
            </ul>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">5. Uso Aceptable</h2>
            <p>
              Queda estrictamente prohibido utilizar Vynko para actividades ilícitas, vulneración de derechos de terceros, ataques de denegación de servicio o manipulación no autorizada del código o servidores de la plataforma.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">6. Soporte y Contacto</h2>
            <p>
              Ante dudas sobre los términos de servicio, puedes dirigirte a nuestro equipo de soporte en: <span className="text-cyan-400 font-mono">soporte@vynko.app</span>
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-900 py-6 text-center text-xs text-gray-500">
        © {new Date().getFullYear()} Vynko. Todos los derechos reservados.
      </footer>
    </div>
  );
}
