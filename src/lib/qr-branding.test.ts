import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const QR_DATA_URL = 'data:image/png;base64,qr';
const COMPOSED_DATA_URL = 'data:image/png;base64,composed';

function makeQrLib(overrides: Record<string, unknown> = {}) {
  return {
    toDataURL: vi.fn().mockResolvedValue(QR_DATA_URL),
    ...overrides,
  } as unknown as typeof import('qrcode');
}

function makeCanvas() {
  const ctx = {
    fillStyle: '',
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    arc: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    clip: vi.fn(),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => COMPOSED_DATA_URL),
  };
  return { ctx, canvas };
}

function stubCanvas(canvas: ReturnType<typeof makeCanvas>['canvas']) {
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'canvas') return canvas as unknown as HTMLElement;
    return originalCreateElement(tag);
  }) as typeof document.createElement);
  vi.stubGlobal('CanvasRenderingContext2D', class {});
}

function stubImages(mode: 'load' | 'error') {
  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => (mode === 'load' ? this.onload?.() : this.onerror?.()));
      }
    },
  );
}

async function loadHelper() {
  vi.resetModules();
  return import('./qr-branding');
}

describe('qr con logo de Vynko', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('codifica con corrección de errores alta y devuelve el QR pelado sin canvas', async () => {
    const { generateBrandedQrDataUrl } = await loadHelper();
    const lib = makeQrLib();

    const result = await generateBrandedQrDataUrl(lib, '779001');

    expect(result).toBe(QR_DATA_URL);
    expect(lib.toDataURL).toHaveBeenCalledWith(
      '779001',
      expect.objectContaining({ errorCorrectionLevel: 'H' }),
    );
  });

  it('dibuja los módulos como puntos y estiliza los tres ojos', async () => {
    const { generateBrandedQrDataUrl } = await loadHelper();
    const { ctx, canvas } = makeCanvas();
    stubCanvas(canvas);
    stubImages('load');

    const modules = {
      size: 21,
      get: vi.fn(() => 1),
    };
    const lib = makeQrLib({ create: vi.fn(() => ({ modules })) });

    const result = await generateBrandedQrDataUrl(lib, '779001');

    expect(result).toBe(COMPOSED_DATA_URL);
    expect(lib.create).toHaveBeenCalledWith('779001', { errorCorrectionLevel: 'H' });
    // 21x21 módulos menos los 3 ojos de 7x7 = 294 puntos.
    expect(ctx.arc).toHaveBeenCalledTimes(294);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 360, 360);
    // 1 fill de puntos + 3 capas x 3 ojos + 1 placa del logo.
    expect(ctx.fill).toHaveBeenCalledTimes(11);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it('compone el logo sobre el PNG clásico cuando no hay `create`', async () => {
    const { generateBrandedQrDataUrl } = await loadHelper();
    const { ctx, canvas } = makeCanvas();
    stubCanvas(canvas);
    stubImages('load');

    const result = await generateBrandedQrDataUrl(makeQrLib(), '779001');

    expect(result).toBe(COMPOSED_DATA_URL);
    expect(canvas.width).toBe(360);
    expect(canvas.height).toBe(360);
    // Una capa para el QR y otra para el logo.
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
    // El logo va sobre una placa blanca redondeada.
    expect(ctx.fill).toHaveBeenCalledTimes(1);
  });

  it('devuelve null si el contenido no se puede codificar', async () => {
    const { generateBrandedQrDataUrl } = await loadHelper();
    const lib = makeQrLib({ toDataURL: vi.fn().mockRejectedValue(new Error('too long')) });

    await expect(generateBrandedQrDataUrl(lib, 'x')).resolves.toBeNull();
  });

  it('cae al QR pelado si las imágenes no cargan', async () => {
    const { generateBrandedQrDataUrl } = await loadHelper();
    const { ctx, canvas } = makeCanvas();
    stubCanvas(canvas);
    stubImages('error');

    const result = await generateBrandedQrDataUrl(makeQrLib(), '779001');

    expect(result).toBe(QR_DATA_URL);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});
