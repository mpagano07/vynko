import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';

vi.mock('@/lib/supabaseAdmin', async () => {
  const mod = await import('@/test/supabase-mock');
  return { supabaseAdmin: mod.supabaseMock };
});

const getAuthMock = vi.fn();
vi.mock('@/lib/api-auth', () => ({ getAuth: (...a: unknown[]) => getAuthMock(...(a as [])) }));

// Los parametros van declarados porque el test inspecciona `mock.calls`, y
// sin firma la llamada se tipa como `[]` (sin argumentos). La firma se toma
// prestada del modulo real para que el mock no se desincronice de la API.
type TrackEventParams = Parameters<typeof import('@/lib/track-event')['trackEvent']>[0];
type TrackAppReturnParams = Parameters<typeof import('@/lib/track-event')['trackAppReturn']>[0];

const trackEventMock = vi.fn<(p: TrackEventParams) => Promise<void>>(async () => {});
const trackAppReturnMock = vi.fn<(p: TrackAppReturnParams) => Promise<void>>(async () => {});
vi.mock('@/lib/track-event', () => ({
  trackEvent: (p: TrackEventParams) => trackEventMock(p),
  trackAppReturn: (p: TrackAppReturnParams) => trackAppReturnMock(p),
}));

import { POST } from '@/app/api/analytics/track/route';

function request(body: unknown) {
  return new Request('http://localhost/api/analytics/track', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  supabaseMock.__reset();
  getAuthMock.mockResolvedValue({ tenantId: 'tenant-1', userId: 'user-1' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/analytics/track', () => {
  it('exige sesion', async () => {
    getAuthMock.mockResolvedValue(null);

    const res = await POST(request({ type: 'whatsapp_ticket' }));

    expect(res.status).toBe(401);
    expect(trackEventMock).not.toHaveBeenCalled();
  });

  it('rechaza un event_type que no esta en la lista', async () => {
    // La lista esta escrita en el server a proposito. Si aceptara cualquiera,
    // un tenant podria fabricar subscription_started con un curl y el embudo
    // dejaria de significar algo.
    const res = await POST(request({ type: 'subscription_started' }));

    expect(res.status).toBe(400);
    expect(trackEventMock).not.toHaveBeenCalled();
  });

  it('rechaza un body que no es JSON', async () => {
    const res = await POST(
      new Request('http://localhost/api/analytics/track', { method: 'POST', body: 'no json' })
    );

    expect(res.status).toBe(400);
  });

  it('graba el clic de WhatsApp con el user de la sesion', async () => {
    const res = await POST(request({ type: 'whatsapp_ticket', metadata: { saleId: 's1' } }));

    expect(res.status).toBe(200);
    expect(trackEventMock).toHaveBeenCalledWith({
      type: 'whatsapp_ticket',
      userId: 'user-1',
      tenantId: 'tenant-1',
      metadata: { saleId: 's1' },
    });
  });

  it('ignora un userId que venga en el body', async () => {
    // El userId sale de la sesion, nunca del body: si se aceptara del body,
    // se podria atribuir un evento a otro usuario.
    await POST(request({ type: 'whatsapp_ticket', userId: 'user-otro' }));

    expect(trackEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' })
    );
  });

  it('descarta metadata con tipos que no son primitivos', async () => {
    await POST(
      request({
        type: 'whatsapp_ticket',
        metadata: { ok: 'sí', anidado: { a: 1 }, lista: [1, 2], ok2: true, n: 5 },
      })
    );

    expect(trackEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { ok: 'sí', ok2: true, n: 5 } })
    );
  });

  it('trunca los strings largos del metadata', async () => {
    await POST(
      request({ type: 'whatsapp_ticket', metadata: { largo: 'x'.repeat(5000) } })
    );

    const { metadata } = trackEventMock.mock.calls[0]?.[0] as { metadata: Record<string, string> };
    expect(metadata.largo).toHaveLength(200);
  });

  it('app_return pasa por trackAppReturn, no por trackEvent', async () => {
    // app_return tiene su propio corte de 24 horas adentro; mandarlo por
    // trackEvent saltaria ese control.
    await POST(request({ type: 'app_return' }));

    expect(trackAppReturnMock).toHaveBeenCalledWith({
      userId: 'user-1',
      tenantId: 'tenant-1',
    });
    expect(trackEventMock).not.toHaveBeenCalled();
  });
});
