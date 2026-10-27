import type { Metadata } from 'next';
import SeoLandingPage from '@/components/marketing/SeoLandingPage';
import { buildSeoMetadata, type SeoLandingContent } from '@/lib/marketing/seo-landing';

export const content: SeoLandingContent = {
  slug: 'ventas-y-caja',
  metaTitle: 'Sistema de ventas y caja para pequeños comercios',
  metaDescription:
    'Programa para controlar ventas y caja: cobrá escaneando el código de barras, actualizá el stock al instante y cerrá el día con arqueo. Probá gratis.',
  keywords: [
    'sistema de ventas',
    'programa de caja para comercio',
    'lector de código de barras',
    'punto de venta',
    'software de ventas Argentina',
  ],
  badge: 'Ventas y caja',
  h1: 'Sistema de ventas y caja para pequeños comercios',
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
  howToTitle: 'Cómo controlar las ventas y la caja de tu negocio',
  howToIntro:
    'Así se registra una venta con Vynko, de punta a punta. El stock se actualiza solo: no hay una segunda carga de datos que se pueda olvidar.',
  howTo: [
    {
      title: 'Abrí la caja al empezar el día',
      desc: 'Indicás el monto inicial con el que arrancás. Queda registrado y sirve de punto de comparación para el cierre.',
    },
    {
      title: 'Escaneá el producto',
      desc: 'Pasás la cámara por el código de barras. El producto entra a la venta con su precio y su stock se descuenta solo.',
    },
    {
      title: 'Elegí cómo paga el cliente',
      desc: 'Efectivo, tarjeta o transferencia. Cada medio de pago queda separado, así el arqueo del cierre no tiene sorpresas.',
    },
    {
      title: 'Cerrá la caja y compará',
      desc: 'Al terminar el día, Vynko te muestra cuánto esperabas, cuánto entró y dónde está la diferencia, si la hay.',
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
  comparisonTitle: 'Cobrar con una caja propia vs. con Vynko',
  comparisonIntro:
    'El punto de venta no es solo cobrar: es dejar el stock y los números del día ordenados sin trabajo extra.',
  comparison: [
    {
      label: 'Cargo de cada venta',
      excel: 'Anotás la venta en un papel',
      vynko: 'Queda registrada con hora y medio de pago',
    },
    {
      label: 'Descuento de stock',
      excel: 'Lo hacés aparte y a veces te olvidás',
      vynko: 'Se descuenta con la venta, en el mismo momento',
    },
    {
      label: 'Arqueo del día',
      excel: 'Sumás a mano y no cierra',
      vynko: 'Esperado contra real, con la diferencia señalada',
    },
    {
      label: 'Ventas por vendedor',
      excel: 'No sabés quién vendió qué',
      vynko: 'Cada usuario con su acceso y sus ventas',
    },
    {
      label: 'Reporte del mes',
      excel: 'Lo armás a mano con la planilla',
      vynko: 'Sale listo por día, mes y producto',
    },
    {
      label: 'Errores de tipeo',
      excel: 'Pagas un código mal y no te enterás',
      vynko: 'El escaneo no se equivoca',
    },
  ],
  roiTitle: '¿Cuánto tiempo perdés cobrando a mano?',
  roiIntro:
    'Cada minuto por venta se multiplica por todas las ventas del día. Movés los números y ves cuánto te cuesta no automatizar el cobro.',
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
  pricingTitle: 'Planes para vender y llevar la caja',
  pricingIntro:
    'Elegí el plan que te sirve hoy. Si más adelante necesitás sucursales o más usuarios, cambiás sin perder tus datos.',
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
  related: [
    {
      slug: 'control-de-stock',
      title: 'Control de stock',
      desc: 'Sabé cuántas unidades tenés en cada depósito, con avisos antes de quedarte sin stock.',
    },
    {
      slug: 'control-de-compras',
      title: 'Control de compras',
      desc: 'Pedidos al proveedor, remitos de ingreso y stock que se suma solo.',
    },
    {
      slug: 'software-gestion-argentina',
      title: 'Gestión en Argentina',
      desc: 'Stock, caja y varias sucursales en pesos, con soporte en español.',
    },
  ],
  guaranteeTitle: 'Probá Vynko sin riesgo',
  guaranteeIntro:
    'Empezá hoy y decidí después. Para arrancar no te pedimos nada.',
  finalCtaTitle: 'Cobrá más rápido y sin errores',
  finalCtaText: 'Empezá a vender con Vynko y mantené el stock y la caja siempre en orden.',
};

export const metadata: Metadata = buildSeoMetadata(content);

export default function VentasYCajaPage() {
  return <SeoLandingPage content={content} />;
}
