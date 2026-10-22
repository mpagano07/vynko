import type { Metadata } from 'next';
import SeoLandingPage from '@/components/marketing/SeoLandingPage';
import { buildSeoMetadata, type SeoLandingContent } from '@/lib/marketing/seo-landing';

export const content: SeoLandingContent = {
  slug: 'control-de-compras',
  metaTitle: 'Control de compras y proveedores para tu negocio',
  metaDescription:
    'Cómo registrar compras, ventas y stock en un solo lugar: armá pedidos al proveedor, generá el remito de ingreso y el stock se actualiza solo. Probá Vynko gratis.',
  keywords: [
    'control de compras',
    'sistema de compras para comercios',
    'registrar compras de proveedores',
    'control de proveedores',
    'pedidos de compra',
    'remito de ingreso stock',
  ],
  badge: 'Control de compras',
  h1: 'Registrá compras, ventas y stock en un solo lugar',
  intro:
    'La mercadería que comprás, la que vendés y la que tenés guardada deberían contar la misma historia. Vynko registra el pedido al proveedor, genera el remito de ingreso y suma el stock sin que tengas que cargarlo a mano.',
  problemsTitle: 'Lo que pasa cuando las compras se anotan aparte',
  problemsIntro:
    'Cuando la compra se anota en un cuaderno o en un mensaje, el stock deja de coincidir con lo que hay en el depósito.',
  problems: [
    {
      problem: 'Anotás lo que compraste en un cuaderno o en un chat, y después no lo encontrás.',
      solution:
        'Cada compra queda registrada en el sistema, con el proveedor, los productos y el monto, y se puede buscar cuando la necesitás.',
    },
    {
      problem: 'El stock del depósito no coincide con lo que dice la planilla.',
      solution:
        'Al recibir la mercadería generás el remito de ingreso y el stock se suma solo, con el detalle de qué entró.',
    },
    {
      problem: 'No sabés cuánto le compraste a cada proveedor ni qué te falta pedirle.',
      solution:
        'Cada proveedor tiene su historial de pedidos y de montos, así que sabés exactamente qué compraste y cuándo.',
    },
    {
      problem: 'Te enterás de que algo falta recién cuando un cliente lo pide.',
      solution:
        'El stock mínimo de cada producto y las alertas te avisan antes, y el pedido de compra sale listo.',
    },
  ],
  howToTitle: 'Cómo registrar compras y actualizar el stock',
  howToIntro:
    'El circuito de compra en Vynko tiene cuatro pasos. Cuando la mercadería entra al depósito, el stock queda correcto sin una segunda carga.',
  howTo: [
    {
      title: 'Elegí el proveedor y armá el pedido',
      desc: 'Cargás los productos que necesitás, con la cantidad. El pedido queda con su fecha esperada de entrega.',
    },
    {
      title: 'Registrá la recepción',
      desc: 'Cuando llega la mercadería, generás el remito de ingreso. Si llega parcialmente, cargás lo que llegó realmente.',
    },
    {
      title: 'El stock se suma solo',
      desc: 'Cada producto del remito suma sus unidades al inventario, con costo y fecha. No hay que corregir la planilla a mano.',
    },
    {
      title: 'Mirá cuánto compraste y a quién',
      desc: 'El historial de compras por proveedor y por período te dice cuánto gastaste y qué mercadería falta reponer.',
    },
  ],
  featuresTitle: 'Funcionalidades de compras y proveedores',
  featuresIntro: 'Todo el circuito de la compra, desde el pedido hasta el ingreso al depósito.',
  features: [
    {
      icon: '🧾',
      title: 'Pedidos de compra',
      desc: 'Armás el pedido con los productos y la fecha esperada de entrega, y lo seguís hasta que llega.',
    },
    {
      icon: '📥',
      title: 'Remito de ingreso',
      desc: 'Al recibir la mercadería generás el remito: el stock, el costo y el proveedor quedan actualizados.',
    },
    {
      icon: '🚚',
      title: 'Ingreso parcial',
      desc: 'Si el proveedor entrega menos de lo pedido, registrás lo que llegó y el faltante sigue pendiente.',
    },
    {
      icon: '🏷️',
      title: 'Precio de compra por producto',
      desc: 'Cada producto guarda su último costo, así que el margen se calcula con datos reales y no con Supuestos.',
    },
    {
      icon: '📊',
      title: 'Historial por proveedor',
      desc: 'Cuánto compraste, qué productos y en qué período, con los números listos para comparar.',
    },
    {
      icon: '🔗',
      title: 'Compras, ventas y stock juntos',
      desc: 'La compra entra al mismo sistema que la venta: un solo número para el inventario y un solo lugar para buscar.',
    },
  ],
  comparisonTitle: 'Anotar compras a mano vs. un sistema de compras',
  comparisonIntro:
    'Anotar la compra es fácil. Lo difícil es que ese número coincida después con lo que hay en el depósito.',
  comparison: [
    {
      label: 'Registro de la compra',
      excel: 'Cuaderno, WhatsApp o una hoja suelta',
      vynko: 'Pedido y remito dentro del sistema',
    },
    {
      label: 'Actualización del stock',
      excel: 'A mano, después, si te acordás',
      vynko: 'Al generar el remito de ingreso',
    },
    {
      label: 'Ingreso parcial',
      excel: 'No se registra o se anota aparte',
      vynko: 'Cargás lo que llegó y el faltante queda pendiente',
    },
    {
      label: 'Costo de cada producto',
      excel: 'El último precio que te acuerdas',
      vynko: 'El costo real del último ingreso',
    },
    {
      label: 'Historial con un proveedor',
      excel: 'Hay que buscar en recibos sueltos',
      vynko: 'Todo lo que le compraste, ordenado',
    },
    {
      label: 'Vender y comprar en el mismo lugar',
      excel: 'Venta en un lado, compra en otro',
      vynko: 'Ventas, compras y stock en el mismo número',
    },
  ],
  roiTitle: '¿Cuánto cuesta no controlar las compras?',
  roiIntro:
    'Una mercadería que entra sin registrarse es plata que no vuelve a tu caja y stock que nadie sabe que tenés. Movés los números y lo ves.',
  audienceTitle: '¿Para quién es el control de compras?',
  audienceIntro:
    'Para comercios que reciben mercadería de forma regular y necesitan saber qué entró y cuánto se gastó.',
  audience: [
    'Almacenes y autoservicios que reponen seguido',
    'Distribuidoras y mayoristas chicos',
    'Tiendas de ropa y calzado con proveedores fijos',
    'Ferreterías y corralones',
    'Comercios con depósito y más de un proveedor',
    'Negocios que hoy anotan las compras en un cuaderno',
  ],
  pricingTitle: 'Planes para controlar las compras',
  pricingIntro:
    'Elegí el plan que te sirve hoy. Si más adelante necesitás sucursales o más usuarios, cambiás sin perder tus datos.',
  faqTitle: 'Preguntas frecuentes sobre control de compras',
  faq: [
    {
      q: '¿Tengo que cargar el stock a mano cuando llega la mercadería?',
      a: 'No. Al generar el remito de ingreso, el stock de cada producto se suma solo con la cantidad y el costo que cargaste.',
    },
    {
      q: '¿Qué pasa si el proveedor me entrega menos de lo que pedí?',
      a: 'Registrás el ingreso parcial: entra lo que llegó y el resto queda pendiente. El stock refleja lo que realmente está en el depósito.',
    },
    {
      q: '¿Puedo ver cuánto le compré a un proveedor?',
      a: 'Sí. Cada proveedor tiene su historial de pedidos, con los productos, las cantidades y los montos, listo para comparar períodos.',
    },
    {
      q: '¿Las compras y las ventas están conectadas?',
      a: 'Sí. Es el mismo sistema: la compra suma stock y costo, la venta descuenta stock y deja margen. El inventario es un solo número.',
    },
    {
      q: '¿Sirve si todavía no formalizo la compra?',
      a: 'Podés cargar el pedido como una compra pendiente y completarlo cuando llega. El stock solo se modifica cuando registrás el ingreso.',
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
      slug: 'alternativa-a-excel',
      title: 'Alternativa a Excel',
      desc: 'Dejá la planilla: un sistema que se actualiza solo y no depende de fórmulas.',
    },
  ],
  guaranteeTitle: 'Probá Vynko sin riesgo',
  guaranteeIntro:
    'Empezá hoy y decidí después. Para arrancar no te pedimos nada.',
  finalCtaTitle: 'Empezá a registrar tus compras',
  finalCtaText: 'Probá Vynko gratis y uní las compras, las ventas y el stock en un solo lugar.',
};

export const metadata: Metadata = buildSeoMetadata(content);

export default function ControlDeComprasPage() {
  return <SeoLandingPage content={content} />;
}
