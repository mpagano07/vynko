import type { Metadata } from 'next';
import SeoLandingPage from '@/components/marketing/SeoLandingPage';
import { buildSeoMetadata, type SeoLandingContent } from '@/lib/marketing/seo-landing';

export const content: SeoLandingContent = {
  slug: 'importar-productos-mercadolibre-tiendanube',
  metaTitle: 'Importar productos de Mercado Libre o Tiendanube',
  metaDescription:
    'Pasá tu catálogo de Mercado Libre o Tiendanube a Vynko: exportás el Excel o CSV y lo importás en minutos, con stock, precios y códigos de barras. Probá gratis.',
  keywords: [
    'importar productos mercadolibre',
    'importar productos tiendanube',
    'migrar catálogo mercadolibre',
    'pasar productos de tiendanube',
    'importar excel productos',
    'cargar productos masivamente',
  ],
  badge: 'Importar catálogo',
  h1: 'Importá tu catálogo de Mercado Libre o Tiendanube',
  intro:
    'No hace falta cargar producto por producto. Exportás tu catálogo desde Mercado Libre o Tiendanube, subís el archivo a Vynko y seguís con tus productos, precios y códigos de barras ya cargados.',
  problemsTitle: 'Pasar tu catálogo no tiene por qué ser un trabajo manual',
  problemsIntro: 'Cargar cientos de productos a mano es la parte que todos postergan.',
  problems: [
    {
      problem: 'Cargar producto por producto lleva días.',
      solution: 'Importás el catálogo completo de una vez y arrancás con todo listo.',
    },
    {
      problem: 'No querés volver a tipear códigos de barras y precios.',
      solution: 'Vynko lee las columnas de SKU, código de barras, precio y stock del archivo.',
    },
    {
      problem: 'Tu catálogo vive en el archivo que exporta la plataforma.',
      solution: 'Subís el Excel o CSV que exportás de Mercado Libre o Tiendanube tal como sale.',
    },
    {
      problem: 'Si el catálogo cambia, no querés rehacer todo de nuevo.',
      solution: 'Volvés a importar el archivo actualizado y Vynko reconoce los productos que ya tenías.',
    },
  ],
  howToTitle: 'Cómo importar tu catálogo paso a paso',
  howToIntro:
    'No hace falta conectar Vynko con Mercado Libre ni con Tiendanube: exportás el archivo de cada plataforma y lo subís. Esto es todo lo que tenés que hacer.',
  howTo: [
    {
      title: 'Exportá tu catálogo',
      desc: 'En Mercado Libre y en Tiendanube exportás tus productos a Excel o CSV. Bajás el archivo tal como te lo da la plataforma.',
    },
    {
      title: 'Subilo a Vynko',
      desc: 'Elegís el archivo y Vynko reconoce las columnas: título, SKU, código de barras, precio, stock e imágenes.',
    },
    {
      title: 'Revisá la previsualización',
      desc: 'Antes de confirmar ves cuántas columnas se detectaron y cuántos productos se van a cargar. Si algo no está, lo ajustás en el archivo.',
    },
    {
      title: 'Confirmá y empezá a vender',
      desc: 'Los productos quedan con su código de barras, su precio y su stock. Ya podés escanearlos en la caja.',
    },
  ],
  featuresTitle: 'Qué incluye la importación',
  featuresIntro: 'El archivo que ya tenés, leído y ordenado.',
  features: [
    {
      icon: '📥',
      title: 'Excel y CSV',
      desc: 'Subís planillas .xlsx, .xls o el CSV que exporta Tiendanube.',
    },
    {
      icon: '🏷️',
      title: 'SKU y código de barras',
      desc: 'Reconoce las columnas de identificadores para no duplicar productos.',
    },
    {
      icon: '💲',
      title: 'Precios y stock',
      desc: 'Toma precio y cantidades del archivo y los carga en cada producto.',
    },
    {
      icon: '🧭',
      title: 'Varias categorías',
      desc: 'Si el archivo trae hojas o categorías separadas, las combina en una sola importación.',
    },
    {
      icon: '🔁',
      title: 'Reimportá sin duplicar',
      desc: 'Un archivo nuevo actualiza los productos existentes en vez de repetirlos.',
    },
    {
      icon: '🔎',
      title: 'Previsualización',
      desc: 'Antes de confirmar ves qué columnas se detectaron y qué productos se van a cargar.',
    },
  ],
  comparisonTitle: 'Cargar productos a mano vs. importar el catálogo',
  comparisonIntro:
    'Con cientos de productos, la diferencia entre tipear y subir un archivo no es de horas: es de días.',
  comparison: [
    {
      label: 'Carga inicial',
      excel: 'Un producto por fila, a mano',
      vynko: 'Subís el archivo y se cargan todos',
    },
    {
      label: 'Códigos de barras',
      excel: 'Los tipeás uno por uno',
      vynko: 'Se leen de la columna del archivo',
    },
    {
      label: 'Precios',
      excel: 'Copiados de la planilla',
      vynko: 'Se toman del archivo, sin errores',
    },
    {
      label: 'Fotos y descripciones',
      excel: 'Cargás una por una',
      vynko: 'Se importan si el archivo las trae',
    },
    {
      label: 'Reimportar cuando cambia el catálogo',
      excel: 'Volver a cargar todo',
      vynko: 'Actualiza los productos que ya tenías',
    },
    {
      label: 'Productos duplicados',
      excel: 'No los detectás',
      vynko: 'Se comparan por SKU y código de barras',
    },
  ],
  roiTitle: '¿Cuánto tiempo te lleva cargar productos a mano?',
  roiIntro:
    'Con 200 productos a dos minutos cada uno, la carga manual son casi siete horas. Movés los números y ves cuánto te cuesta esperar.',
  audienceTitle: '¿Para quién es esta importación?',
  audienceIntro: 'Si ya tenés tu catálogo en una de estas plataformas, te ahorra la carga manual.',
  audience: [
    'Comercios que venden en Mercado Libre',
    'Tiendas que usan Tiendanube',
    'Negocios que migran desde una planilla exportada',
    'Catálogos con cientos de productos',
    'Quienes quieren evitar tipear códigos de barras',
    'Equipos que necesitan arrancar el mismo día',
  ],
  pricingTitle: 'Planes para importar tu catálogo',
  pricingIntro:
    'Elegí el plan que te sirve hoy. La importación viene incluida en todos: no hace falta contratar nada para empezar.',
  faqTitle: 'Preguntas frecuentes',
  faq: [
    {
      q: '¿Vynko se conecta automáticamente con Mercado Libre o Tiendanube?',
      a: 'No. Vynko no se conecta ni sincroniza por API con esas plataformas: importás el archivo (Excel o CSV) que exportás desde ellas. Si tu catálogo cambia, volvés a importar el archivo actualizado.',
    },
    {
      q: '¿Qué formato de archivo acepta?',
      a: 'Planillas Excel (.xlsx, .xls) y CSV. El CSV es el que exporta Tiendanube, así que podés subirlo tal cual.',
    },
    {
      q: '¿Reconoce las columnas de Mercado Libre y Tiendanube?',
      a: 'Sí. La importación entiende los encabezados que usan esas plataformas (título, categorías, imágenes, código de barras) y también los de tu propia planilla.',
    },
    {
      q: '¿Se duplican los productos si importo dos veces?',
      a: 'No. Vynko compara por SKU y código de barras: si el producto ya existe, lo actualiza en lugar de crear uno nuevo.',
    },
    {
      q: '¿Pierdo las imágenes y descripciones?',
      a: 'Las columnas de imagen y descripción se importan cuando el archivo las trae.',
    },
  ],
  related: [
    {
      slug: 'control-de-stock',
      title: 'Control de stock',
      desc: 'Sabé cuántas unidades tenés en cada depósito, con avisos antes de quedarte sin stock.',
    },
    {
      slug: 'alternativa-a-excel',
      title: 'Alternativa a Excel',
      desc: 'Dejá la planilla: un sistema que se actualiza solo y no depende de fórmulas.',
    },
    {
      slug: 'ventas-y-caja',
      title: 'Ventas y caja',
      desc: 'Cobrá escaneando el código de barras y cerrá el día con el arqueo ya hecho.',
    },
  ],
  guaranteeTitle: 'Probá Vynko sin riesgo',
  guaranteeIntro:
    'Empezá hoy y decidí después. Para arrancar no te pedimos nada.',
  finalCtaTitle: 'Traé tu catálogo en minutos',
  finalCtaText: 'Exportá tus productos de Mercado Libre o Tiendanube, subí el archivo y empezá a gestionar el stock en Vynko.',
};

export const metadata: Metadata = buildSeoMetadata(content);

export default function ImportarProductosPage() {
  return <SeoLandingPage content={content} />;
}
