import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { supabaseMock } from '@/test/supabase-mock';
import { GET } from './route';

const mockAuth = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  allTenants: false,
  tenantIds: ['tenant-1'],
};

const rateLimitMock = vi.hoisted(() => vi.fn());
const guardKillMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-auth', () => ({
  getAuth: vi.fn(async () => mockAuth),
}));

vi.mock('@/lib/kill-switch', () => ({ guardKill: guardKillMock }));

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: supabaseMock,
}));

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: rateLimitMock,
}));

function makeRequest(): Request {
  return new Request('http://localhost/api/forecast', { method: 'GET' });
}

function saleItem(productId: string, quantity: number, day: string) {
  return {
    product_id: productId,
    quantity,
    sales: { tenant_id: 'tenant-1', created_at: `2026-08-${day}T12:00:00.000Z` },
  };
}

function product(id: string, name: string, priceCents: number, cost: number) {
  return { id, name, price_cents: priceCents, cost, category_id: null };
}

function stockRow(
  productId: string,
  stock: number,
  minStock: number,
  maxStock: number,
  embeddedProduct: ReturnType<typeof product>
) {
  return { product_id: productId, stock, min_stock: minStock, max_stock: maxStock, products: embeddedProduct };
}

function queueForecastData() {
  supabaseMock.__queue('product_stock', {
    data: [
      stockRow('p1', 3, 0, 30, product('p1', 'Top', 10000, 90)),
      stockRow('p2', 2, 5, 20, product('p2', 'Lento', 5000, 40)),
      stockRow('p3', 5, 0, 10, product('p3', 'Micro', 2000, 10)),
    ],
  });
  supabaseMock.__queue('sale_items', {
    data: [
      saleItem('p1', 2, '01'),
      saleItem('p1', 3, '02'),
      saleItem('p1', 5, '03'),
      saleItem('p3', 1, '01'),
    ],
  });
  supabaseMock.__queue('sales_daily_totals', {
    data: [{ total: 10000, sale_count: 5 }],
  });
  supabaseMock.__queue('sale_items', { data: [] });
  supabaseMock.__queue('sales_daily_totals', {
    data: [{ total: 8000, sale_count: 3 }],
  });
}

