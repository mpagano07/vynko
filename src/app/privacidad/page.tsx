import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Política de Privacidad | Vynko',
  description: 'Política de privacidad, tratamiento de datos personales y derechos ARCO según Ley 25.326 de la plataforma Vynko.',
};

export default function PrivacidadPage() {
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
          Política de Privacidad y Protección de Datos
        </h1>
        <p className="text-sm text-gray-400 mb-8">Última actualización: Septiembre 2026</p>

        <div className="space-y-6 text-gray-300">
          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">1. Responsable del Tratamiento</h2>
            <p className="leading-relaxed">
              Vynko es una plataforma de software como servicio (SaaS) orientada a la gestión comercial e inventario B2B. A los efectos de la Ley N° 25.326 de Protección de Datos Personales de la República Argentina, Vynko actúa como Responsable del Tratamiento de los datos de cuenta y facturación de sus usuarios, y como Encargado del Tratamiento respecto de los datos de clientes, productos e inventario cargados por cada comercio suscriptor en el uso habitual del servicio.
            </p>
            <p className="mt-2 text-sm text-gray-400">
              Canal oficial de contacto de privacidad: <span className="text-cyan-400 font-mono">privacidad@vynko.dev</span>
            </p>
            <p className="mt-3 text-xs text-gray-400 leading-relaxed">
              <strong className="text-gray-300">Usuarios de la Unión Europea y el EEE:</strong> la República Argentina cuenta con decisión de adecuación de la Comisión Europea vigente desde enero de 2024, por lo que la transferencia y el tratamiento de tus datos conforme a esta política se consideran amparados por el RGPD (UE) 2016/679. Si tenés domicilio en el EEE, podés ejercer además los derechos que te otorga el RGPD (acceso, rectificación, supresión, limitación, portabilidad y oposición) escribiendo a <span className="text-cyan-400 font-mono">privacidad@vynko.dev</span>.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">2. Información que Recopilamos</h2>
            <p className="mb-3">Recopilamos únicamente la información necesaria para brindar y asegurar el servicio:</p>
            <ul className="list-disc list-inside space-y-2 text-gray-300">
              <li>
                <strong>Datos de Identificación y Cuenta:</strong> Nombre completo, correo electrónico, nombre de fantasía o razón social del comercio, y credenciales de acceso protegidas criptográficamente. Si utilizas inicio de sesión con Google (OAuth), recibimos tu nombre y correo electrónico autorizados por tu cuenta.
              </li>
              <li>
                <strong>Datos de Operación Comercial:</strong> Catálogo de productos, códigos de barra / QR, niveles de stock, sucursales, precios de venta y costo, registro de movimientos, ventas e historial de transacciones cargadas por tu negocio.
              </li>
              <li>
                <strong>Datos Técnicos y de Conectividad:</strong> Dirección IP, agente de usuario del navegador, sistema operativo y eventos de diagnóstico de red necesarios para mitigar abusos y asegurar la disponibilidad del sistema.
              </li>
              <li>
                <strong>Cookies y Tecnologías de Almacenamiento:</strong> Empleamos almacenamiento local y cookies técnicas estrictamente necesarias para sostener tu sesión autenticada y tus preferencias visuales. Podés consultar el detalle en nuestra{' '}
                <Link href="/cookies" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2">
                  Política de Cookies
                </Link>.
              </li>
            </ul>
            <div className="mt-4 p-3 bg-gray-950 border border-gray-800 rounded-lg text-xs text-gray-400">
              <strong className="text-gray-300">Notificación previa (art. 6, Ley N° 25.326):</strong> los datos que nos proporcionás son de carácter optativo para la prestación del servicio, salvo los estrictamente necesarios para el alta de la cuenta y la operación básica. La finalidad del tratamiento, la identidad del Responsable y el carácter de estas solicitudes quedan informados en esta Política. Tenés derecho de acceso, rectificación, cancelación y oposición (ARCO) en los términos de la sección 7.
            </div>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">3. Finalidades del Tratamiento</h2>
            <p className="mb-3">Tus datos personales y comerciales se utilizan con las siguientes finalidades legítimas:</p>
            <ul className="list-disc list-inside space-y-2 text-gray-300">
              <li>Proveer, sincronizar y operar el sistema de gestión de inventario, punto de venta y control multi-sucursal.</li>
              <li>Administrar altas de cuenta, recuperación de credenciales y comunicaciones esenciales sobre el estado de la suscripción o alertas de seguridad.</li>
              <li>Procesar el cobro recurrente de suscripciones a través de pasarelas de pago homologadas (Mercado Pago). Vynko no almacena datos sensibles de tarjetas de crédito o débito.</li>
              <li>Proveer soporte técnico asistido y responder a consultas o requerimientos operativos.</li>
              <li>Cumplir con requerimientos legales, contables o regulatorios aplicables.</li>
            </ul>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">4. Subencargados del Tratamiento y Transferencia Internacional</h2>
            <p className="mb-3">
              Para garantizar infraestructura segura de alta disponibilidad, Vynko contrata servicios de proveedores tecnológicos de primer nivel bajo estrictos acuerdos de confidencialidad y procesamiento seguro de datos:
            </p>
            <ul className="list-disc list-inside space-y-2 text-gray-300">
              <li>
                <strong>Supabase Inc. / Amazon Web Services (AWS):</strong> Alojamiento de bases de datos PostgreSQL con cifrado en reposo y en tránsito, autenticación y almacenamiento en la nube bajo estándares ISO 27001 y SOC 2.
              </li>
              <li>
                <strong>Vercel Inc.:</strong> Infraestructura de despliegue, entrega y balanceo de carga de la aplicación web.
              </li>
              <li>
                <strong>Mercado Pago:</strong> Pasarela de pagos certificada PCI-DSS para el procesamiento seguro de transacciones monetarias y suscripciones.
              </li>
              <li>
                <strong>Google Generative AI (Google LLC):</strong> En los planes habilitados (Business y Enterprise) que utilizan voluntariamente funciones de análisis o asistencia por Inteligencia Artificial, se procesan únicamente las consultas puntuales generadas para dicho análisis. No se ceden datos personales a modelos públicos de terceros ni se comercializa tu información.
              </li>
            </ul>
            <p className="mt-3 text-xs text-gray-400">
              Las transferencias internacionales de datos hacia estos proveedores se realizan bajo cláusulas contractuales tipo y estándares adecuados de seguridad contemplados en el art. 12 de la Ley 25.326, así como bajo la decisión de adecuación de la Unión Europea sobre Argentina para los usuarios del EEE.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">5. Seguridad y Aislamiento de Datos (Multi-Tenant)</h2>
            <p className="leading-relaxed">
              Vynko implementa arquitectura multi-tenant con <strong>Row Level Security (RLS)</strong> estricta a nivel de base de datos PostgreSQL. Esto garantiza que ningún comercio o usuario ajeno pueda consultar, modificar o interceptar los datos de tu empresa. Todas las comunicaciones viajan encriptadas mediante protocolo TLS 1.3 / HTTPS.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">6. Plazo de Conservación de Datos</h2>
            <p className="leading-relaxed">
              Los datos se conservarán durante la vigencia de la suscripción y el uso activo de la cuenta. En caso de baja o cancelación voluntaria, podés solicitar la exportación o eliminación de tus registros escribiendo a <span className="text-cyan-400 font-mono">privacidad@vynko.dev</span>; la eliminación se procesará dentro de los plazos legales. Vynko conservará únicamente aquellos datos indispensables para responder ante obligaciones fiscales o legales vigentes por los plazos de prescripción aplicables.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">7. Derechos ARCO (Acceso, Rectificación, Cancelación y Oposición)</h2>
            <p className="mb-3 leading-relaxed">
              De acuerdo con la <strong>Ley N° 25.326 de Protección de Datos Personales</strong>, los titulares de los datos tienen derecho a acceder a los mismos de forma gratuita a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo al efecto, así como a solicitar su actualización, rectificación o supresión.
            </p>
            <p className="mb-3 text-sm leading-relaxed">
              Para ejercer cualquiera de tus derechos ARCO, enviá un correo electrónico a <span className="text-cyan-400 font-mono">privacidad@vynko.dev</span> con el asunto &quot;Derechos ARCO&quot;, adjuntando copia de tu documento de identidad para acreditar titularidad sobre la cuenta. Responderemos tu solicitud dentro del plazo legal de diez (10) días hábiles (art. 14, inc. 3, Ley N° 25.326).
            </p>
            <div className="p-3 bg-gray-950 border border-gray-800 rounded-lg text-xs text-gray-400">
              <strong className="text-gray-300">Aviso legal AAIP:</strong> &quot;La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley N° 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.&quot; (Sitio web:{' '}
              <a href="https://www.argentina.gob.ar/aaip" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">
                argentina.gob.ar/aaip
              </a>
              ).
            </div>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">8. Registro Nacional de Bases de Datos</h2>
            <p className="leading-relaxed">
              De conformidad con el <strong>art. 21 de la Ley N° 25.326</strong>, los archivos o bases de datos personales deben inscribirse en el Registro Nacional de Bases de Datos (RNBDP) ante la Agencia de Acceso a la Información Pública (AAIP). Vynko inscribe y mantiene al día sus bases de datos de usuarios y clientes en el citado registro.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">9. Menores de Edad</h2>
            <p className="leading-relaxed">
              Vynko es un servicio orientado a comercios, empresas y profesionales independientes. No recopilamos intencionalmente datos de menores de 18 años. El uso de la plataforma está restringido a personas con plena capacidad legal para contratar.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">10. Actualizaciones de la Política</h2>
            <p className="leading-relaxed">
              Podemos actualizar periódicamente esta Política de Privacidad para reflejar cambios normativos o mejoras en la plataforma. Te notificaremos sobre cambios sustanciales a través de la aplicación o por correo electrónico. El uso continuado del servicio posterior a la notificación constituye la conformidad con los términos actualizados. Vynko se obliga asimismo a adecuar esta política a cualquier reforma de la Ley N° 25.326 o normativa que la reemplace o modifique oportunamente sancionada, desde su entrada en vigencia.
            </p>
          </section>

          <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-3">11. Contacto</h2>
            <p className="leading-relaxed">
              Ante cualquier duda sobre esta Política de Privacidad, podés escribirnos a <span className="text-cyan-400 font-mono">privacidad@vynko.dev</span>. Revisá también nuestra{' '}
              <Link href="/cookies" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2">Política de Cookies</Link>{' '}
              y nuestros{' '}
              <Link href="/terminos" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2">Términos y Condiciones</Link>.
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-900 py-6 text-center space-y-2">
        <div className="flex justify-center gap-4 text-xs text-gray-400">
          <Link href="/cookies" className="hover:text-gray-200 underline underline-offset-2">Política de Cookies</Link>
          <Link href="/terminos" className="hover:text-gray-200 underline underline-offset-2">Términos y Condiciones</Link>
          <Link href="/" className="hover:text-gray-200 underline underline-offset-2">Inicio</Link>
        </div>
        <p className="text-xs text-gray-400">
          © {new Date().getFullYear()} Vynko. Todos los derechos reservados. Logotipo e imágenes: propiedad de Vynko.
        </p>
      </footer>
    </div>
  );
}
