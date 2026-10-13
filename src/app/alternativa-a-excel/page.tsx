import type { Metadata } from 'next';
import SeoLandingPage from '@/components/marketing/SeoLandingPage';
import { buildSeoMetadata, type SeoLandingContent } from '@/lib/marketing/seo-landing';

const content: SeoLandingContent = {
  slug: 'alternativa-a-excel',
  metaTitle: 'Alternativa a Excel para administrar tu negocio',
  metaDescription:
    'Cómo dejar de controlar el stock en Excel: pasá a un sistema que se actualiza solo, con alertas y reportes, e importá tu planilla en minutos. Probá gratis.',
  keywords: [
    'alternativa a Excel',
    'dejar de usar Excel para el stock',
    'control de stock sin planillas',
    'software en lugar de Excel',
    'administrar negocio sin Excel',
  ],
  badge: 'Alternativa a Excel',
  h1: 'La alternativa a Excel para administrar el stock de tu negocio',
  intro:
    'Excel funciona hasta que dos personas editan la planilla, una fórmula se rompe o se te pasa un recuento. Vynko reemplaza esa planilla por un sistema que mantiene los números solos.',
  problemsTitle: 'Por qué Excel deja de alcanzar',
  problemsIntro: 'No es que Excel sea malo: es que no está pensado para el ritmo diario de un comercio.',
  problems: [
    {
      problem: 'Dos personas editan la planilla y se pisan los cambios.',
      solution: 'Cada usuario trabaja sobre los mismos datos en tiempo real, sin versiones duplicadas.',
    },
    {
      problem: 'Las fórmulas se rompen al agregar filas o productos.',
      solution: 'El sistema calcula stock y precios por vos; no hay fórmulas que mantener.',
    },
    {
      problem: 'No hay avisos: te enterás del quiebre cuando ya perdiste la venta.',
      solution: 'Las alertas de bajo stock te avisan antes de que falte el producto.',
    },
    {
      problem: 'Cada reporte es media hora de tablas dinámicas.',
      solution: 'Los reportes de ventas y stock salen listos, sin armar nada.',
    },
    {
      problem: 'Migrar asusta porque toda tu información está en Excel.',
      solution: 'Importás tu planilla actual de productos y precios en minutos.',
    },
  ],
  featuresTitle: 'Lo que ganás al dejar Excel',
  featuresIntro: 'Todo lo que hacías en la planilla, pero calculado y actualizado solo.',
  features: [
    {
      icon: '📥',
      title: 'Importá tu catálogo',
      desc: 'Subí el Excel o CSV que exportás de Mercado Libre o Tiendanube y seguí sin cargar todo de nuevo.',
    },
    {
      icon: '🧮',
      title: 'Cálculos automáticos',
      desc: 'Stock, totales y márgenes se calculan solos; no hay fórmulas que romper.',
    },
    {
      icon: '👥',
      title: 'Trabajo en equipo',
      desc: 'Varios usuarios sobre los mismos datos, cada uno con su acceso.',
    },
    {
      icon: '🔔',
      title: 'Alertas automáticas',
      desc: 'Avisos de reposición sin revisar la planilla a mano.',
    },
    {
      icon: '📊',
      title: 'Reportes instantáneos',
      desc: 'Ventas, productos críticos y movimientos listos para mirar.',
    },
    {
      icon: '☁️',
      title: 'Todo en la nube',
      desc: 'Tus datos accesibles desde cualquier dispositivo, sin archivos perdidos.',
    },
  ],
  audienceTitle: '¿A quién le sirve dejar Excel atrás?',
  audienceIntro: 'Si tu negocio ya no entra en una planilla, este es el momento.',
  audience: [
    'Comercios que arrancaron controlando todo en Excel',
    'Negocios con más de una persona cargando datos',
    'Locales que crecieron y ya no entran en una hoja',
    'Comercios que quieren reportes sin armarlos',
    'Quienes necesitan saber el stock real al instante',
    'Negocios que prefieren alertas antes que recuentos',
  ],
  faqTitle: 'Preguntas frecuentes sobre dejar Excel',
  faq: [
    {
      q: '¿Puedo seguir usando Excel para algunas cosas?',
      a: 'Sí. Podés exportar la información de Vynko cuando la necesites, pero el control diario deja de depender de la planilla.',
    },
    {
      q: '¿Pierdo la información que ya tengo en Excel?',
      a: 'No. Importás tus productos y precios actuales y arrancás con todo cargado.',
    },
    {
      q: '¿Puedo importar el catálogo que ya tengo en Mercado Libre o Tiendanube?',
      a: 'Sí. Exportás tu catálogo a Excel o CSV desde esas plataformas y lo subís a Vynko. Es una importación del archivo, no una conexión automática: cuando cambie, volvés a importar.',
    },
    {
      q: '¿Es difícil acostumbrarse?',
      a: 'La pantalla de venta y la de stock son simples; la mayoría empieza a usarlo el mismo día.',
    },
    {
      q: '¿Qué pasa con el historial de movimientos?',
      a: 'Vynko guarda el historial de stock y ventas, algo que en Excel se pierde al sobrescribir la planilla.',
    },
    {
      q: '¿Necesito instalar algo?',
      a: 'No. Funciona desde el navegador y desde el celular, sin instalar programas.',
    },
  ],
  finalCtaTitle: 'Pasá de la planilla al sistema',
  finalCtaText: 'Importá tu Excel actual y comprobá lo que es tener el stock bajo control.',
};

export const metadata: Metadata = buildSeoMetadata(content);

export default function AlternativaAExcelPage() {
  return <SeoLandingPage content={content} />;
}
