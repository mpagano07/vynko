import type { Metadata } from 'next';
import SeoLandingPage from '@/components/marketing/SeoLandingPage';
import { buildSeoMetadata, type SeoLandingContent } from '@/lib/marketing/seo-landing';

const content: SeoLandingContent = {
  slug: 'control-de-stock',
  metaTitle: 'Control de stock para pequeños comercios',
  metaDescription:
    'Sistema de control de stock para pequeños comercios y almacenes: escaneá con el celular, recibí alertas de reposición y sincronizá el inventario en tiempo real. Probá gratis.',
  keywords: [
    'control de stock',
    'sistema de control de stock',
    'programa de inventario para almacenes',
    'control de inventario pequeños comercios',
    'software de stock Argentina',
  ],
  badge: 'Control de stock',
  h1: 'Control de stock para pequeños comercios y almacenes',
  intro:
    'Si llevás el stock en planillas o de memoria, siempre hay un producto que falta o que sobra. Vynko te da un inventario en tiempo real que se actualiza solo con cada venta, compra o transferencia, desde cualquier dispositivo.',
  problemsTitle: 'Los problemas de controlar el stock a mano',
  problemsIntro:
    'Estos son los dolores que más nos repiten los comercios que llegan desde Excel o el papel.',
  problems: [
    {
      problem: 'No sabés cuántas unidades tenés realmente hasta que hacés el recuento.',
      solution:
        'El stock se descuenta y suma en el momento de cada venta, compra o ajuste, así que el número que ves es el real.',
    },
    {
      problem: 'Te enterás de que un producto se agotó justo cuando el cliente te lo pide.',
      solution:
        'Definís un mínimo por producto y Vynko te avisa cuándo hay que reponer, antes de quedarte sin stock.',
    },
    {
      problem: 'Cargar el stock en la planilla lleva horas y siempre queda desactualizada.',
      solution:
        'Escaneás el código de barras con la cámara del celular y el movimiento se registra al instante, sin tipear.',
    },
    {
      problem: 'No podés saber qué se vende más sin cruzar datos a mano.',
      solution:
        'El dashboard reúne ventas, productos críticos y movimientos en un panel único.',
    },
  ],
  featuresTitle: 'Funcionalidades de control de stock',
  featuresIntro: 'Lo que necesitás para tener el inventario bajo control, sin módulos de más.',
  features: [
    {
      icon: '📱',
      title: 'Teléfono como escáner',
      desc: 'Usá la cámara del celular para escanear códigos de barras y actualizar el stock al instante.',
    },
    {
      icon: '🔔',
      title: 'Alertas de bajo stock',
      desc: 'Definí mínimos y recibí avisos cuando un producto está por agotarse.',
    },
    {
      icon: '🔄',
      title: 'Sincronización en tiempo real',
      desc: 'Cada venta, compra o transferencia impacta el stock al momento en todos los dispositivos.',
    },
    {
      icon: '📥',
      title: 'Importación desde Excel',
      desc: 'Subí tu catálogo actual desde una planilla y empezá sin cargar producto por producto.',
    },
    {
      icon: '🏢',
      title: 'Varias sucursales',
      desc: 'Consultá y transferí stock entre sucursales desde un mismo panel (plan Business).',
    },
    {
      icon: '📊',
      title: 'Historial y reportes',
      desc: 'Revisá cómo se movió cada producto y detectá faltantes o diferencias.',
    },
  ],
  audienceTitle: '¿Para quién es este control de stock?',
  audienceIntro:
    'Vynko está pensado para comercios chicos y medianos que necesitan orden sin contratar un sistema pesado.',
  audience: [
    'Almacenes y autoservicios de barrio',
    'Kioscos y maxikioscos',
    'Tiendas de ropa y calzado',
    'Ferreterías y corralones',
    'Distribuidoras y mayoristas chicos',
    'Comercios con más de un depósito o sucursal',
  ],
  faqTitle: 'Preguntas frecuentes sobre control de stock',
  faq: [
    {
      q: '¿Necesito comprar un lector de código de barras?',
      a: 'No. Podés usar la cámara del celular o de una computadora con webcam para escanear. Si ya tenés un lector físico, también funciona.',
    },
    {
      q: '¿Puedo importar mi lista de productos y precios actual?',
      a: 'Sí. Vynko importa tu catálogo desde un archivo Excel, así que no arrancás de cero ni cargás producto por producto.',
    },
    {
      q: '¿El stock se actualiza solo cuando vendo?',
      a: 'Sí. Cada venta descuenta las unidades automáticamente, y cada compra o transferencia las suma, sin cargas manuales.',
    },
    {
      q: '¿Sirve si tengo más de una sucursal?',
      a: 'Sí. Desde el plan Business podés gestionar hasta 5 sucursales y transferir stock entre ellas.',
    },
    {
      q: '¿Cuánto tarda la puesta en marcha?',
      a: 'La mayoría de los comercios importa su catálogo y queda operando en menos de 5 minutos.',
    },
  ],
  finalCtaTitle: 'Poné tu stock en orden esta semana',
  finalCtaText: 'Probá Vynko gratis, importá tus productos y dejá de adivinar cuánto te queda.',
};

export const metadata: Metadata = buildSeoMetadata(content);

export default function ControlDeStockPage() {
  return <SeoLandingPage content={content} />;
}
