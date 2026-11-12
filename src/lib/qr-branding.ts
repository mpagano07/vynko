import type { BitMatrix } from 'qrcode';

type QrModule = typeof import('qrcode');

/**
 * Los QR personalizados con logo necesitan corrección de errores alta (`H`,
 * ~30% recuperable): el logo tapa módulos y sin ese margen el código deja de
 * leerse. El margen blanco también ayuda al escáner.
 */
export const BRANDED_QR_OPTIONS = {
  width: 360,
  margin: 2,
  errorCorrectionLevel: 'H',
  color: { dark: '#1e1e2e', light: '#ffffff' },
} as const;

/** Logo cuadrado de la app: el wordmark no se lee en el centro de un QR. */
export const QR_LOGO_SRC = '/icons/icon-512.png';

const QR_SIZE = BRANDED_QR_OPTIONS.width;
const QR_DARK = BRANDED_QR_OPTIONS.color.dark;
const QR_MARGIN = BRANDED_QR_OPTIONS.margin;

/** El logo ocupa el 20% del ancho: dentro del ~30% recuperable por `H`. */
const LOGO_SIZE_RATIO = 0.2;
/** Aire blanco alrededor del logo para que no toque los módulos. */
const LOGO_PADDING_RATIO = 0.04;
const LOGO_RADIUS_RATIO = 0.18;

/** Cada módulo se dibuja como un punto: 92% del ancho de la celda. */
const DOT_RADIUS_RATIO = 0.46;
/** Los tres ojos del QR se dibujan como cuadrados redondeados. */
const FINDER_MODULES = 7;
const TWO_PI = Math.PI * 2;

let logoPromise: Promise<HTMLImageElement | null> | null = null;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/** El logo se carga una sola vez por sesión; si falla, se reintenta la próxima. */
function loadLogo(): Promise<HTMLImageElement | null> {
  if (typeof window === 'undefined' || typeof window.Image === 'undefined') {
    return Promise.resolve(null);
  }
  if (!logoPromise) {
    logoPromise = loadImage(QR_LOGO_SRC).then((image) => {
      if (!image) logoPromise = null;
      return image;
    });
  }
  return logoPromise;
}

/**
 * jsdom (tests) no implementa canvas: ahí devolvemos el QR pelado en lugar de
 * ensuciar la consola con el error de `getContext`.
 */
function isCanvasSupported(): boolean {
  return typeof document !== 'undefined' && typeof CanvasRenderingContext2D !== 'undefined';
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  radius: number,
) {
  const r = Math.min(radius, size / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + size - r, y);
  ctx.quadraticCurveTo(x + size, y, x + size, y + r);
  ctx.lineTo(x + size, y + size - r);
  ctx.quadraticCurveTo(x + size, y + size, x + size - r, y + size);
  ctx.lineTo(x + r, y + size);
  ctx.quadraticCurveTo(x, y + size, x, y + size - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function isFinderModule(row: number, col: number, count: number): boolean {
  return (
    (row < FINDER_MODULES && col < FINDER_MODULES) ||
    (row < FINDER_MODULES && col >= count - FINDER_MODULES) ||
    (row >= count - FINDER_MODULES && col < FINDER_MODULES)
  );
}

/** Ojo de búsqueda: marco redondeado, anillo blanco y centro redondeado. */
function drawFinderPattern(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) {
  const outer = cell * FINDER_MODULES;

  ctx.fillStyle = QR_DARK;
  roundedRectPath(ctx, x, y, outer, cell * 1.3);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  roundedRectPath(ctx, x + cell, y + cell, outer - cell * 2, cell * 0.9);
  ctx.fill();

  ctx.fillStyle = QR_DARK;
  roundedRectPath(ctx, x + cell * 2, y + cell * 2, outer - cell * 4, cell * 0.65);
  ctx.fill();
}

function drawModules(ctx: CanvasRenderingContext2D, modules: BitMatrix) {
  const count = modules.size;
  const cell = QR_SIZE / (count + QR_MARGIN * 2);
  const offset = QR_MARGIN * cell;
  const radius = cell * DOT_RADIUS_RATIO;

  // Todos los puntos en un único path: menos operaciones y bordes parejos.
  ctx.fillStyle = QR_DARK;
  ctx.beginPath();
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!modules.get(row, col)) continue;
      if (isFinderModule(row, col, count)) continue;
      const cx = offset + (col + 0.5) * cell;
      const cy = offset + (row + 0.5) * cell;
      ctx.moveTo(cx + radius, cy);
      ctx.arc(cx, cy, radius, 0, TWO_PI);
    }
  }
  ctx.fill();

  drawFinderPattern(ctx, offset, offset, cell);
  drawFinderPattern(ctx, offset + (count - FINDER_MODULES) * cell, offset, cell);
  drawFinderPattern(ctx, offset, offset + (count - FINDER_MODULES) * cell, cell);
}