describe('GET /api/forecast', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
    rateLimitMock.mockReturnValue({ ok: true, retryAfterSeconds: 0 });
    guardKillMock.mockResolvedValue(null);
  });

  it('devuelve 503 cuando el kill switch de pronóstico está activo', async () => {
    guardKillMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'KILL_SWITCH_FORECAST' }), { status: 503 })
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(503);
    expect(guardKillMock).toHaveBeenCalledWith('forecast');
    expect(supabaseMock.__calls).toHaveLength(0);
  });

  it('devuelve 401 sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('devuelve 429 cuando se alcanza el límite de consultas', async () => {
    rateLimitMock.mockReturnValueOnce({ ok: false, retryAfterSeconds: 5 });
    const res = await GET(makeRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('5');
  });

  it('incluye TODOS los productos activos, incluso sin ventas, con campos en cero', async () => {
    queueForecastData();
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.predictions).toHaveLength(3);

    const lento = json.predictions.find((p: { productId: string }) => p.productId === 'p2');
    expect(lento).toMatchObject({
      totalSoldLast30: 0,
      activeDays: 0,
      avgDailySales: 0,
      projectedMonthlyDemand: 0,
      daysUntilStockout: null,
      needsReorder: false,
      suggestedOrder: 0,
      suggestedOrder15: 0,
    });

    expect(json.summary.totalProducts).toBe(3);
    expect(json.summary.productsWithSales).toBe(2);
  });

  it('un producto sin ventas NO entra en reposición aunque esté bajo el mínimo', async () => {
    queueForecastData();
    const res = await GET(makeRequest());
    const json = await res.json();

    const lento = json.predictions.find((p: { productId: string }) => p.productId === 'p2');
    expect(lento.minStock).toBe(5);
    expect(lento.currentStock).toBe(2);
    expect(lento.needsReorder).toBe(false);

    expect(json.needsReorder.map((p: { productId: string }) => p.productId)).not.toContain('p2');
  });

  it('excluye los productos sin ventas del top 5', async () => {
    queueForecastData();
    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json.topProducts).toHaveLength(2);
    expect(json.topProducts.map((p: { productId: string }) => p.productId)).toEqual(['p1', 'p3']);
  });

  it('la cobertura se calcula desde la demanda diaria redondeada mostrada', async () => {
    queueForecastData();
    const res = await GET(makeRequest());
    const json = await res.json();

    const byId = (id: string) =>
      json.predictions.find((p: { productId: string }) => p.productId === id);

    // p1: 10 u/30d -> 0.3/día mostrado; stock 3 -> 3/0.3 = 10 días
    expect(byId('p1').avgDailySales).toBe(0.3);
    expect(byId('p1').daysUntilStockout).toBe(10);

    // p3: 1 u/30d -> 0.1 redondea a 0; la cobertura también pasa a nulo
    // (antes mostraba 0 de demanda pero 150d de cobertura, contradictorio)
    expect(byId('p3').avgDailySales).toBe(0);
    expect(byId('p3').totalSoldLast30).toBe(1);
    expect(byId('p3').daysUntilStockout).toBeNull();
  });

  it('calcula métricas y tendencias', async () => {
    queueForecastData();
    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json.summary.totalSales30).toBe(100);
    expect(json.summary.totalTransactions30).toBe(5);
    expect(json.trends.totalSales).toBe(25);
    expect(json.trends.productsWithSales).toBe(100); // 2 ahora vs 0 en el período anterior
  });

  it('exponen los KPIs de acción (sugerencia 15 días, quiebre, capital inmovilizado, efectividad)', async () => {
    queueForecastData();
    const res = await GET(makeRequest());
    const json = await res.json();

    const byId = (id: string) =>
      json.predictions.find((p: { productId: string }) => p.productId === id);

    // p1: demanda 10u/30d = 0.333/día; sugerido 15 días = ceil(5) - stock 3 = 2
    expect(byId('p1').suggestedOrder15).toBe(2);
    // p2 y p3: sin ventas o stock suficiente -> 0
    expect(byId('p2').suggestedOrder15).toBe(0);
    expect(byId('p3').suggestedOrder15).toBe(0);

    // Sugerencia de compra = Σ sugerido15 * costo = 2 * 90 = 180
    expect(json.summary.purchaseSuggestion15).toBe(180);

    // Cobertura p1 = 10 días (> 7), p2/p3 sin quiebre -> riesgo 0
    expect(json.summary.stockoutRiskCount).toBe(0);

    // Capital inmovilizado: p2 (sin ventas) = 2 u * 40 = 80
    expect(json.summary.deadStockCount).toBe(1);
    expect(json.summary.immobilizedCapital).toBe(80);

    // Efectividad del stock: 2 / 3 con ventas = 67%
    expect(json.summary.stockEffectivenessPct).toBe(67);

    // Próximo a agotarse: solo p1 tiene cobertura finita (10 días)
    expect(json.upcomingStockout).toHaveLength(1);
    expect(json.upcomingStockout[0]).toMatchObject({
      productId: 'p1',
      productName: 'Top',
      currentStock: 3,
      daysUntilStockout: 10,
    });
  });

  it('cuenta en riesgo de quiebre los productos que se agotan en <= 7 días', async () => {
    supabaseMock.__queue('product_stock', {
      data: [stockRow('p1', 1, 0, 30, product('p1', 'Top', 10000, 90))],
    });
    supabaseMock.__queue('sale_items', {
      data: [
        saleItem('p1', 5, '01'),
        saleItem('p1', 5, '02'),
        saleItem('p1', 5, '03'),
        saleItem('p1', 5, '04'),
        saleItem('p1', 5, '05'),
      ],
    });
    supabaseMock.__queue('sales_daily_totals', {
      data: [{ total: 10000, sale_count: 5 }],
    });
    supabaseMock.__queue('sale_items', { data: [] });
    supabaseMock.__queue('sales_daily_totals', {
      data: [{ total: 8000, sale_count: 3 }],
    });

    const res = await GET(makeRequest());
    const json = await res.json();

    // p1: 25u/30d = 0.83/día; stock 1 -> 1/0.8 = 1 día -> en riesgo
    expect(json.predictions[0].daysUntilStockout).toBe(1);
    expect(json.summary.stockoutRiskCount).toBe(1);
    expect(json.upcomingStockout).toHaveLength(1);
  });

  it('excluye de "Próximo a agotarse" productos con cobertura mayor a 15 días', async () => {
    supabaseMock.__queue('product_stock', {
      data: [stockRow('p1', 50, 0, 200, product('p1', 'Amplio', 10000, 90))],
    });
    supabaseMock.__queue('sale_items', {
      data: [saleItem('p1', 2, '01')],
    });
    supabaseMock.__queue('sales_daily_totals', {
      data: [{ total: 10000, sale_count: 1 }],
    });
    supabaseMock.__queue('sale_items', { data: [] });
    supabaseMock.__queue('sales_daily_totals', {
      data: [{ total: 8000, sale_count: 3 }],
    });

    const res = await GET(makeRequest());
    const json = await res.json();

    // p1: 2u/30d = 0.1/día (mostrado); stock 50 -> cobertura ~500 días -> excluido
    expect(json.predictions[0].daysUntilStockout).toBe(500);
    expect(json.upcomingStockout).toHaveLength(0);
  });

  it('pagina el catálogo y no arma un .in() gigante con todos los productos', async () => {
    // Regresión: con ~650 productos el `.in('id', [...])` superaba el límite
    // de URL de PostgREST (~25 KB) y la consulta volvía 400. El pronóstico
    // quedaba vacío como si no hubiera ventas.
    const pageOne = Array.from({ length: 1000 }, (_, i) =>
      stockRow(`p-${i}`, 1, 0, 10, product(`p-${i}`, `Producto ${i}`, 1000, 10))
    );
    const pageTwo = [stockRow('p-1000', 1, 0, 10, product('p-1000', 'Producto 1000', 1000, 10))];
    supabaseMock.__queue('product_stock', { data: pageOne }, { data: pageTwo });
    supabaseMock.__queue('sale_items', { data: [] });
    supabaseMock.__queue('sales_daily_totals', { data: [] });
    supabaseMock.__queue('sale_items', { data: [] });
    supabaseMock.__queue('sales_daily_totals', { data: [] });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.summary.totalProducts).toBe(1001);
    expect(json.predictions).toHaveLength(1001);

    const rangeCalls = supabaseMock.__calls
      .filter((call) => call.table === 'product_stock' && call.method === 'range')
      .map((call) => call.args);
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);

    // El producto global viaja embebido en product_stock: no se consulta
    // `products` por separado ni se filtra con `.in('id', [...])`.
    expect(supabaseMock.__calls.filter((call) => call.table === 'products')).toHaveLength(0);
    expect(supabaseMock.__calls.filter((call) => call.method === 'in')).toHaveLength(0);
  });
});