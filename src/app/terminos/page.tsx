import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Términos y Condiciones | Vynko',
  description: 'Términos y condiciones de uso de la plataforma Vynko, política de contratación, cancelación y derecho de arrepentimiento según Ley 24.240.',
};

export default function TerminosPage() {
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
          Términos y Condiciones de Uso
        </h1>
        <p className="text-sm text-gray-400 mb-8">Última actualización: Septiembre 2026</p>

        <div className="space-y-6 text-gray-300">
          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">1. Aceptación y Ámbito de Aplicación</h2>
            <p className="leading-relaxed">
              El presente contrato regula los términos y condiciones de uso aplicables al software como servicio provisto por Vynko (en adelante, el &quot;Servicio&quot;). Al registrarte, crear una cuenta o acceder al sistema, manifestás haber leído, comprendido y aceptado en su totalidad estos Términos y Condiciones, junto con nuestra{' '}
              <Link href="/privacidad" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2">
                Política de Privacidad
              </Link>{' '}
              y nuestra{' '}
              <Link href="/cookies" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2">
                Política de Cookies
              </Link>.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">2. Descripción del Servicio</h2>
            <p className="leading-relaxed">
              Vynko es una solución integral B2B orientada al control de inventario, punto de venta (POS), transferencias entre sucursales, facturación y reportes analíticos para comercios y empresas. Vynko se reserva el derecho de implementar mejoras, actualizaciones o mantenimientos programados con el fin de optimizar el rendimiento y la seguridad del sistema.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">3. Registro, Cuentas y Seguridad</h2>
            <ul className="list-disc list-inside space-y-2 text-gray-300">
              <li>El usuario se compromete a proporcionar información veraz, exacta y actualizada durante el proceso de registración.</li>
              <li>Cada cuenta es personal e intransferible. El usuario es el único responsable de preservar el secreto y confidencialidad de su contraseña y claves de acceso.</li>
              <li>Cualquier actividad efectuada bajo una cuenta autenticada se presumirá realizada por el titular registrado, salvo notificación fehaciente previa de sospecha de vulneración.</li>
            </ul>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">4. Suscripciones, Pagos y Facturación</h2>
            <ul className="list-disc list-inside space-y-2 text-gray-300">
              <li>El acceso continuo a los planes de pago se efectúa mediante suscripciones mensuales recurrentes procesadas a través de la pasarela de pagos Mercado Pago.</li>
              <li>Los precios y cargos aplicables están expresados en pesos argentinos (u otra moneda indicada en la pantalla de contratación) e incluyen los impuestos correspondientes que por ley apliquen.</li>
              <li>Cualquier actualización de tarifas será comunicada con un preaviso mínimo de treinta (30) días corridos a la casilla de correo del suscriptor antes de impactar en su próximo ciclo de facturación.</li>
            </ul>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">5. Derecho de Arrepentimiento (Ley N° 24.240)</h2>
            <p className="leading-relaxed mb-3">
              De conformidad con los <strong>artículos 34 y 10 ter de la Ley N° 24.240 de Defensa del Consumidor</strong> y sus normas complementarias aplicables al comercio electrónico, el suscriptor consumidor tiene el derecho irrenunciable a <strong>revocar la contratación del servicio dentro del plazo de diez (10) días corridos</strong> contados a partir de la fecha de contratación online, sin responsabilidad ni costo alguno, pudiendo rescindir el contrato por el mismo medio (electrónico) en que fue celebrado.
            </p>
            <p className="text-sm text-gray-300">
              Para ejercer el derecho de revocación sin trámites adicionales, podrás utilizar el <strong>Botón de arrepentimiento</strong> disponible en el panel de Facturación (por el mismo medio electrónico en que realizaste la contratación) o enviar una comunicación expresa a <span className="text-cyan-400 font-mono">soporte@vynko.dev</span> indicando tu número de cuenta y voluntad de revocar el servicio. No exigimos registración previa ni trámite adicional para este derecho. Si el pago se hubiera procesado dentro de los últimos diez (10) días, se reintegrará el importe abonado.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">6. Cancelación y Baja del Servicio</h2>
            <p className="leading-relaxed">
              Podés solicitar la baja de tu suscripción en cualquier momento directamente desde el módulo de Facturación. La cancelación frenará los cobros futuros inmediatos y mantendrás el acceso al plan hasta agotar el período mensual ya abonado, sin penalidad ni permanencia mínima obligatoria.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">7. Funcionalidades Asistidas por Inteligencia Artificial</h2>
            <p className="leading-relaxed">
              Los planes que incorporan herramientas impulsadas por modelos de Inteligencia Artificial (Business y Enterprise) brindan sugerencias, resúmenes y pronósticos con fines puramente asistenciales y orientativos. El usuario reconoce y acepta que las proyecciones o sugerencias generadas por modelos algorítmicos no constituyen asesoramiento contable, fiscal, legal o de inversión vinculante, y que la decisión comercial final recae bajo la exclusiva responsabilidad del operador del negocio.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">8. Propiedad Intelectual y Titularidad de Datos</h2>
            <p className="leading-relaxed mb-3">
              Todos los derechos de propiedad intelectual, marcas, logotipos, código fuente, diseños gráficos, imágenes, íconos y metodologías de software de Vynko son propiedad exclusiva de sus creadores y están amparados por las leyes de propiedad intelectual vigentes (Ley N° 11.723). Todas las imágenes y elementos visuales utilizados en la plataforma y en los materiales de marketing son originales o cuentan con la licencia correspondiente a favor de Vynko, y no podrán ser copiados, reproducidos ni redistribuidos sin autorización previa y escrita.
            </p>
            <p className="leading-relaxed">
              La totalidad de los datos comerciales, catálogos, registros de venta y listas de clientes cargados en el sistema son propiedad estricta del cliente suscriptor. Vynko no comercializa ni adquiere titularidad sobre dichos contenidos.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">9. Limitación de Responsabilidad</h2>
            <p className="leading-relaxed">
              El Servicio se brinda en el estado en que se encuentra (&quot;as is&quot;). En la máxima medida permitida por el ordenamiento legal, Vynko no se responsabiliza por daños indirectos, lucro cesante o pérdidas derivadas de fallas en redes de telecomunicaciones ajenas, cortes de suministro eléctrico general o situaciones de fuerza mayor.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">10. Ley Aplicable y Jurisdicción</h2>
            <p className="leading-relaxed">
              Estos Términos y Condiciones se regirán e interpretarán de acuerdo con las leyes de la <strong>República Argentina</strong>. Ante cualquier controversia derivada del presente contrato, las partes acuerdan someterse a la jurisdicción de los Tribunales Ordinarios competentes correspondientes al domicilio del consumidor o los tribunales ordinarios en lo Comercial de la Ciudad Autónoma de Buenos Aires, según corresponda por ley de orden público.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">11. Soporte y Notificaciones</h2>
            <p>
              Para consultas legales, notificaciones contractuales o asistencia técnica, ponemos a disposición las siguientes vías oficiales:
            </p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <span className="text-gray-400">Consultas legales: <span className="text-cyan-400 font-mono">legal@vynko.dev</span></span>
              <span className="text-gray-400">Soporte general: <span className="text-cyan-400 font-mono">soporte@vynko.dev</span></span>
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-900 py-6 text-center space-y-2">
        <div className="flex justify-center gap-4 text-xs text-gray-400">
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
