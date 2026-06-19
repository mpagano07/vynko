import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createServerSupabaseClient } from '@/lib/supabase';
import OpenAI from 'openai';

async function getAuth() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id);
  if (!tu || tu.length === 0) return null;
  return { userId: user.id, tenantId: tu[0].tenant_id as string };
}

export async function GET() {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [productsData, saleItemsData, salesData] = await Promise.all([
    supabaseAdmin.from('products').select('id, name, stock, min_stock, max_stock, price_cents, cost, category_id').eq('tenant_id', auth.tenantId),
    supabaseAdmin.from('sale_items').select(`
      product_id, quantity,
      sale!inner(tenant_id, created_at)
    `).eq('sale.tenant_id', auth.tenantId).gte('sale.created_at', thirtyDaysAgo.toISOString()),
    supabaseAdmin.from('sales').select('created_at, total_cents').eq('tenant_id', auth.tenantId).gte('created_at', thirtyDaysAgo.toISOString()),
  ]);

  const productMap = new Map((productsData.data || []).map((p: any) => [p.id, p]));
  const dailySales = new Map<string, { totalQty: number; daysWithSales: Set<string> }>();

  for (const item of (saleItemsData.data || []) as any[]) {
    const day = item.sale?.created_at?.slice(0, 10);
    if (!day) continue;
    if (!dailySales.has(item.product_id)) {
      dailySales.set(item.product_id, { totalQty: 0, daysWithSales: new Set() });
    }
    const entry = dailySales.get(item.product_id)!;
    entry.totalQty += item.quantity || 0;
    entry.daysWithSales.add(day);
  }

  const totalSales30 = (salesData.data || []).reduce((sum: number, s: any) => sum + ((s.total_cents || 0) / 100), 0);
  const totalTransactions = (salesData.data || []).length;

  const predictions = Array.from(dailySales.entries())
    .map(([productId, stats]) => {
      const product = productMap.get(productId) as any;
      if (!product) return null;
      const daysActive = Math.max(stats.daysWithSales.size, 1);
      const avgDaily = stats.totalQty / 30;
      const projectedMonthly = Math.round(avgDaily * 30);
      const stock = product.stock ?? 0;
      const daysUntilStockout = avgDaily > 0 ? Math.round(stock / avgDaily) : Infinity;
      const minStock = product.min_stock ?? 0;
      const needsReorder = stock <= projectedMonthly * 0.5 || stock <= minStock;

      return {
        productId: product.id,
        productName: product.name,
        currentStock: stock,
        minStock,
        maxStock: product.max_stock ?? 0,
        price: product.price_cents ? product.price_cents / 100 : 0,
        cost: product.cost || 0,
        avgDailySales: Math.round(avgDaily * 10) / 10,
        projectedMonthlyDemand: projectedMonthly,
        daysUntilStockout: daysUntilStockout === Infinity ? null : daysUntilStockout,
        needsReorder,
        suggestedOrder: needsReorder ? Math.max(projectedMonthly * 2 - stock, projectedMonthly) : 0,
        totalSoldLast30: stats.totalQty,
        activeDays: stats.daysWithSales.size,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => (b.avgDailySales || 0) - (a.avgDailySales || 0));

  const topProducts = predictions.slice(0, 5) as any[];
  const needsReorder = predictions.filter((p: any) => p.needsReorder) as any[];

  let aiAnalysis = null;
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && apiKey !== 'YOUR_OPENAI_API_KEY') {
    try {
      const openai = new OpenAI({ apiKey });
      const prompt = `Analizá estos datos de demanda de productos para un negocio:

Productos con más demanda (top 5):
${topProducts.map((p: any) => `- ${p.productName}: ${p.avgDailySales}/día, ${p.projectedMonthlyDemand}/mes proyectado, stock actual: ${p.currentStock}`).join('\n')}

Productos que necesitan reposición:
${needsReorder.map((p: any) => `- ${p.productName}: stock ${p.currentStock}, venta diaria ${p.avgDailySales}, sugerido: ${p.suggestedOrder}`).join('\n')}

Ventas totales últimos 30 días: $${totalSales30.toFixed(2)} (${totalTransactions} transacciones)

Dame un análisis breve (3-4 oraciones) en español destacando tendencias y recomendaciones.`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
      });
      aiAnalysis = completion.choices[0]?.message?.content;
    } catch (e) {
      console.error('AI forecast analysis error:', e);
    }
  }

  return NextResponse.json({
    predictions,
    topProducts,
    needsReorder,
    summary: {
      totalProducts: productsData.data?.length || 0,
      productsWithSales: predictions.length,
      totalSales30,
      totalTransactions30: totalTransactions,
      needsReorderCount: needsReorder.length,
    },
    aiAnalysis,
  });
}
