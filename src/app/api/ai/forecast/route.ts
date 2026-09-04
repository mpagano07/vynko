import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuth } from '@/lib/api-auth';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { formatARS } from '@/lib/utils/currency';
import { rateLimit } from '@/lib/rate-limit';
import { fixResponse } from '@/lib/utils/encoding';

interface Prediction {
  productId: string;
  productName: string;
  currentStock: number;
  minStock: number;
  maxStock: number;
  price: number;
  cost: number;
  avgDailySales: number;
  projectedMonthlyDemand: number;
  daysUntilStockout: number | null;
  needsReorder: boolean;
  suggestedOrder: number;
  totalSoldLast30: number;
  activeDays: number;
}

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const limit = rateLimit(`ai:forecast:${auth.tenantId}`, 30, 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Límite de consultas de pronóstico alcanzado. Esperá un momento.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);
  const sixtyDaysAgo = new Date(now);
  sixtyDaysAgo.setDate(now.getDate() - 60);

  const stockData = await supabaseAdmin
    .from('product_stock')
    .select('product_id, stock, min_stock, max_stock')
    .eq('tenant_id', auth.tenantId)
    .eq('active', true);

  const productIds = ((stockData.data as unknown[] | null) ?? []).map(
    (row) => (row as Record<string, unknown>).product_id as string
  );

  const [productsData, saleItemsData, salesData, priorSaleItemsData, priorSalesData] = await Promise.all([
    productIds.length > 0
      ? supabaseAdmin.from('products').select('id, name, price_cents, cost, category_id').in('id', productIds)
      : Promise.resolve({ data: [] }),
    supabaseAdmin.from('sale_items').select(`
      product_id, quantity,
      sales!inner(tenant_id, created_at)
    `).eq('sales.tenant_id', auth.tenantId).gte('sales.created_at', thirtyDaysAgo.toISOString()),
    supabaseAdmin.from('sales_daily_totals').select('total, sale_count').eq('tenant_id', auth.tenantId).gte('day', thirtyDaysAgo.toISOString().slice(0, 10)),
    supabaseAdmin.from('sale_items').select(`
      product_id, quantity,
      sales!inner(tenant_id, created_at)
    `).eq('sales.tenant_id', auth.tenantId).gte('sales.created_at', sixtyDaysAgo.toISOString()).lt('sales.created_at', thirtyDaysAgo.toISOString()),
    supabaseAdmin.from('sales_daily_totals').select('total, sale_count')
      .eq('tenant_id', auth.tenantId)
      .gte('day', sixtyDaysAgo.toISOString().slice(0, 10))
      .lt('day', thirtyDaysAgo.toISOString().slice(0, 10)),
  ]);

  const stockMap = new Map<string, Record<string, unknown>>(
    ((stockData.data as unknown[] | null) ?? []).map((row) => {
      const s = row as Record<string, unknown>;
      return [String(s.product_id), s];
    })
  );
  const productMap = new Map<string, Record<string, unknown>>(
    ((productsData.data as unknown[] | null) ?? []).map((row) => {
      const p = row as Record<string, unknown>;
      const s = stockMap.get(String(p.id)) || {};
      return [String(p.id), { ...p, stock: Number(s.stock) || 0, min_stock: Number(s.min_stock) || 0, max_stock: Number(s.max_stock) || 0 }];
    })
  );
  const dailySales = new Map<string, { totalQty: number; daysWithSales: Set<string> }>();

  for (const row of (saleItemsData.data as unknown[] | null) ?? []) {
    const item = row as Record<string, unknown>;
    const sales = (item.sales ?? null) as Record<string, unknown> | null;
    const day = typeof sales?.created_at === 'string' ? sales.created_at.slice(0, 10) : undefined;
    if (!day) continue;
    const productId = String(item.product_id ?? '');
    if (!dailySales.has(productId)) {
      dailySales.set(productId, { totalQty: 0, daysWithSales: new Set() });
    }
    const entry = dailySales.get(productId)!;
    entry.totalQty += Number(item.quantity) || 0;
    entry.daysWithSales.add(day);
  }

  const totalSales30 = ((salesData.data as unknown[] | null) ?? []).reduce((sum: number, row) => {
    const s = row as Record<string, unknown>;
    return sum + (Number(s.total) || 0);
  }, 0) / 100;
  const totalTransactions = ((salesData.data as unknown[] | null) ?? []).reduce((sum: number, row) => {
    const s = row as Record<string, unknown>;
    return sum + (Number(s.sale_count) || 0);
  }, 0);

  const predictions: Prediction[] = Array.from(dailySales.entries())
    .map(([productId, stats]) => {
      const product = productMap.get(productId);
      if (!product) return null;
      const avgDaily = stats.totalQty / 30;
      const projectedMonthly = Math.round(avgDaily * 30);
      const stock = Number(product.stock) || 0;
      const daysUntilStockout = avgDaily > 0 ? Math.round(stock / avgDaily) : Infinity;
      const minStock = Number(product.min_stock) || 0;
      const needsReorder = stock <= projectedMonthly * 0.5 || stock <= minStock;

      return {
        productId: String(product.id ?? ''),
        productName: String(product.name ?? ''),
        currentStock: stock,
        minStock,
        maxStock: Number(product.max_stock) || 0,
        price: product.price_cents ? Number(product.price_cents) / 100 : 0,
        cost: Number(product.cost) || 0,
        avgDailySales: Math.round(avgDaily * 10) / 10,
        projectedMonthlyDemand: projectedMonthly,
        daysUntilStockout: daysUntilStockout === Infinity ? null : daysUntilStockout,
        needsReorder,
        suggestedOrder: needsReorder ? Math.max(projectedMonthly * 2 - stock, projectedMonthly) : 0,
        totalSoldLast30: stats.totalQty,
        activeDays: stats.daysWithSales.size,
      };
    })
    .filter((p): p is Prediction => p !== null)
    .sort((a, b) => (b.avgDailySales || 0) - (a.avgDailySales || 0));

  const topProducts = predictions.slice(0, 5);
  const needsReorder = predictions.filter((p) => p.needsReorder);

  // Prior period (30-60 days ago) computation
  const priorDailySales = new Map<string, number>();
  for (const row of (priorSaleItemsData.data as unknown[] | null) ?? []) {
    const item = row as Record<string, unknown>;
    const pid = String(item.product_id ?? '');
    if (!pid) continue;
    priorDailySales.set(pid, (priorDailySales.get(pid) || 0) + (Number(item.quantity) || 0));
  }
  const priorTotalSales = ((priorSalesData.data as unknown[] | null) ?? []).reduce((sum: number, row) => {
    const s = row as Record<string, unknown>;
    return sum + (Number(s.total) || 0);
  }, 0) / 100;
  const priorTransactions = ((priorSalesData.data as unknown[] | null) ?? []).reduce((sum: number, row) => {
    const s = row as Record<string, unknown>;
    return sum + (Number(s.sale_count) || 0);
  }, 0);
  const priorProductsWithSales = priorDailySales.size;

  // Prior period reorder count (recompute with same logic)
  const priorNeedsReorderCount = Array.from(priorDailySales.entries()).filter(([productId, totalQty]) => {
    const product = productMap.get(productId);
    if (!product) return false;
    const avgDaily = totalQty / 30;
    const projectedMonthly = Math.round(avgDaily * 30);
    const stock = Number(product.stock) || 0;
    const minStock = Number(product.min_stock) || 0;
    return stock <= projectedMonthly * 0.5 || stock <= minStock;
  }).length;

  function trendPct(current: number, prior: number): number | null {
    if (prior === 0 && current === 0) return null;
    if (prior === 0) return 100;
    return Math.round(((current - prior) / prior) * 100);
  }

  let aiAnalysis = null;
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (apiKey && apiKey !== 'YOUR_GOOGLE_AI_API_KEY') {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const prompt = `Analizá estos datos de demanda de productos para un negocio:

Productos con más demanda (top 5):
${topProducts.map((p) => `- ${p.productName}: ${p.avgDailySales}/día, ${p.projectedMonthlyDemand}/mes proyectado, stock actual: ${p.currentStock}`).join('\n')}

Productos que necesitan reposición:
${needsReorder.map((p) => `- ${p.productName}: stock ${p.currentStock}, venta diaria ${p.avgDailySales}, sugerido: ${p.suggestedOrder}`).join('\n')}

Ventas totales últimos 30 días: ${formatARS(totalSales30)} (${totalTransactions} transacciones)

Dame un análisis breve (3-4 oraciones) en español destacando tendencias y recomendaciones.`;

      const result = await model.generateContent(prompt);
      aiAnalysis = result.response.text();
    } catch (e) {
      console.error('Gemini forecast analysis error:', e);
    }
  }

  return NextResponse.json(fixResponse({
    predictions,
    topProducts,
    needsReorder,
    summary: {
      totalProducts: productIds.length,
      productsWithSales: predictions.length,
      totalSales30,
      totalTransactions30: totalTransactions,
      needsReorderCount: needsReorder.length,
    },
    trends: {
      totalSales: trendPct(totalSales30, priorTotalSales),
      transactions: trendPct(totalTransactions, priorTransactions),
      productsWithSales: trendPct(predictions.length, priorProductsWithSales),
      needsReorder: trendPct(needsReorder.length, priorNeedsReorderCount),
    },
    aiAnalysis,
  }));
}
