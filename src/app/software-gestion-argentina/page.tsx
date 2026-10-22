import type { Metadata } from 'next';
import SeoLandingPage from '@/components/marketing/SeoLandingPage';
import { buildSeoMetadata, type SeoLandingContent } from '@/lib/marketing/seo-landing';

export const content: SeoLandingContent = {
  slug: 'software-gestion-argentina',
  metaTitle: 'Sistema de gestión para pequeños comercios en Argentina',
  metaDescription:
    'Sistema de gestión para pequeños comercios en Argentina: stock en tiempo real, ventas y caja, varias sucursales y precios en pesos. Probá Vynko gratis.',
  keywords: [
    'software de gestión para comercios en Argentina',
    'sistema de stock para varias sucursales',
    'software de gestión PyME Argentina',
    'sistema de ventas Argentina',
    'programa de gestión para comercios',
  ],
  badge: 'Gestión en Argentina',
  h1: 'Sistema de gestión para pequeños comercios en Argentina',
  intro:
    'Vynko es un sistema de gestión pensado para comercios argentinos: precios en pesos, soporte en español y las herramientas que necesita una PyME que crece.',
  problemsTitle: 'Gestionar un comercio en Argentina tiene sus particularidades',
  problemsIntro:
    'Cambios de precios frecuentes, varias sucursales y equipos chicos. El software tiene que acompañar ese ritmo.',
  problems: [
    {
      problem: 'Los precios cambian seguido y actualizar planilla por planilla es inviable.',
      solution: 'Ajustás precios de forma centralizada y se reflejan en todos los productos.',
    },
    {
      problem: 'Sumaste una sucursal y el stock de cada local va por separado.',
      solution: 'Gestionás varias sucursales y transferís stock entre ellas desde un panel.',
    },
    {
      problem: 'Necesitás ver cómo viene el mes sin contratar un analista.',
      solution: 'Reportes de ventas y stock claros, listos para mirar y decidir.',
    },
    {
      problem: 'Herramientas caras y en inglés que el equipo no termina usando.',
      solution: 'Interfaz en español, simple, y un plan que arranca con lo que necesitás.',
    },
    {
      problem: 'No querés atarte a un contrato largo para probar.',
      solution: 'Probás gratis, sin tarjeta, y cancelás cuando quieras.',
    },
  ],
  howToTitle: 'Cómo ordenar la gestión de tu comercio',
  howToIntro:
    'Poner un sistema en marcha no es un proyecto de meses. Estos son los pasos que sigue un comercio que quiere dejar de depender de planillas sueltas.',
  howTo: [
    {
      title: 'Cargá el catálogo y los precios actuales',
      desc: 'Subís tu Excel de productos con código de barras, precio y stock. En minutos ya tenés el catálogo cargado.',
    },
    {
      title: 'Definí qué vas a controlar',
      desc: 'Marcás el stock mínimo de cada producto y las alertas que te interesan, según lo que vende más tu negocio.',
    },
    {
      title: 'Empezá a vender y a comprar desde el celular',
      desc: 'La caja y el escáner funcionan desde el teléfono o la tablet. No hace falta instalar nada en el local.',
    },
    {
      title: 'Sumá las sucursales cuando las necesites',
      desc: 'Cuando abrís el segundo local, lo activás desde el mismo panel y empezás a transferir stock entre locales.',
    },
  ],
  featuresTitle: 'Funcionalidades para comercios argentinos',
  featuresIntro: 'Pensado para el día a día de un comercio local, no para una gran empresa.',
  features: [
    {
      icon: '🇦🇷',
      title: 'Precios en pesos',
      desc: 'Toda la plataforma trabaja en pesos argentinos, sin conversiones raras.',
    },
    {
      icon: '🏢',
      title: 'Varias sucursales',
      desc: 'Hasta 5 sucursales en Business, con transferencias de stock entre locales.',
    },
    {
      icon: '🧾',
      title: 'Ventas y caja',
      desc: 'Punto de venta con código de barras y cierre de caja diario.',
    },
    {
      icon: '📦',
      title: 'Control de stock',
      desc: 'Inventario en tiempo real con alertas de reposición.',
    },
    {
      icon: '📥',
      title: 'Importación de Excel',
      desc: 'Migrá tu catálogo actual sin cargar producto por producto.',
    },
    {
      icon: '🤝',
      title: 'Soporte en español',
      desc: 'Atención en tu idioma, con soporte prioritario en el plan Business.',
    },
  ],
  comparisonTitle: 'Una planilla suelta vs. un sistema de gestión',
  comparisonIntro:
    'El problema no es la planilla en sí: es que cada sucursal, cada persona y cada proveedor termina con la suya.',
  comparison: [
    {
      label: 'Precios y lista de productos',
      excel: 'Una planilla por local, desactualizadas',
      vynko: 'Una sola lista, actualizada para todos',
    },
    {
      label: 'Sucursales',
      excel: 'Cada local por separado, sin ver el otro',
      vynko: 'Panel único con transferencias',
    },
    {
      label: 'Equipo cargando datos',
      excel: 'Se pisan entre archivos',
      vynko: 'Mismos datos con permisos por rol',
    },
    {
      label: 'Cómo viene el mes',
      excel: 'Lo que cada uno recuerda',
      vynko: 'Reportes claros de ventas y stock',
    },
    {
      label: 'Moneda',
      excel: 'Precios que hay que convertir a mano',
      vynko: 'Todo en pesos, sin conversiones raras',
    },
    {
      label: 'Probar sin comprometerte',
      excel: 'No aplica',
      vynko: 'Prueba gratis, sin tarjeta, sin permanencia',
    },
  ],
  roiTitle: '¿Cuánto te cuesta depender de planillas sueltas?',
  roiIntro:
    'En un comercio con más de un local, el costo aparece en los precios desactualizados, el stock que no se sabe y los reportes que nadie tiene.',
  audienceTitle: '¿Para qué comercios argentinos es Vynko?',
  audienceIntro: 'Para PyMEs y comercios que quieren ordenar la gestión sin complicarse.',
  audience: [
    'PyMEs y comercios familiares',
    'Cadenas chicas con varias sucursales',
    'Distribuidoras y mayoristas',
    'Autoservicios y almacenes',
    'Comercios que venden en mostrador y depósito',
    'Negocios que necesitan controlar stock entre locales',
  ],
  pricingTitle: 'Planes para comercios en Argentina',
  pricingIntro:
    'Elegí el plan que te sirve hoy. Si más adelante necesitás sucursales o más usuarios, cambiás sin perder tus datos.',
  faqTitle: 'Preguntas frecuentes para comercios en Argentina',
  faq: [
    {
      q: '¿Los precios están en pesos argentinos?',
      a: 'Sí. Vynko factura en pesos y la plataforma está pensada para el mercado argentino.',
    },
    {
      q: '¿Puedo gestionar más de una sucursal?',
      a: 'Sí. Desde el plan Business administrás hasta 5 sucursales, con transferencias de stock entre ellas.',
    },
    {
      q: '¿Hay soporte en español?',
      a: 'Sí, la atención es en español, con soporte prioritario en el plan Business.',
    },
    {
      q: '¿Puedo migrar mi catálogo actual?',
      a: 'Sí. Importás tu Excel de productos y precios y arrancás con todo cargado.',
    },
    {
      q: '¿Necesito tarjeta de crédito para probar?',
      a: 'No. Empezás la prueba gratis sin tarjeta y cancelás cuando quieras.',
    },
  ],
  related: [
    {
      slug: 'control-de-stock',
      title: 'Control de stock',
      desc: 'Sabé cuántas unidades tenés en cada depósito, con avisos antes de quedarte sin stock.',
    },
    {
      slug: 'ventas-y-caja',
      title: 'Ventas y caja',
      desc: 'Cobrá escaneando el código de barras y cerrá el día con el arqueo ya hecho.',
    },
    {
      slug: 'control-de-compras',
      title: 'Control de compras',
      desc: 'Pedidos al proveedor, remitos de ingreso y stock que se suma solo.',
    },
  ],
  guaranteeTitle: 'Probá Vynko sin riesgo',
  guaranteeIntro:
    'Empezá hoy y decidí después. Para arrancar no te pedimos nada.',
  finalCtaTitle: 'Ordená la gestión de tu comercio',
  finalCtaText: 'Probá Vynko gratis y tené stock, ventas y sucursales bajo control.',
};

export const metadata: Metadata = buildSeoMetadata(content);

export default function SoftwareGestionArgentinaPage() {
  return <SeoLandingPage content={content} />;
}
