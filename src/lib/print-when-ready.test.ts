import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printWhenReady } from './print-when-ready';

describe('printWhenReady', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('imprime enseguida si el nodo ya está montado', async () => {
    document.body.innerHTML = '<div id="receipt-print-area"></div>';
    const print = vi.fn();

    const ready = await printWhenReady('receipt-print-area', { print });

    expect(ready).toBe(true);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('espera a que el nodo aparezca antes de imprimir', async () => {
    // Es el caso real: setLastSale dispara el render y window.print() no puede
    // correr antes de que React monte el ticket, o la vista previa sale vacía.
    const print = vi.fn();
    const done = printWhenReady('receipt-print-area', {
      print,
      timeoutMs: 1000,
      intervalMs: 10,
    });

    await vi.advanceTimersByTimeAsync(50);
    expect(print).not.toHaveBeenCalled();

    document.body.innerHTML = '<div id="receipt-print-area"></div>';
    await vi.advanceTimersByTimeAsync(10);

    await expect(done).resolves.toBe(true);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('imprime igual al vencer el plazo para no dejar al usuario sin diálogo', async () => {
    const print = vi.fn();
    const done = printWhenReady('receipt-print-area', {
      print,
      timeoutMs: 100,
      intervalMs: 10,
    });

    await vi.advanceTimersByTimeAsync(150);

    await expect(done).resolves.toBe(false);
    expect(print).toHaveBeenCalledTimes(1);
  });
});
