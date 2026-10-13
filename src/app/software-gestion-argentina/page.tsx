import type { Metadata } from 'next';
import SeoLandingPage from '@/components/marketing/SeoLandingPage';
import { buildSeoMetadata, type SeoLandingContent } from '@/lib/marketing/seo-landing';

const content: SeoLandingContent = {
  slug: 'software-gestion-argentina',
  metaTitle: 'Software de gestión para comercios en Argentina',
  metaDescription:
    'Sistema de stock y ventas para comercios en Argentina: pensado para varias sucursales, precios en pesos y equipos que crecen. Probá Vynko gratis.',
  keywords: [
    'software de gestión para comercios en Argentina',
    'sistema de stock para varias sucursales',
    'software de gestión PyME Argentina',
    'sistema de ventas Argentina',
    'programa de gestión para comercios',
  ],
  badge: 'Gestión en Argentina',
  h1: 'Software de gestión para comercios en Argentina',
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
  finalCtaTitle: 'Ordená la gestión de tu comercio',
  finalCtaText: 'Probá Vynko gratis y tené stock, ventas y sucursales bajo control.',
};

export const metadata: Metadata = buildSeoMetadata(content);

export default function SoftwareGestionArgentinaPage() {
  return <SeoLandingPage content={content} />;
}
