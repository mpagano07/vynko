import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Política de Cookies | Vynko',
  description: 'Conocé qué cookies y tecnologías de almacenamiento utiliza Vynko y cómo protegen tu sesión y preferencias.',
};

export default function CookiesPage() {
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
          Política de Cookies y Almacenamiento Local
        </h1>
        <p className="text-sm text-gray-400 mb-8">Última actualización: Septiembre 2026</p>

        <div className="space-y-6 text-gray-300">
          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">1. ¿Qué son las cookies y el almacenamiento local?</h2>
            <p>
              Una cookie es un pequeño archivo de texto que un sitio web guarda en tu navegador al acceder. Las tecnologías de almacenamiento local (<code className="text-cyan-400 font-mono text-sm">localStorage</code> y <code className="text-cyan-400 font-mono text-sm">sessionStorage</code>) permiten guardar datos de sesión y preferencias directamente en tu dispositivo sin enviarlos automáticamente en cada petición de red.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">2. Nuestro principio: Sin cookies publicitarias ni rastreo cruzado</h2>
            <p>
              En Vynko <strong>no utilizamos cookies de publicidad comportamental, ni vendemos datos de navegación, ni usamos rastreadores invasivos de terceros</strong> para perfilar tu actividad en otros sitios web. Solo utilizamos mecanismos estrictamente necesarios para que la plataforma funcione de forma segura y personalizada.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">3. Tu consentimiento</h2>
            <p className="mb-3">
              Al ingresar por primera vez, el aviso de cookies te permite <strong>aceptar</strong> o <strong>rechazar</strong> el uso de estas tecnologías. Como todas las que utilizamos son esenciales o funcionales y no existen opciones publicitarias ni de rastreo, tu decisión solo determina si preferís que guardemos tus preferencias en tu dispositivo.
            </p>
            <p className="text-sm text-gray-400">
              En ambos casos el servicio sigue funcionando. Si rechazás el uso de cookies, el aviso podrá volver a mostrarse en tu próxima visita.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">4. Tecnologías que utilizamos</h2>
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-400">
                    <th className="py-2.5 pr-4 font-semibold text-white">Nombre / Clave</th>
                    <th className="py-2.5 pr-4 font-semibold text-white">Tipo</th>
                    <th className="py-2.5 pr-4 font-semibold text-white">Finalidad</th>
                    <th className="py-2.5 font-semibold text-white">Duración</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60 text-gray-300">
                  <tr>
                    <td className="py-3 pr-4 font-mono text-xs text-cyan-400">sb-*-auth-token (cookies de sesión Supabase)</td>
                    <td className="py-3 pr-4">Cookie estricta, inaccesible para JavaScript (HttpOnly)</td>
                    <td className="py-3 pr-4">Mantener tu sesión iniciada de forma segura mediante tokens criptográficos.</td>
                    <td className="py-3">Sesión / Renovable</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-mono text-xs text-cyan-400">vynko-theme</td>
                    <td className="py-3 pr-4">LocalStorage</td>
                    <td className="py-3 pr-4">Recordar tu preferencia visual (modo claro u oscuro).</td>
                    <td className="py-3">Persistente</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-mono text-xs text-cyan-400">vynko_active_tenant_id</td>
                    <td className="py-3 pr-4">LocalStorage</td>
                    <td className="py-3 pr-4">Recordar la sucursal/empresa seleccionada en cuentas con multi-sucursal.</td>
                    <td className="py-3">Persistente</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-mono text-xs text-cyan-400">vynko_cookie_consent</td>
                    <td className="py-3 pr-4">LocalStorage</td>
                    <td className="py-3 pr-4">Guardar tu decisión sobre el aviso de cookies (aceptar/rechazar) para no volver a mostrarlo en cada visita.</td>
                    <td className="py-3">Persistente</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-mono text-xs text-cyan-400">vynko_remember</td>
                    <td className="py-3 pr-4">LocalStorage</td>
                    <td className="py-3 pr-4">Completar tu email de acceso si marcaste voluntariamente la casilla &quot;Recordar mi email&quot;.</td>
                    <td className="py-3">Hasta desmarcar</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-mono text-xs text-cyan-400">vynko_last_activity</td>
                    <td className="py-3 pr-4">LocalStorage</td>
                    <td className="py-3 pr-4">Registrar tu última actividad para gestionar la vigencia de la sesión.</td>
                    <td className="py-3">Sesión</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-mono text-xs text-cyan-400">vynko-install-banner-dismissed</td>
                    <td className="py-3 pr-4">LocalStorage</td>
                    <td className="py-3 pr-4">Recordar que cerraste el aviso de instalación de la aplicación.</td>
                    <td className="py-3">Persistente</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-mono text-xs text-cyan-400">vynko:sales-view / vynko:paper-size</td>
                    <td className="py-3 pr-4">LocalStorage</td>
                    <td className="py-3 pr-4">Recordar tu vista preferida del módulo de ventas y el tamaño de papel del ticket.</td>
                    <td className="py-3">Persistente</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-mono text-xs text-cyan-400">vynko_onboarding_dismissed_*</td>
                    <td className="py-3 pr-4">LocalStorage</td>
                    <td className="py-3 pr-4">Recordar que cerraste la guía de inicio para cada usuario.</td>
                    <td className="py-3">Persistente</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-mono text-xs text-cyan-400">create_po_intent</td>
                    <td className="py-3 pr-4">SessionStorage</td>
                    <td className="py-3 pr-4">Conservar temporalmente el borrador de una orden de compra al navegar entre pantallas.</td>
                    <td className="py-3">Solo pestaña</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-mono text-xs text-cyan-400">supabase.auth.token (heredado)</td>
                    <td className="py-3 pr-4">LocalStorage</td>
                    <td className="py-3 pr-4">Token de sesión de versiones anteriores del sistema. Se elimina al cerrar sesión o tras ~30 minutos de inactividad.</td>
                    <td className="py-3">Persistente</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">5. Cómo gestionar, deshabilitar o retirar tu consentimiento</h2>
            <p className="mb-3">
              Puedes retirar o modificar tu consentimiento en cualquier momento borrando la clave <code className="text-cyan-400 font-mono text-sm">vynko_cookie_consent</code> de tu navegador (categoría &quot;Almacenamiento local&quot; o &quot;Local storage&quot; de las herramientas de desarrollo), o limpiando los datos del sitio. El aviso se mostrará nuevamente en tu próxima visita para que decidas de nuevo.
            </p>
            <p className="mb-3">
              También puedes configurar tu navegador para bloquear, rechazar o eliminar cookies y datos locales en cualquier momento. Ten en cuenta que si bloqueas las cookies esenciales de autenticación, no podrás acceder a tu panel de Vynko ni operar tu inventario.
            </p>
            <p className="text-sm text-gray-400">
              Instrucciones de configuración en los principales navegadores: Google Chrome, Mozilla Firefox, Apple Safari y Microsoft Edge en sus respectivos menús de configuración o privacidad.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">6. Marco legal y contacto</h2>
            <p className="mb-2">
              Esta política se encuentra alineada con la Ley Argentina N° 25.326 de Protección de Datos Personales, la Ley N° 26.032 (privacidad de las comunicaciones en internet) y las directrices de la Agencia de Acceso a la Información Pública (AAIP), y complementa nuestra{' '}
              <Link href="/privacidad" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2">Política de Privacidad</Link>{' '}
              y nuestros{' '}
              <Link href="/terminos" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2">Términos y Condiciones</Link>.
            </p>
            <p>
              Si tienes preguntas sobre nuestra política de cookies, puedes escribirnos a:{' '}
              <span className="text-cyan-400 font-mono">privacidad@vynko.dev</span>
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-900 py-6 text-center space-y-2">
        <div className="flex justify-center gap-4 text-xs text-gray-400">
          <Link href="/privacidad" className="hover:text-gray-200 underline underline-offset-2">Política de Privacidad</Link>
          <Link href="/terminos" className="hover:text-gray-200 underline underline-offset-2">Términos y Condiciones</Link>
          <Link href="/" className="hover:text-gray-200 underline underline-offset-2">Inicio</Link>
        </div>
        <p className="text-xs text-gray-400">
          © {new Date().getFullYear()} Vynko. Todos los derechos reservados.
        </p>
      </footer>
    </div>
  );
}
