import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleAfterBackground } from './after-background';

const mockAfter = vi.fn();
vi.mock('next/server', () => ({
  after: (cb: () => unknown) => mockAfter(cb),
}));

describe('scheduleAfterBackground', () => {
  beforeEach(() => {
    mockAfter.mockReset();
  });

  it('defers the work to after() so it does not block the response', () => {
    const task = vi.fn(async () => {});
    scheduleAfterBackground(task);
    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(task).not.toHaveBeenCalled();
  });

  it('runs the task when the scheduled callback executes', async () => {
    const task = vi.fn(async () => {});
    scheduleAfterBackground(task);
    const [callback] = mockAfter.mock.calls[0] as [() => Promise<void>];
    await callback();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('swallows errors thrown by the task once scheduled', async () => {
    // Si el error escapara, el work de fondo se reportaria como fallo del
    // request aunque la respuesta ya se habia enviado.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const task = vi.fn(async () => {
      throw new Error('la bitacora fallo');
    });
    scheduleAfterBackground(task);
    const [callback] = mockAfter.mock.calls[0] as [() => Promise<void>];

    await expect(callback()).resolves.toBeUndefined();
    expect(task).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('falls back to running detached outside a request context', async () => {
    // Fuera de un request (tests, scripts) `after` no existe. El trabajo igual
    // se ejecuta, pero nadie espera por el.
    mockAfter.mockImplementation(() => {
      throw new Error('after() called outside a request scope');
    });
    const task = vi.fn(async () => {});

    expect(() => scheduleAfterBackground(task)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('does not create an unhandled rejection when detached work fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockAfter.mockImplementation(() => {
      throw new Error('sin contexto');
    });
    const task = vi.fn(async () => {
      throw new Error('la bitacora fallo');
    });

    expect(() => scheduleAfterBackground(task)).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    expect(task).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('accepts a synchronous task', async () => {
    const task = vi.fn(() => {
      throw new Error('sincrono fallo');
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockAfter.mockImplementation(() => {
      throw new Error('sin contexto');
    });

    expect(() => scheduleAfterBackground(task)).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    expect(task).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});