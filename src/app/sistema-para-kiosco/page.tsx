import type { Metadata } from 'next';
import SeoLandingPage from '@/components/marketing/SeoLandingPage';
import { buildSeoMetadata, type SeoLandingContent } from '@/lib/marketing/seo-landing';

export const content: SeoLandingContent = {
  slug: 'sistema-para-kiosco',
  metaTitle: 'Sistema para kiosco: stock, ventas y caja',
  metaDescription:
    'Sistema de gestión para kioscos y maxikioscos: escaneá cada venta, mirá el stock real y cerrá la caja sin contar a mano. Probá Vynko gratis.',
  keywords: [
    'sistema para kiosco',
    'programa para kiosco',
    'software para kiosco',
    'control de stock kiosco',
    'caja para kiosco',
    'sistema para maxikiosco',
  ],
  badge: 'Sistema para kiosco',
  h1: 'Sistema para kiosco: stock, ventas y caja sin contar a mano',
  intro:
    'Un kiosco vive de rotación: si no sabés qué se vende, qué falta y cuánto cobraste, la plata se pierde en el mostrador. Vynko te muestra el stock y la caja del día en una sola pantalla, sin planillas ni recuentos.',
  problemsTitle: 'Lo que pasa cuando el kiosco se lleva a mano',
  problemsIntro:
    'No es falta de trabajo: es que el mostrador no te deja anotar cada movimiento en una planilla.',
  problems: [
    {
      problem: 'Vendés golosinas y bebidas todo el día, pero la planilla se actualiza a la noche (o nunca).',
      solution:
        'Cada venta descuenta el stock en el momento, así el número que ves al abrir el panel ya es el real.',
    },
    {
      problem: 'Te enterás de que se acabó el producto cuando el cliente ya lo pidió.',
      solution:
        'Definís el mínimo de cada artículo y Vynko te avisa qué reponer antes de quedarte sin nada.',
    },
    {
      problem:
        'Al cerrar la caja no sabés si el faltante es un error de vuelto o mercadería que salió sin registrar.',
      solution:
        'La caja del día se cierra con las ventas ya registradas y el detalle de cada movimiento.',
    },
    {
      problem: 'El proveedor viene una vez por semana y no sabés qué pedirle.',
      solution:
        'El listado de productos críticos te muestra qué está por agotarse para armar el pedido sin adivinar.',
    },
    {
      problem: 'Comprás por caja cerrada y después no sabés cuánto te queda de cada artículo.',
      solution: 'Registrás la compra y el stock se suma solo, con el costo actualizado.',
    },
  ],
  howToTitle: 'Cómo ordenar el stock de un kiosco',
  howToIntro:
    'Se hace una vez y después el sistema trabaja con cada venta. No necesitás cerrar el kiosco para cargarlo.',
  howTo: [
    {
      title: 'Importá lo que ya tenés',
      desc: 'Subís tu planilla de Excel con productos, precios y stock actual. Si no tenés planilla, cargás los artículos escaneando el código de barras.',
    },
    {
      title: 'Marcá los mínimos',
      desc: 'Definís cuántas unidades querés tener siempre de cada producto. Ese número es el que dispara el aviso de reposición.',
    },
    {
      title: 'Vendé escaneando',
      desc: 'Con la cámara del celular o un lector, escaneás el producto, cobrás y el stock se descuenta al instante.',
    },
    {
      title: 'Cerrá la caja del día',
      desc: 'Al final del turno ves el total vendido, los medios de pago y las ventas registradas, sin recontar el mostrador.',
    },
  ],
  featuresTitle: 'Funciones pensadas para el mostrador',
  featuresIntro:
    'Nada de módulos que un kiosco no usa. Solo lo que necesitás para vender rápido y no perder el control.',
  features: [
    {
      icon: '📱',
      title: 'Escaneo con el celular',
      desc: 'No hace falta comprar un lector: la cámara del teléfono sirve para cobrar y para cargar mercadería.',
    },
    {
      icon: '⚡',
      title: 'Venta en segundos',
      desc: 'Buscás o escaneás, confirmás y listo. El stock y la caja se actualizan en el mismo movimiento.',
    },
    {
      icon: '🔔',
      title: 'Aviso de reposición',
      desc: 'Stock bajo y stock crítico separados, para saber qué pedir primero al proveedor.',
    },
    {
      icon: '💵',
      title: 'Cierre de caja',
      desc: 'El total del día y el detalle de ventas quedan registrados, sin sumar tickets a mano.',
    },
    {
      icon: '📦',
      title: 'Compras y proveedores',
      desc: 'Cuando llega el pedido, registrás la entrada y el stock se suma con el costo nuevo.',
    },
    {
      icon: '📊',
      title: 'Ventas por producto',
      desc: 'Ves qué se vende más y qué está quieto, para decidir qué sacar de la góndola.',
    },
  ],
  comparisonTitle: 'Kiosco con planilla y kiosco con Vynko',
  comparisonIntro:
    'La diferencia se nota el día que falta el producto más vendido y te enterás tarde.',
  comparison: [
    {
      label: 'Stock del día',
      excel: 'Se actualiza cuando te acordás',
      vynko: 'Se descuenta en cada venta',
    },
    {
      label: 'Reposición',
      excel: 'Cuando el cliente pregunta',
      vynko: 'Aviso antes de que se agote',
    },
    {
      label: 'Cierre de caja',
      excel: 'Sumás tickets a mano',
      vynko: 'Total y detalle ya registrados',
    },
    {
      label: 'Compras al proveedor',
      excel: 'Se anotan en un cuaderno',
      vynko: 'Se registran y suman stock',
    },
    {
      label: 'Qué se vende más',
      excel: 'No lo sabés',
      vynko: 'Ranking por producto',
    },
    {
      label: 'Varias sucursales',
      excel: 'Una planilla por local',
      vynko: 'Todo en una cuenta (plan Business)',
    },
  ],
  roiTitle: '¿Cuánto te cuesta no saber qué tenés?',
  roiIntro:
    'Cada venta perdida por falta de stock y cada diferencia de caja son plata que no vuelve. Movés los números y ves el costo.',
  audienceTitle: '¿Para qué tipo de kiosco sirve?',
  audienceIntro: 'Para comercios de mostrador con muchos artículos chicos y ventas rápidas.',
  audience: [
    'Kioscos y maxikioscos',
    'Drugstores y autoservicios de barrio',
    'Librerías y papelerías',
    'Kioscos con más de un turno',
    'Comercios que venden golosinas, bebidas y cigarrillos',
    'Kioscos que quieren abrir una segunda sucursal',
  ],
  pricingTitle: 'Planes para un kiosco',
  pricingIntro:
    'Starter alcanza para un kiosco con hasta 100 productos. Si necesitás más artículos o una segunda sucursal, pasás a Business sin perder nada.',
  faqTitle: 'Preguntas frecuentes de kiosqueros',
  faq: [
    {
      q: '¿Sirve para un kiosco chico?',
      a: 'Sí. Si tenés pocos artículos, el plan Starter entra justo: 100 productos, una sucursal y todas las funciones de stock y ventas.',
    },
    {
      q: '¿Necesito comprar un lector de código de barras?',
      a: 'No. La cámara del celular funciona como lector. Si ya tenés un lector físico, también lo podés usar.',
    },
    {
      q: '¿Puedo cargar productos que no tienen código de barras?',
      a: 'Sí. Creás el artículo con nombre, precio y categoría, y le asignás un código interno o un QR para escanearlo en el mostrador.',
    },
    {
      q: '¿Cómo sé qué tengo que reponer?',
      a: 'Definís un mínimo por producto. Vynko marca en el panel los que están en stock bajo y los que ya están en crítico.',
    },
    {
      q: '¿Puedo ver las ventas del día desde el celular?',
      a: 'Sí. El panel funciona en el celular, la tablet o la computadora del local.',
    },
    {
      q: '¿Cuánto tarda la puesta en marcha?',
      a: 'Con la planilla importada, un kiosco queda operando en la misma tarde.',
    },
  ],
  related: [
    {
      slug: 'control-de-stock',
      title: 'Control de stock',
      desc: 'El detalle de cómo se mantiene el inventario en tiempo real, sin recuentos.',
    },
    {
      slug: 'ventas-y-caja',
      title: 'Ventas y caja',
      desc: 'Cobrá escaneando y cerrá el turno con el arqueo ya hecho.',
    },
    {
      slug: 'alternativa-a-excel',
      title: 'Alternativa a Excel',
      desc: 'Dejá la planilla del kiosco y pasá a un sistema que se actualiza solo.',
    },
  ],
  guaranteeTitle: 'Probá sin poner la tarjeta',
  guaranteeIntro:
    'Empezás con la prueba gratis, cargás tu catálogo y ves si te sirve. Si no, no pagás nada.',
  finalCtaTitle: 'Ordená el kiosco esta semana',
  finalCtaText: 'Probá Vynko gratis, importá tus productos y dejá de contar el stock a mano.',
};

export const metadata: Metadata = buildSeoMetadata(content);

export default function SistemaParaKioscoPage() {
  return <SeoLandingPage content={content} />;
}
