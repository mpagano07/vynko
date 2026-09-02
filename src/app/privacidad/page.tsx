import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Política de Privacidad | Vynko',
  description: 'Política de privacidad y protección de datos de la plataforma Vynko.',
};

export default function PrivacidadPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <Image src="/icons/vynkoLogout.png?v=3" alt="Vynko" width={1530} height={590} sizes="96px" className="h-8 w-auto object-contain" />
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
          Política de Privacidad
        </h1>
        <p className="text-sm text-gray-400 mb-8">Última actualización: Agosto 2026</p>

        <div className="space-y-6 text-gray-300">
          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">1. Compromiso de Privacidad</h2>
            <p>
              En Vynko nos tomamos la privacidad y seguridad de tus datos muy en serio. Esta política describe qué información recopilamos, cómo la utilizamos y qué medidas tomamos para proteger tus datos de negocio y los de tus clientes.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">2. Información que Recopilamos</h2>
            <ul className="list-disc list-inside space-y-2 text-gray-300">
              <li><strong>Datos de Cuenta:</strong> Nombre, dirección de correo electrónico, contraseña encriptada e información de perfil.</li>
              <li><strong>Datos de Comercio:</strong> Nombre del negocio, dirección, teléfono, productos, stock, precios e historial de ventas.</li>
              <li><strong>Datos de Uso y Dispositivo:</strong> Información técnica sobre el navegador, sistema operativo e interacción con la plataforma para mejorar el servicio.</li>
            </ul>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">3. Uso de la Información</h2>
            <p className="mb-3">La información recopilada se utiliza exclusivamente para:</p>
            <ul className="list-disc list-inside space-y-1 text-gray-300">
              <li>Proveer, mantener y optimizar las funciones de la plataforma Vynko.</li>
              <li>Gestionar tu suscripción y procesar cobros a través de pasarelas de pago seguras (Mercado Pago).</li>
              <li>Ofrecer soporte técnico y responder a tus consultas.</li>
              <li>Garantizar la seguridad de tu cuenta y prevenir fraudes.</li>
            </ul>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">4. Protección y Aislamiento de Datos (Multi-Tenant)</h2>
            <p>
              Tus datos de stock, precios y ventas se encuentran aislados mediante políticas de seguridad a nivel de fila (Row Level Security en base de datos PostgreSQL) de grado empresarial. Ningún otro comercio puede acceder a tu información.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">5. Contacto</h2>
            <p>
              Si tienes preguntas acerca de nuestra política de privacidad o deseas ejercer tus derechos sobre tus datos personales, puedes contactarnos en: <span className="text-cyan-400 font-mono">privacidad@vynko.dev</span>
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
