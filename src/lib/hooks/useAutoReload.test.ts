import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAutoReload } from './useAutoReload';

const INTERVAL_MS = 60_000;

function versionResponse(version: string): Response {
  return new Response(JSON.stringify({ version }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('useAutoReload', () => {
  let reloadSpy: ReturnType<typeof vi.fn>;
  let locationSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    reloadSpy = vi.fn();
    locationSpy = vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      reload: reloadSpy,
    } as unknown as Location);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    locationSpy.mockRestore();
  });

  // Deja correr las promesas pendientes (el fetch inicial) dentro de act.
  const pump = () => act(async () => {});

  // Avanza el poller un intervalo y deja resolver el check completo.
  const tick = async (ms = INTERVAL_MS) => {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  };

  function stubFetch(impl: typeof fetch): void {
    vi.stubGlobal('fetch', vi.fn(impl));
  }

  it('no recarga si el fetch falla (pérdida de conexión transitoria)', async () => {
    stubFetch(() => {
      const called = vi.mocked(fetch).mock.calls.length;
      // El primer chequeo pierde la conexión; en el siguiente el servidor responde.
      return called === 1
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(versionResponse('v1'));
    });

    renderHook(() => useAutoReload());
    await pump();

    // El fallo de red se traga (no recarga) y el siguiente chequeo reintenta.
    expect(reloadSpy).not.toHaveBeenCalled();
    await tick();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('no recarga mientras la versión no cambia', async () => {
    stubFetch(async () => versionResponse('v1'));

    renderHook(() => useAutoReload());
    await pump();
    await tick();

    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('recarga cuando detecta una versión nueva en el chequeo siguiente', async () => {
    stubFetch(() => {
      const called = vi.mocked(fetch).mock.calls.length;
      return Promise.resolve(versionResponse(called === 1 ? 'v1' : 'v2'));
    });

    renderHook(() => useAutoReload());
    await pump();
    expect(reloadSpy).not.toHaveBeenCalled();

    await tick();

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});