/** Logo centrado sobre una placa blanca redondeada. */
function drawLogo(ctx: CanvasRenderingContext2D, logo: HTMLImageElement) {
  const size = QR_SIZE;
  const logoSize = Math.round(size * LOGO_SIZE_RATIO);
  const padding = Math.round(size * LOGO_PADDING_RATIO);
  const plateSize = logoSize + padding * 2;
  const platePos = (size - plateSize) / 2;

  ctx.fillStyle = '#ffffff';
  roundedRectPath(ctx, platePos, platePos, plateSize, Math.round(plateSize * LOGO_RADIUS_RATIO));
  ctx.fill();

  const logoPos = (size - logoSize) / 2;
  ctx.save();
  roundedRectPath(ctx, logoPos, logoPos, logoSize, Math.round(logoSize * LOGO_RADIUS_RATIO));
  ctx.clip();
  ctx.drawImage(logo, logoPos, logoPos, logoSize, logoSize);
  ctx.restore();
}

async function renderStyledQr(modules: BitMatrix): Promise<string | null> {
  const canvas = document.createElement('canvas');
  canvas.width = QR_SIZE;
  canvas.height = QR_SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = BRANDED_QR_OPTIONS.color.light;
  ctx.fillRect(0, 0, QR_SIZE, QR_SIZE);
  drawModules(ctx, modules);

  const logo = await loadLogo();
  if (logo) drawLogo(ctx, logo);

  return canvas.toDataURL('image/png');
}

/**
 * Fallback para navegadores sin `create` (o tests): parte del PNG cuadrado de
 * `qrcode` y sólo le superpone el logo.
 */
async function composeLogo(qrDataUrl: string): Promise<string | null> {
  const canvas = document.createElement('canvas');
  canvas.width = QR_SIZE;
  canvas.height = QR_SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const [qrImage, logo] = await Promise.all([loadImage(qrDataUrl), loadLogo()]);
  if (!qrImage) return null;

  ctx.drawImage(qrImage, 0, 0, QR_SIZE, QR_SIZE);
  if (!logo) return canvas.toDataURL('image/png');

  drawLogo(ctx, logo);
  return canvas.toDataURL('image/png');
}

/**
 * Genera el data URL de un QR de producto con el logo de Vynko en el centro y
 * módulos redondeados. Devuelve `null` si el contenido no se puede codificar.
 */
export async function generateBrandedQrDataUrl(
  lib: QrModule,
  code: string,
): Promise<string | null> {
  const canCanvas = isCanvasSupported();

  if (canCanvas && typeof lib.create === 'function') {
    try {
      const qr = lib.create(code, { errorCorrectionLevel: BRANDED_QR_OPTIONS.errorCorrectionLevel });
      const dataUrl = await renderStyledQr(qr.modules);
      if (dataUrl) return dataUrl;
    } catch {
      // Cae al render clásico: nunca dejamos al usuario sin QR.
    }
  }

  let qrDataUrl: string;
  try {
    qrDataUrl = await lib.toDataURL(code, BRANDED_QR_OPTIONS);
  } catch {
    return null;
  }

  if (!canCanvas) return qrDataUrl;

  try {
    return (await composeLogo(qrDataUrl)) ?? qrDataUrl;
  } catch {
    // Canvas bloqueado, logo con CORS o `toDataURL` restringido: QR sin logo.
    return qrDataUrl;
  }
}
