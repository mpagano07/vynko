import type { Metadata } from 'next';
import SeoLandingPage from '@/components/marketing/SeoLandingPage';
import { buildSeoMetadata, type SeoLandingContent } from '@/lib/marketing/seo-landing';

export const content: SeoLandingContent = {
  slug: 'control-de-stock',
  metaTitle: 'Control de stock e inventario en tiempo real',
  metaDescription:
    'Cómo controlar el stock de tu negocio sin planillas: escaneá con el celular, recibí alertas de reposición y mirá el inventario real en tiempo real. Probá gratis.',
  keywords: [
    'control de stock',
    'sistema de control de stock',
    'programa de inventario para almacenes',
    'control de inventario pequeños comercios',
    'software de stock Argentina',
  ],
  badge: 'Control de stock',
  h1: 'Control de stock para tu negocio: inventario en tiempo real',
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
  howToTitle: 'Cómo controlar el stock de tu negocio',
  howToIntro:
    'Son cuatro pasos y ninguno implica cargar el inventario a mano. Los hacés una vez al principio y después el stock se mantiene solo.',
  howTo: [
    {
      title: 'Cargá el catálogo con lo que ya tenés',
      desc: 'Subís tu planilla de Excel con los productos, el código de barras y el stock actual. También podés importar desde Mercado Libre o Tiendanube.',
    },
    {
      title: 'Marcá el mínimo de cada producto',
      desc: 'Definís a partir de cuántas unidades querés avisarte. Es el número que separa "hay que reponer" de "todavía sobra".',
    },
    {
      title: 'Registrá ventas y compras escaneando',
      desc: 'Con la cámara del celular escaneás el producto y el stock se descuenta solo. Si comprás mercadería, cargás la compra y se suma.',
    },
    {
      title: 'Reponé lo que te marquaron',
      desc: 'Vynko te avisa qué producto está por agotarse. Comprás, registrás la entrada y el inventario vuelve a estar al día.',
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
  comparisonTitle: 'Controlar el stock en Excel y en Vynko',
  comparisonIntro:
    'La diferencia no es dónde anotá el stock, sino si el número que ves hace 5 minutos sigue siendo el número real.',
  comparison: [
    {
      label: 'Stock actualizado',
      excel: 'Lo actualizás vos, a mano',
      vynko: 'Se descuenta solo en cada venta',
    },
    {
      label: 'Carga de inventario',
      excel: 'Horas de tipeo y recuentos',
      vynko: 'Importás la planilla y seguís',
    },
    {
      label: 'Aviso de reposición',
      excel: 'Cuando ya te faltó',
      vynko: 'Antes de quedarte sin stock',
    },
    {
      label: 'Stock por sucursal',
      excel: 'Una planilla por local',
      vynko: 'Todo centralizado, con transferencias',
    },
    {
      label: 'Diferencias y faltantes',
      excel: 'No las descubrís hasta el cierre',
      vynko: 'Las ves en el historial de movimientos',
    },
    {
      label: 'Consultar el inventario',
      excel: 'Buscás fila por fila',
      vynko: 'Lo abrís y ya está el número',
    },
  ],
  roiTitle: '¿Cuánto te cuesta el stock que no controlás?',
  roiIntro:
    'El stock que no controlás no es solo plata: es plata que no vuelve a tu caja. Movés los números y ves el costo real.',
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
  pricingTitle: 'Planes para controlar el stock',
  pricingIntro:
    'Elegí el plan que te sirve hoy. Si más adelante necesitás sucursales o más usuarios, cambiás sin perder tus datos.',
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
  related: [
    {
      slug: 'ventas-y-caja',
      title: 'Ventas y caja',
      desc: 'Cobrá escaneando el código de barras y cerrá el día con el arqueo ya hecho.',
    },
    {
      slug: 'alternativa-a-excel',
      title: 'Alternativa a Excel',
      desc: 'Dejá la planilla: un sistema que se actualiza solo y no depende de fórmulas.',
    },
    {
      slug: 'importar-productos-mercadolibre-tiendanube',
      title: 'Importar productos',
      desc: 'Subí tu catálogo de Mercado Libre o Tiendanube y empezá a vender el mismo día.',
    },
  ],
  guaranteeTitle: 'Probá Vynko sin riesgo',
  guaranteeIntro:
    'Empezá hoy y decidí después. Para arrancar no te pedimos nada.',
  finalCtaTitle: 'Poné tu stock en orden esta semana',
  finalCtaText: 'Probá Vynko gratis, importá tus productos y dejá de adivinar cuánto te queda.',
};

export const metadata: Metadata = buildSeoMetadata(content);

export default function ControlDeStockPage() {
  return <SeoLandingPage content={content} />;
}
