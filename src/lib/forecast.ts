import { supabaseAdmin } from '@/lib/supabaseAdmin';

export interface ForecastPrediction {
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
  suggestedOrder15: number;
  totalSoldLast30: number;
  activeDays: number;
}

export interface ForecastUpcomingStockout {
  productId: string;
  productName: string;
  currentStock: number;
  daysUntilStockout: number | null;
}

export interface ForecastSummary {
  totalProducts: number;
  productsWithSales: number;
  totalSales30: number;
  totalTransactions30: number;
  needsReorderCount: number;
  stockoutRiskCount: number;
  deadStockCount: number;
  immobilizedCapital: number;
  purchaseSuggestion15: number;
  stockEffectivenessPct: number | null;
}

export interface ForecastTrends {
  totalSales: number | null;
  transactions: number | null;
  productsWithSales: number | null;
  needsReorder: number | null;
}

export interface ForecastPayload {
  predictions: ForecastPrediction[];
  topProducts: ForecastPrediction[];
  needsReorder: ForecastPrediction[];
  upcomingStockout: ForecastUpcomingStockout[];
  summary: ForecastSummary;
  trends: ForecastTrends;
}

function trendPct(current: number, prior: number): number | null {
  if (prior === 0 && current === 0) return null;
  if (prior === 0) return 100;
  return Math.round(((current - prior) / prior) * 100);
}

export async function getForecast(tenantId: string): Promise<ForecastPayload> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);
  const sixtyDaysAgo = new Date(now);
  sixtyDaysAgo.setDate(now.getDate() - 60);

  const stockData = await supabaseAdmin
    .from('product_stock')
    .select('product_id, stock, min_stock, max_stock')
    .eq('tenant_id', tenantId)
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
    `).eq('sales.tenant_id', tenantId).gte('sales.created_at', thirtyDaysAgo.toISOString()),
    supabaseAdmin.from('sales_daily_totals').select('total, sale_count').eq('tenant_id', tenantId).gte('day', thirtyDaysAgo.toISOString().slice(0, 10)),
    supabaseAdmin.from('sale_items').select(`
      product_id, quantity,
      sales!inner(tenant_id, created_at)
    `).eq('sales.tenant_id', tenantId).gte('sales.created_at', sixtyDaysAgo.toISOString()).lt('sales.created_at', thirtyDaysAgo.toISOString()),
    supabaseAdmin.from('sales_daily_totals').select('total, sale_count')
      .eq('tenant_id', tenantId)
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

  const predictions: ForecastPrediction[] = Array.from(productMap.entries())
    .map(([productId, product]) => {
      const stats = dailySales.get(productId);
      const totalQty = stats?.totalQty ?? 0;
      const activeDaysCount = stats?.daysWithSales.size ?? 0;
      const avgDaily = totalQty / 30;
      const projectedMonthly = Math.round(avgDaily * 30);
      const avgDailySales = Math.round(avgDaily * 10) / 10;
      const stock = Number(product.stock) || 0;
      const daysUntilStockout = avgDailySales > 0 ? Math.round(stock / avgDailySales) : Infinity;
      const minStock = Number(product.min_stock) || 0;
      const needsReorder = totalQty > 0 && (stock <= projectedMonthly * 0.5 || stock <= minStock);
      const suggestedOrder15 = totalQty > 0 ? Math.max(Math.ceil(avgDaily * 15) - stock, 0) : 0;

      return {
        productId: String(product.id ?? ''),
        productName: String(product.name ?? ''),
        currentStock: stock,
        minStock,
        maxStock: Number(product.max_stock) || 0,
        price: product.price_cents ? Number(product.price_cents) / 100 : 0,
        cost: Number(product.cost) || 0,
        avgDailySales,
        projectedMonthlyDemand: projectedMonthly,
        daysUntilStockout: daysUntilStockout === Infinity ? null : daysUntilStockout,
        needsReorder,
        suggestedOrder: needsReorder ? Math.max(projectedMonthly * 2 - stock, projectedMonthly) : 0,
        suggestedOrder15,
        totalSoldLast30: totalQty,
        activeDays: activeDaysCount,
      };
    })
    .sort((a, b) => (b.avgDailySales || 0) - (a.avgDailySales || 0));

  const topProducts = predictions.filter((p) => p.totalSoldLast30 > 0).slice(0, 5);
  const needsReorder = predictions.filter((p) => p.needsReorder);

  const productsWithSales = predictions.filter((p) => p.totalSoldLast30 > 0).length;
  const stockoutRisk = predictions.filter((p) => p.daysUntilStockout !== null && p.daysUntilStockout <= 7);
  const deadStock = predictions.filter((p) => p.totalSoldLast30 === 0);
  const immobilizedCapital = deadStock.reduce((s, p) => s + p.currentStock * p.cost, 0);
  const purchaseSuggestion15 = predictions.reduce((s, p) => s + p.suggestedOrder15 * p.cost, 0);
  const stockEffectivenessPct =
    productIds.length > 0 ? Math.round((productsWithSales / productIds.length) * 100) : null;
  const upcomingStockout = predictions
    .filter((p) => p.daysUntilStockout !== null && p.daysUntilStockout > 0 && p.daysUntilStockout <= 15)
    .sort((a, b) => (a.daysUntilStockout ?? Infinity) - (b.daysUntilStockout ?? Infinity))
    .slice(0, 5)
    .map((p) => ({
      productId: p.productId,
      productName: p.productName,
      currentStock: p.currentStock,
      daysUntilStockout: p.daysUntilStockout,
    }));

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

  const priorNeedsReorderCount = Array.from(priorDailySales.entries()).filter(([productId, totalQty]) => {
    const product = productMap.get(productId);
    if (!product) return false;
    const avgDaily = totalQty / 30;
    const projectedMonthly = Math.round(avgDaily * 30);
    const stock = Number(product.stock) || 0;
    const minStock = Number(product.min_stock) || 0;
    return stock <= projectedMonthly * 0.5 || stock <= minStock;
  }).length;

  return {
    predictions,
    topProducts,
    needsReorder,
    upcomingStockout,
    summary: {
      totalProducts: productIds.length,
      productsWithSales,
      totalSales30,
      totalTransactions30: totalTransactions,
      needsReorderCount: needsReorder.length,
      stockoutRiskCount: stockoutRisk.length,
      deadStockCount: deadStock.length,
      immobilizedCapital,
      purchaseSuggestion15,
      stockEffectivenessPct,
    },
    trends: {
      totalSales: trendPct(totalSales30, priorTotalSales),
      transactions: trendPct(totalTransactions, priorTransactions),
      productsWithSales: trendPct(productsWithSales, priorProductsWithSales),
      needsReorder: trendPct(needsReorder.length, priorNeedsReorderCount),
    },
  };
}
