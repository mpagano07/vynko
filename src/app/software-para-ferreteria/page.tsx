import type { Metadata } from 'next';
import SeoLandingPage from '@/components/marketing/SeoLandingPage';
import { buildSeoMetadata, type SeoLandingContent } from '@/lib/marketing/seo-landing';

export const content: SeoLandingContent = {
  slug: 'software-para-ferreteria',
  metaTitle: 'Software para ferretería: stock, ventas y compras',
  metaDescription:
    'Software de gestión para ferreterías: miles de artículos con stock real, precios al día, compras por proveedor y ventas escaneadas. Probá Vynko gratis.',
  keywords: [
    'software para ferretería',
    'sistema para ferretería',
    'programa para ferretería',
    'control de stock ferretería',
    'gestión de ferretería',
    'sistema para corralón',
  ],
  badge: 'Software para ferretería',
  h1: 'Software para ferretería: miles de artículos con stock real',
  intro:
    'Una ferretería no se controla con una planilla de veinte filas: son miles de artículos, precios que cambian y compras a diez proveedores distintos. Vynko ordena el catálogo, el stock y las ventas en un solo lugar.',
  problemsTitle: 'Los problemas de una ferretería con planilla',
  problemsIntro:
    'Cuantos más artículos tenés, más caro sale cada recuento manual y más rápido queda desactualizado.',
  problems: [
    {
      problem: 'Tenés miles de artículos y el recuento se hace "cuando hay tiempo".',
      solution:
        'El stock se mueve con cada venta y cada compra, así que no depende de un recuento manual.',
    },
    {
      problem: 'Muchos productos no traen código de barras y se buscan a ojo.',
      solution:
        'Creás el artículo y le asignás un QR o un código interno imprimible para escanearlo en el mostrador.',
    },
    {
      problem: 'Los precios cambian seguido y actualizarlos uno por uno lleva horas.',
      solution: 'Ajustás precios en masa por categoría o porcentaje, sin editar producto por producto.',
    },
    {
      problem: 'No sabés cuánto le compraste a cada proveedor ni qué pedido quedó pendiente.',
      solution:
        'Registrás los pedidos, los recepcionás y ves el historial de compras por proveedor.',
    },
    {
      problem: 'El cliente pide un artículo y no sabés si está en el depósito o en el local.',
      solution:
        'Consultás el stock por ubicación y transferís entre sucursales desde el mismo panel.',
    },
    {
      problem: 'Las diferencias de inventario aparecen recién en el balance.',
      solution: 'Cada movimiento queda en el historial, con su motivo y el usuario que lo hizo.',
    },
  ],
  howToTitle: 'Cómo poner la ferretería en orden',
  howToIntro:
    'La carga inicial es el único trabajo grande. Después, cada venta y cada remito mantienen el stock al día.',
  howTo: [
    {
      title: 'Importá la lista de precios',
      desc: 'Subís tu Excel con código, descripción, precio y stock. Si el archivo está desordenado, lo vas corrigiendo desde el panel.',
    },
    {
      title: 'Completá lo que falta',
      desc: 'Los artículos sin código de barras se cargan una vez y se les asigna un QR imprimible para la góndola o el cajón.',
    },
    {
      title: 'Registrá compras y ventas',
      desc: 'Cada remito de ingreso suma stock y actualiza el costo. Cada venta lo descuenta en el momento.',
    },
    {
      title: 'Reponé por proveedor',
      desc: 'Armás el pedido con los productos críticos, lo registrás al recibirlo y el stock queda al día sin planillas paralelas.',
    },
  ],
  featuresTitle: 'Funciones para ferreterías',
  featuresIntro:
    'Pensadas para catálogos grandes, artículos sin código y compras que llegan en varias entregas.',
  features: [
    {
      icon: '🏷️',
      title: 'QR para artículos sin código',
      desc: 'Imprimís etiquetas y escaneás lo que no trae código de barras de fábrica.',
    },
    {
      icon: '💰',
      title: 'Precios en masa',
      desc: 'Actualizás por categoría o porcentaje cuando cambia la lista del proveedor.',
    },
    {
      icon: '📦',
      title: 'Compras y remitos',
      desc: 'Pedidos al proveedor, ingreso de mercadería y costo actualizado en el mismo flujo.',
    },
    {
      icon: '🏢',
      title: 'Stock por ubicación',
      desc: 'Local, depósito y sucursales en una sola cuenta, con transferencias entre ellos.',
    },
    {
      icon: '📊',
      title: 'Ranking de ventas',
      desc: 'Qué se vende, qué está quieto y qué conviene dejar de comprar.',
    },
    {
      icon: '📱',
      title: 'Mostrador con celular',
      desc: 'Escaneás y cobrás desde el teléfono o desde la computadora del local.',
    },
  ],
  comparisonTitle: 'Ferretería con planilla y ferretería con Vynko',
  comparisonIntro:
    'El problema no es tener muchos artículos: es no poder confiar en el número que muestra la planilla.',
  comparison: [
    {
      label: 'Catálogo de miles de artículos',
      excel: 'Planillas que se cortan o se pisan',
      vynko: 'Un catálogo único, con búsqueda',
    },
    {
      label: 'Artículos sin código',
      excel: 'Se buscan a ojo',
      vynko: 'QR o código interno',
    },
    {
      label: 'Cambio de precios',
      excel: 'Uno por uno',
      vynko: 'Ajuste en masa por categoría',
    },
    {
      label: 'Compras al proveedor',
      excel: 'Cuaderno y factura suelta',
      vynko: 'Pedido, remito y costo',
    },
    {
      label: 'Stock por depósito',
      excel: 'No se sabe hasta contar',
      vynko: 'Por ubicación y sucursal',
    },
    {
      label: 'Diferencias de inventario',
      excel: 'Se ven en el balance',
      vynko: 'Historial de cada movimiento',
    },
  ],
  roiTitle: '¿Cuánto capital tenés dormido en el depósito?',
  roiIntro:
    'Comprar de más también cuesta: plata inmovilizada y artículos que no rotan. Movés los números y ves el impacto.',
  audienceTitle: '¿Para qué tipo de ferretería sirve?',
  audienceIntro:
    'Para comercios con catálogo grande, venta de mostrador y mercadería repartida entre local y depósito.',
  audience: [
    'Ferreterías de barrio',
    'Ferreterías con depósito',
    'Corralones y casas de materiales',
    'Pinturerías y casas de electricidad',
    'Sanitarios y grifería',
    'Ferreterías con más de una sucursal',
  ],
  pricingTitle: 'Planes para ferretería',
  pricingIntro:
    'Si tenés más de 100 artículos, el plan Business es el que te sirve: productos ilimitados, usuarios ilimitados y hasta 5 sucursales.',
  faqTitle: 'Preguntas frecuentes de ferreterías',
  faq: [
    {
      q: '¿Cuántos productos puedo cargar?',
      a: 'En Business no hay límite de productos. El plan Starter incluye 100, pensado para comercios chicos.',
    },
    {
      q: '¿Puedo cargar artículos sin código de barras?',
      a: 'Sí. Creás el artículo y le asignás un código interno o un QR que imprimís para escanearlo.',
    },
    {
      q: '¿Puedo actualizar todos los precios si sube el proveedor?',
      a: 'Sí. El ajuste de precios en masa permite aplicar un porcentaje o un monto por categoría.',
    },
    {
      q: '¿Maneja ventas por metro o por kilo?',
      a: 'Hoy el inventario se controla por unidades. Si vendés materiales a granel, escribinos y lo evaluamos con tu caso.',
    },
    {
      q: '¿Puedo ver el stock del depósito y del local por separado?',
      a: 'Sí. El stock se organiza por ubicación y podés transferir mercadería entre sucursales.',
    },
    {
      q: '¿Necesito instalar algo?',
      a: 'No. Funciona en el navegador, en la computadora del local o en el celular.',
    },
  ],
  related: [
    {
      slug: 'control-de-stock',
      title: 'Control de stock',
      desc: 'Cómo se mantiene el inventario de miles de artículos en tiempo real.',
    },
    {
      slug: 'control-de-compras',
      title: 'Control de compras',
      desc: 'Pedidos al proveedor, remitos de ingreso y stock que se suma solo.',
    },
    {
      slug: 'sistema-para-distribuidora',
      title: 'Sistema para distribuidora',
      desc: 'Si además de vender mostrador distribuís, mirá cómo se maneja el stock por depósito.',
    },
  ],
  guaranteeTitle: 'Probá con tu catálogo real',
  guaranteeIntro:
    'Importás tu lista de precios y ves cómo queda antes de decidir. La prueba no pide tarjeta.',
  finalCtaTitle: 'Poné el catálogo de la ferretería en orden',
  finalCtaText:
    'Probá Vynko gratis, importá tu lista de precios y dejá de buscar artículos a ojo.',
};

export const metadata: Metadata = buildSeoMetadata(content);

export default function SoftwareParaFerreteriaPage() {
  return <SeoLandingPage content={content} />;
}
