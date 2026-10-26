import type { Metadata } from 'next';
import SeoLandingPage from '@/components/marketing/SeoLandingPage';
import { buildSeoMetadata, type SeoLandingContent } from '@/lib/marketing/seo-landing';

export const content: SeoLandingContent = {
  slug: 'sistema-para-distribuidora',
  metaTitle: 'Sistema para distribuidora: stock y ventas mayoristas',
  metaDescription:
    'Sistema de gestión para distribuidoras y mayoristas: compras, depósitos, transferencias y ventas con stock real en cada sucursal. Probá Vynko gratis.',
  keywords: [
    'sistema para distribuidora',
    'software para distribuidora',
    'sistema para mayorista',
    'control de stock distribuidora',
    'gestión de distribuidora',
    'sistema para depósito',
  ],
  badge: 'Sistema para distribuidora',
  h1: 'Sistema para distribuidora: stock real en cada depósito',
  intro:
    'Cuando vendés por cantidad y tenés mercadería en más de un lugar, la planilla deja de alcanzar el primer día. Vynko centraliza compras, depósitos, transferencias y ventas, con el stock actualizado en cada movimiento.',
  problemsTitle: 'Los problemas de manejar una distribuidora con planillas',
  problemsIntro:
    'El stock de una distribuidora no está en un solo lugar ni lo mueve una sola persona.',
  problems: [
    {
      problem: 'No sabés cuánto stock hay en cada depósito sin llamar a alguien que cuente.',
      solution:
        'Cada sucursal y ubicación tiene su stock, actualizado con cada venta, compra o transferencia.',
    },
    {
      problem: 'Transferís mercadería de un depósito a otro y la planilla queda desfasada.',
      solution:
        'La transferencia descuenta del origen y suma en el destino en el mismo movimiento.',
    },
    {
      problem: 'Los pedidos a proveedores se pierden entre WhatsApp, llamadas y correos.',
      solution:
        'El pedido queda registrado, y al recibirlo se genera el ingreso con el costo actualizado.',
    },
    {
      problem: 'No podés comparar cuánto vende cada sucursal sin sumar planillas.',
      solution:
        'El dashboard muestra ventas, ticket promedio y productos críticos por sucursal en un solo panel.',
    },
    {
      problem: 'Los costos cambian y el margen se calcula a mano en una calculadora aparte.',
      solution: 'El costo, el precio y el margen se calculan automáticamente por producto.',
    },
    {
      problem: 'Las diferencias de inventario se descubren recién en el balance.',
      solution: 'Cada ajuste queda en el historial, con su motivo y el usuario que lo hizo.',
    },
  ],
  howToTitle: 'Cómo ordenar el stock de una distribuidora',
  howToIntro:
    'Primero se define dónde vive cada cosa. Después, cada movimiento del depósito actualiza el consolidado.',
  howTo: [
    {
      title: 'Importá el catálogo completo',
      desc: 'Desde Excel, Mercado Libre o Tiendanube. El stock inicial se carga por depósito o sucursal.',
    },
    {
      title: 'Separá las sucursales',
      desc: 'Cada local o depósito tiene su propio stock y sus usuarios, con visibilidad de lo que les corresponde.',
    },
    {
      title: 'Registrá compras y transferencias',
      desc: 'El pedido al proveedor, el remito de ingreso y la transferencia entre sucursales quedan en el mismo sistema.',
    },
    {
      title: 'Vendé y mirá el consolidado',
      desc: 'Cada venta descuenta del depósito correcto y el dashboard muestra el total del negocio.',
    },
  ],
  featuresTitle: 'Funciones para distribuidoras',
  featuresIntro:
    'Lo que necesitás cuando la mercadería se mueve entre depósitos y las ventas las hace más de una persona.',
  features: [
    {
      icon: '🏢',
      title: 'Multi-sucursal',
      desc: 'Hasta 5 sucursales en Business y 99 en Enterprise, con stock separado por local.',
    },
    {
      icon: '🔄',
      title: 'Transferencias',
      desc: 'Movés mercadería entre depósitos y el stock se ajusta en los dos lados.',
    },
    {
      icon: '📦',
      title: 'Compras y remitos',
      desc: 'Pedidos pendientes, ingresos parciales y costo actualizado en cada recepción.',
    },
    {
      icon: '💲',
      title: 'Costo y margen',
      desc: 'El margen se calcula solo con el costo real de cada ingreso, sin planillas aparte.',
    },
    {
      icon: '📊',
      title: 'Dashboard consolidado',
      desc: 'Ventas por sucursal, ticket promedio y alertas de stock en un solo panel.',
    },
    {
      icon: '📱',
      title: 'Escaneo en depósito',
      desc: 'Cargás y controlás con el celular, sin llevar la computadora hasta el depósito.',
    },
  ],
  comparisonTitle: 'Distribuidora con planilla y distribuidora con Vynko',
  comparisonIntro:
    'Con varias sucursales, el problema deja de ser anotar bien y pasa a ser ver el total sin esperar el cierre.',
  comparison: [
    {
      label: 'Stock por depósito',
      excel: 'Una planilla por local',
      vynko: 'Todo en una cuenta, separado por sucursal',
    },
    {
      label: 'Transferencias',
      excel: 'Se anotan cuando se puede',
      vynko: 'Descuenta y suma en el mismo paso',
    },
    {
      label: 'Pedidos a proveedores',
      excel: 'WhatsApp y memoria',
      vynko: 'Pedido, ingreso y costo registrados',
    },
    {
      label: 'Margen por producto',
      excel: 'Calculadora aparte',
      vynko: 'Costo, precio y margen automáticos',
    },
    {
      label: 'Ventas por sucursal',
      excel: 'Se suman a mano',
      vynko: 'Dashboard consolidado',
    },
    {
      label: 'Diferencias de inventario',
      excel: 'Se ven en el balance',
      vynko: 'Historial con motivo y usuario',
    },
  ],
  roiTitle: '¿Cuánto te cuesta no ver el stock consolidado?',
  roiIntro:
    'Mercadería inmovilizada, transferencias sin registrar y ventas perdidas por falta de stock. Movés los números y ves el costo.',
  audienceTitle: '¿Para qué tipo de distribuidora sirve?',
  audienceIntro:
    'Para negocios que compran por cantidad, almacenan y venden a otros comercios o al público.',
  audience: [
    'Distribuidoras de consumo masivo',
    'Mayoristas y depósitos',
    'Distribuidoras con varias sucursales',
    'Importadores y depósitos chicos',
    'Distribuidoras de bebidas, golosinas y limpieza',
    'Comercios que venden por cantidad',
  ],
  pricingTitle: 'Planes para distribuidora',
  pricingIntro:
    'Business incluye hasta 5 sucursales y usuarios ilimitados. Si necesitás más, Enterprise se arma a medida.',
  faqTitle: 'Preguntas frecuentes de distribuidoras',
  faq: [
    {
      q: '¿Cuántas sucursales puedo manejar?',
      a: 'Hasta 5 en el plan Business y hasta 99 en Enterprise. Cada sucursal mantiene su propio stock.',
    },
    {
      q: '¿Puedo transferir stock entre depósitos?',
      a: 'Sí. La transferencia descuenta del origen, suma en el destino y queda registrada en el historial.',
    },
    {
      q: '¿Maneja listas de precios por cliente?',
      a: 'Hoy los precios son por producto y los ajustes se aplican en masa. Si necesitás listas diferenciadas por cliente, escribinos y lo evaluamos.',
    },
    {
      q: '¿Puedo registrar pedidos a proveedores y recibirlos parcialmente?',
      a: 'Sí. El pedido queda pendiente y cada ingreso actualiza el stock y el costo.',
    },
    {
      q: '¿Sirve para vender desde el celular fuera del depósito?',
      a: 'El panel funciona en el navegador del celular, así que podés consultar stock y registrar ventas fuera del depósito.',
    },
    {
      q: '¿Cómo migro mi catálogo actual?',
      a: 'Se importa desde Excel, Mercado Libre o Tiendanube, con stock y precio por sucursal.',
    },
  ],
  related: [
    {
      slug: 'control-de-compras',
      title: 'Control de compras',
      desc: 'Pedidos al proveedor, remitos de ingreso y stock que se suma solo.',
    },
    {
      slug: 'control-de-stock',
      title: 'Control de stock',
      desc: 'Inventario en tiempo real, alertas de reposición y stock por ubicación.',
    },
    {
      slug: 'software-para-ferreteria',
      title: 'Software para ferretería',
      desc: 'Si tu catálogo es grande y técnico, mirá cómo se maneja artículo por artículo.',
    },
  ],
  guaranteeTitle: 'Probá con tus depósitos reales',
  guaranteeIntro:
    'Cargás el catálogo, separás las sucursales y ves el consolidado antes de decidir. Sin tarjeta.',
  finalCtaTitle: 'Unificá el stock de tus depósitos',
  finalCtaText:
    'Probá Vynko gratis y mirá el stock de todas tus sucursales en una sola pantalla.',
};

export const metadata: Metadata = buildSeoMetadata(content);

export default function SistemaParaDistribuidoraPage() {
  return <SeoLandingPage content={content} />;
}
