import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';

vi.mock('@/lib/supabaseAdmin', async () => {
  const mod = await import('@/test/supabase-mock');
  return { supabaseAdmin: mod.supabaseMock };
});

import { getAdminAnalytics } from '@/lib/analytics-service';

function funnelRows(rows: [number, string, number, number][]) {
  return rows.map(([step, event_type, users, ordered_users]) => ({
    step,
    event_type,
    users,
    ordered_users,
  }));
}

beforeEach(() => {
  supabaseMock.__reset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getAdminAnalytics', () => {
  it('calcula el embudo encadenado con la caida de cada paso', async () => {
    // 100 -> 80 -> 65 -> 40 -> 25 -> 8, el ejemplo del analisis original.
    supabaseMock.__queue('analytics_funnel', {
      data: funnelRows([
        [1, 'signup', 100, 100],
        [2, 'company_created', 80, 80],
        [3, 'product_created', 70, 65],
        [4, 'first_sale', 40, 40],
        [5, 'app_return', 25, 25],
        [6, 'subscription_started', 8, 8],
      ]),
      error: null,
    });
    supabaseMock.__queue('analytics_event_totals', { data: [], error: null });

    const result = await getAdminAnalytics();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.funnel.map((s) => s.users)).toEqual([100, 80, 65, 40, 25, 8]);
    expect(result.data.funnel[0].ofTotal).toBe(100);
    expect(result.data.funnel[1].ofTotal).toBe(80);
    expect(result.data.funnel[5].ofPrevious).toBe(32); // 8 de 25
    expect(result.data.funnel[1].dropped).toBe(20);
    expect(result.data.funnel[0].dropped).toBe(0);
  });

  it('usa ordered_users y no users', async () => {
    // 70 personas cargaron productos, pero 5 lo hicieron ANTES de crear la
    // empresa (un reintento del alta). El embudo tiene que contar 65: si
    // contara 70, el paso 3 seria mayor que el paso 2 y dejaria de ser un
    // embudo.
    supabaseMock.__queue('analytics_funnel', {
      data: funnelRows([
        [1, 'signup', 100, 100],
        [2, 'company_created', 80, 80],
        [3, 'product_created', 70, 65],
        [4, 'first_sale', 40, 40],
        [5, 'app_return', 25, 25],
        [6, 'subscription_started', 8, 8],
      ]),
      error: null,
    });
    supabaseMock.__queue('analytics_event_totals', { data: [], error: null });

    const result = await getAdminAnalytics();
    if (!result.ok) throw new Error('esperaba ok');

    expect(result.data.funnel[2].users).toBe(65);
  });

  it('reporta el paso que se cae en rojo aunque el anterior sea cero', async () => {
    supabaseMock.__queue('analytics_funnel', {
      data: funnelRows([
        [1, 'signup', 10, 10],
        [2, 'company_created', 0, 0],
        [3, 'product_created', 0, 0],
        [4, 'first_sale', 0, 0],
        [5, 'app_return', 0, 0],
        [6, 'subscription_started', 0, 0],
      ]),
      error: null,
    });
    supabaseMock.__queue('analytics_event_totals', { data: [], error: null });

    const result = await getAdminAnalytics();
    if (!result.ok) throw new Error('esperaba ok');

    // Dividir por un paso anterior de 0 daria NaN o Infinity en la UI.
    expect(result.data.funnel[1].ofPrevious).toBe(0);
    expect(result.data.funnel[1].dropped).toBe(10);
    expect(result.data.funnel[1].ofTotal).toBe(0);
  });

  it('cuelga el payment viejo del subscription_started', async () => {
    // Las filas historicas se grabaron como 'payment'. Si no se mapearan, el
    // panel mostraria "suscripciones: 0" al lado de la lista de eventos con
    // pagos, y pareceria que la migracion perdio los datos.
    supabaseMock.__queue('analytics_funnel', { data: [], error: null });
    supabaseMock.__queue('analytics_event_totals', {
      data: [
        { event_type: 'payment', users: 4, total: 9, first_at: '2026-01-01T00:00:00Z', last_at: '2026-03-01T00:00:00Z' },
        { event_type: 'subscription_started', users: 2, total: 2, first_at: '2026-04-01T00:00:00Z', last_at: '2026-04-02T00:00:00Z' },
      ],
      error: null,
    });

    const result = await getAdminAnalytics();
    if (!result.ok) throw new Error('esperaba ok');

    expect(result.data.breakdown).toHaveLength(1);
    const item = result.data.breakdown[0];
    expect(item.eventType).toBe('subscription_started');
    expect(item.users).toBe(6);
    expect(item.firstAt).toBe('2026-01-01T00:00:00Z');
    expect(item.lastAt).toBe('2026-04-02T00:00:00Z');
  });

  it('avisa con 503 en vez de devolver un embudo en cero si falta la vista', async () => {
    // Sin esto, un deploy antes de aplicar la migracion muestra un panel
    // vacío y parece que no hay usuarios.
    supabaseMock.__queue('analytics_funnel', {
      data: null,
      error: { message: 'relation "public.analytics_funnel" does not exist' },
    });

    const result = await getAdminAnalytics();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingView).toBe('analytics_funnel');
    expect(result.error).toContain('migracion 040');
  });

  it('deja el embudo vacio sin romper cuando no hay datos todavia', async () => {
    supabaseMock.__queue('analytics_funnel', { data: [], error: null });
    supabaseMock.__queue('analytics_event_totals', { data: [], error: null });

    const result = await getAdminAnalytics();
    if (!result.ok) throw new Error('esperaba ok');

    // 6 pasos en cero, no un array vacio: el panel tiene que poder pintar la
    // estructura del embudo aunque no haya ni un evento.
    expect(result.data.funnel).toHaveLength(6);
    expect(result.data.funnel.every((s) => s.users === 0)).toBe(true);
  });
});
