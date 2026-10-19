import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockInitializePaddle } = vi.hoisted(() => ({ mockInitializePaddle: vi.fn() }));

vi.mock('@paddle/paddle-js', () => ({
  initializePaddle: mockInitializePaddle,
}));

// El módulo cachea la promesa de inicialización (singleton por carga de página),
// así que cada test reimporta una instancia limpia.
async function loadPaddleClient() {
  vi.resetModules();
  return import('./paddle-client');
}

describe('paddle-client', () => {
  beforeEach(() => {
    mockInitializePaddle.mockReset();
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_PADDLE_CLIENT_TOKEN', 'test_token');
    vi.stubEnv('NEXT_PUBLIC_PADDLE_ENV', 'sandbox');
  });

  it('sin client token no inicializa Paddle.js y devuelve null', async () => {
    vi.stubEnv('NEXT_PUBLIC_PADDLE_CLIENT_TOKEN', '');
    const { getPaddleClient } = await loadPaddleClient();

    await expect(getPaddleClient()).resolves.toBeNull();
    expect(mockInitializePaddle).not.toHaveBeenCalled();
  });

  it('inicializa Paddle.js con el token, el entorno y un successUrl absoluto', async () => {
    mockInitializePaddle.mockResolvedValue({ Initialized: true });
    const { getPaddleClient } = await loadPaddleClient();

    const paddle = await getPaddleClient();

    expect(paddle).not.toBeNull();
    expect(mockInitializePaddle).toHaveBeenCalledTimes(1);
    const options = mockInitializePaddle.mock.calls[0][0] as {
      token: string;
      environment: string;
      checkout: { settings: { successUrl: string } };
    };
    expect(options.token).toBe('test_token');
    expect(options.environment).toBe('sandbox');
    // Absoluto: Paddle descarta (o directamente tira) un successUrl relativo.
    expect(options.checkout.settings.successUrl).toBe(
      `${window.location.origin}/billing?success=true`
    );
  });

  it('reusa la inicialización en llamadas sucesivas (singleton)', async () => {
    mockInitializePaddle.mockResolvedValue({ Initialized: true });
    const { getPaddleClient } = await loadPaddleClient();

    await getPaddleClient();
    await getPaddleClient();

    expect(mockInitializePaddle).toHaveBeenCalledTimes(1);
  });

  it('abre el overlay para la transacción ya creada por el server', async () => {
    const open = vi.fn();
    mockInitializePaddle.mockResolvedValue({ Initialized: true, Checkout: { open } });
    const { openPaddleCheckout } = await loadPaddleClient();

    const opened = await openPaddleCheckout('txn_123');

    expect(opened).toBe(true);
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: 'txn_123',
        settings: expect.objectContaining({ variant: 'one-page' }),
      })
    );
  });

  it('devuelve false cuando Paddle.js no está disponible (cae al redirect)', async () => {
    vi.stubEnv('NEXT_PUBLIC_PADDLE_ENV', '');
    const { openPaddleCheckout } = await loadPaddleClient();

    await expect(openPaddleCheckout('txn_123')).resolves.toBe(false);
  });

  it('inicializa con pwCustomer (Retain) cuando hay un customer de Paddle', async () => {
    mockInitializePaddle.mockResolvedValue({ Initialized: true });
    const { getPaddleClient, setPaddleCustomer } = await loadPaddleClient();

    setPaddleCustomer('ctm_123');
    await getPaddleClient();

    expect(mockInitializePaddle).toHaveBeenCalledTimes(1);
    const options = mockInitializePaddle.mock.calls[0][0] as {
      pwCustomer?: { id?: string };
    };
    expect(options.pwCustomer).toEqual({ id: 'ctm_123' });
  });

  it('sin customer no manda pwCustomer', async () => {
    mockInitializePaddle.mockResolvedValue({ Initialized: true });
    const { getPaddleClient } = await loadPaddleClient();

    await getPaddleClient();

    const options = mockInitializePaddle.mock.calls[0][0] as {
      pwCustomer?: { id?: string };
    };
    expect(options.pwCustomer).toBeUndefined();
  });

  it('si el customer cambia después de inicializar, re-inicializa con el nuevo pwCustomer', async () => {
    mockInitializePaddle.mockResolvedValue({ Initialized: true });
    const { getPaddleClient, setPaddleCustomer } = await loadPaddleClient();

    await getPaddleClient();
    setPaddleCustomer('ctm_nuevo');
    await getPaddleClient();

    expect(mockInitializePaddle).toHaveBeenCalledTimes(2);
    const last = mockInitializePaddle.mock.calls[1][0] as {
      pwCustomer?: { id?: string };
    };
    expect(last.pwCustomer).toEqual({ id: 'ctm_nuevo' });
  });

  it('setPaddleCustomer con el mismo id no re-inicializa', async () => {
    mockInitializePaddle.mockResolvedValue({ Initialized: true });
    const { getPaddleClient, setPaddleCustomer } = await loadPaddleClient();

    setPaddleCustomer('ctm_123');
    await getPaddleClient();
    setPaddleCustomer('ctm_123');
    await getPaddleClient();

    expect(mockInitializePaddle).toHaveBeenCalledTimes(1);
  });
});
