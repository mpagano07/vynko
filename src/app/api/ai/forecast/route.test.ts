import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
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

vi.mock('@/lib/api-auth', () => ({
  getAuth: vi.fn(async () => mockAuth),
}));

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: supabaseMock,
}));

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: rateLimitMock,
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(function () {
    return {
      getGenerativeModel: function () {
        return {
          generateContent: async () => ({
            response: { text: () => 'Análisis de prueba' },
          }),
        };
      },
    };
  }),
}));

const originalApiKey = process.env.GOOGLE_AI_API_KEY;

function makeRequest(): Request {
  return new Request('http://localhost/api/ai/forecast', { method: 'GET' });
}

function saleItem(productId: string, quantity: number, day: string) {
  return {
    product_id: productId,
    quantity,
    sales: { tenant_id: 'tenant-1', created_at: `2026-08-${day}T12:00:00.000Z` },
  };
}

function queueForecastData() {
  supabaseMock.__queue('product_stock', {
    data: [
      { product_id: 'p1', stock: 3, min_stock: 0, max_stock: 30 },
      { product_id: 'p2', stock: 2, min_stock: 5, max_stock: 20 },
      { product_id: 'p3', stock: 5, min_stock: 0, max_stock: 10 },
    ],
  });
  supabaseMock.__queue('products', {
    data: [
      { id: 'p1', name: 'Top', price_cents: 10000, cost: 90, category_id: null },
      { id: 'p2', name: 'Lento', price_cents: 5000, cost: 40, category_id: null },
      { id: 'p3', name: 'Micro', price_cents: 2000, cost: 10, category_id: null },
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

describe('GET /api/ai/forecast', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
    rateLimitMock.mockReturnValue({ ok: true, retryAfterSeconds: 0 });
    process.env.GOOGLE_AI_API_KEY = 'test-key';
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.GOOGLE_AI_API_KEY;
    else process.env.GOOGLE_AI_API_KEY = originalApiKey;
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

  it('calcula métricas y tendencias y agrega el análisis IA', async () => {
    queueForecastData();
    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json.summary.totalSales30).toBe(100);
    expect(json.summary.totalTransactions30).toBe(5);
    expect(json.trends.totalSales).toBe(25);
    expect(json.trends.productsWithSales).toBe(100); // 2 ahora vs 0 en el período anterior
    expect(json.aiAnalysis).toBe('Análisis de prueba');
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
      data: [{ product_id: 'p1', stock: 1, min_stock: 0, max_stock: 30 }],
    });
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Top', price_cents: 10000, cost: 90, category_id: null }],
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
});