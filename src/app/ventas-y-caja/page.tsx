import type { Metadata } from 'next';
import SeoLandingPage from '@/components/marketing/SeoLandingPage';
import { buildSeoMetadata, type SeoLandingContent } from '@/lib/marketing/seo-landing';

const content: SeoLandingContent = {
  slug: 'ventas-y-caja',
  metaTitle: 'Sistema de ventas con lector de código de barras',
  metaDescription:
    'Programa de caja para comercio con lector de código de barras: registrá ventas, cobrá y actualizá el stock automáticamente. Probá Vynko gratis.',
  keywords: [
    'sistema de ventas',
    'programa de caja para comercio',
    'lector de código de barras',
    'punto de venta',
    'software de ventas Argentina',
  ],
  badge: 'Ventas y caja',
  h1: 'Sistema de ventas y caja con lector de código de barras',
  intro:
    'Cobrá más rápido, sin errores de tipeo y con el stock actualizado en el mismo momento en que cerrás la venta.',
  problemsTitle: 'Cuando la caja y el stock van por separado',
  problemsIntro: 'Vender con una caja que no habla con el stock es la forma más fácil de perder plata.',
  problems: [
    {
      problem: 'Anotás la venta en un lado y el stock en otro, y los números nunca cierran.',
      solution: 'Vynko registra la venta y descuenta el stock en el mismo movimiento, sin doble carga.',
    },
    {
      problem: 'Tipear códigos a mano hace lento el cobro y genera errores.',
      solution: 'Escaneás el código de barras y el producto se agrega solo a la venta.',
    },
    {
      problem: 'No sabés cuánto vendiste ni qué producto se movió más.',
      solution: 'Reportes de ventas diarias, mensuales y por producto, listos sin armar planillas.',
    },
    {
      problem: 'Tenés que sumar la caja del día a mano y siempre hay diferencias.',
      solution: 'Abrí y cerrá la caja con los movimientos registrados y un arqueo claro.',
    },
  ],
  featuresTitle: 'Funcionalidades de ventas y caja',
  featuresIntro: 'Una caja simple de usar, conectada al stock y a los reportes del negocio.',
  features: [
    {
      icon: '🏷️',
      title: 'Venta por código de barras',
      desc: 'Escaneás el producto y el precio se carga solo, sin tipear códigos.',
    },
    {
      icon: '💵',
      title: 'Caja diaria',
      desc: 'Abrí, registrá movimientos y cerrá la caja con el arqueo del día.',
    },
    {
      icon: '⚡',
      title: 'Cobro rápido',
      desc: 'Una pantalla de venta pensada para despachar al cliente sin demoras.',
    },
    {
      icon: '📦',
      title: 'Stock automático',
      desc: 'Cada venta resta unidades y dispara las alertas de reposición.',
    },
    {
      icon: '👥',
      title: 'Varios vendedores',
      desc: 'Cada usuario entra con su acceso y sus ventas quedan identificadas.',
    },
    {
      icon: '📈',
      title: 'Reportes de ventas',
      desc: 'Mirá ventas por día, mes y producto para tomar mejores decisiones.',
    },
  ],
  audienceTitle: '¿Para quién es este sistema de ventas y caja?',
  audienceIntro: 'Para comercios que venden en mostrador y necesitan cobrar rápido sin perder el stock.',
  audience: [
    'Almacenes y autoservicios',
    'Kioscos y tiendas de conveniencia',
    'Locales de ropa y accesorios',
    'Farmacias y perfumerías',
    'Bazares y ferreterías',
    'Comercios con más de un vendedor',
  ],
  faqTitle: 'Preguntas frecuentes sobre ventas y caja',
  faq: [
    {
      q: '¿Funciona con cualquier lector de código de barras?',
      a: 'Sí, con lectores USB estándar y también con la cámara del celular o la webcam de la computadora.',
    },
    {
      q: '¿Puedo cobrar en efectivo, tarjeta o transferencia?',
      a: 'Sí. Registrás el medio de pago de cada venta para que el cierre de caja quede claro.',
    },
    {
      q: '¿Varios vendedores pueden usar la misma cuenta?',
      a: 'Sí. Cada persona entra con su usuario y sus ventas quedan identificadas.',
    },
    {
      q: '¿La caja se cierra con el arqueo?',
      a: 'Sí. Registrás los movimientos y hacés el cierre para comparar lo esperado contra lo real.',
    },
    {
      q: '¿Sirve si vendo y a la vez compro mercadería?',
      a: 'Sí. Las ventas descuentan stock y las compras lo suman, todo dentro del mismo sistema.',
    },
  ],
  finalCtaTitle: 'Cobrá más rápido y sin errores',
  finalCtaText: 'Empezá a vender con Vynko y mantené el stock y la caja siempre en orden.',
};

export const metadata: Metadata = buildSeoMetadata(content);

export default function VentasYCajaPage() {
  return <SeoLandingPage content={content} />;
}
