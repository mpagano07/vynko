import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { formatARS } from '@/lib/utils/currency';
import { rateLimit } from '@/lib/rate-limit';
import type { AuthInfo } from '@/lib/api-auth';

export type AiResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number; headers?: Record<string, string> };

async function getTenantContext(tenantId: string) {
  const stockData = await supabaseAdmin
    .from('product_stock')
    .select('product_id, stock, min_stock, max_stock')
    .eq('tenant_id', tenantId)
    .eq('active', true);

  const productIds = ((stockData.data as unknown[] | null) ?? []).map(
    (row) => (row as Record<string, unknown>).product_id as string
  );

  const [products, categories, recentSales] = await Promise.all([
    productIds.length > 0
      ? supabaseAdmin.from('products').select('id, name, price_cents, cost').in('id', productIds)
      : Promise.resolve({ data: [] }),
    supabaseAdmin.from('categories').select('name').eq('tenant_id', tenantId),
    supabaseAdmin.from('sales').select('total_cents, created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(10),
  ]);

  const stockMap = new Map<string, Record<string, unknown>>(
    ((stockData.data as unknown[] | null) ?? []).map((row) => {
      const s = row as Record<string, unknown>;
      return [String(s.product_id), s];
    })
  );

  const productList = ((products.data as unknown[] | null) ?? []).map((row) => {
    const p = row as Record<string, unknown>;
    const s = stockMap.get(String(p.id)) || {};
    return {
      name: String(p.name ?? ''),
      stock: Number(s.stock) || 0,
      min_stock: Number(s.min_stock) || 0,
      max_stock: Number(s.max_stock) || 0,
      price: p.price_cents ? Number(p.price_cents) / 100 : 0,
      cost: Number(p.cost) || 0,
    };
  });

  return {
    productCount: productList.length,
    products: productList,
    categoryCount: categories.data?.length || 0,
    recentSales: ((recentSales.data as unknown[] | null) ?? []).map((row) => {
      const s = row as Record<string, unknown>;
      return {
        total: s.total_cents ? Number(s.total_cents) / 100 : 0,
        date: String(s.created_at ?? ''),
      };
    }),
    lowStockCount: productList.filter((p) => (p.stock ?? 0) <= (p.min_stock ?? 0)).length,
  };
}

export async function sendChatQuery(auth: AuthInfo, message: string): Promise<AiResult> {
  const limit = rateLimit(`ai:chat:${auth.tenantId}`, 20, 60 * 1000);
  if (!limit.ok) {
    return {
      ok: false,
      error: 'Límite de consultas a la IA alcanzado. Por favor esperá un minuto.',
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfterSeconds) },
    };
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GOOGLE_AI_API_KEY') {
    return { ok: false, error: 'API de IA no configurada. Configurá GOOGLE_AI_API_KEY en .env.local', status: 503 };
  }

  if (!message || typeof message !== 'string') {
    return { ok: false, error: 'Mensaje requerido', status: 400 };
  }

  const context = await getTenantContext(auth.tenantId);

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `Sos un asistente de inteligencia artificial especializado en gestión de inventario y ventas para un negocio. 
Tus respuestas deben ser breves, claras y en español. Usá un tono profesional pero amigable.

Contexto actual del negocio:
- Total de productos: ${context.productCount}
- Categorías: ${context.categoryCount}
- Productos con stock crítico: ${context.lowStockCount}
- Ventas recientes (últimas 10): ${context.recentSales.map((s) => formatARS(s.total)).join(', ')}

Productos en inventario:
${context.products.slice(0, 30).map((p) => `- ${p.name}: ${p.stock} unidades (mín: ${p.min_stock}, máx: ${p.max_stock}, precio: ${formatARS(p.price)}, costo: ${formatARS(p.cost)})`).join('\n')}

Podés ayudar con:
- Consultas sobre stock de productos específicos
- Recomendaciones de reposición
- Análisis de ventas
- Identificar productos con bajo rendimiento
- Sugerencias para optimizar inventario
- Responder preguntas sobre el negocio basado en los datos disponibles

Consulta del usuario: ${message}`;

  try {
    const result = await model.generateContent(prompt);
    const reply = result.response.text() || 'Lo siento, no pude procesar tu consulta.';
    return { ok: true, data: { reply } };
  } catch (err: unknown) {
    console.error('Gemini chat error:', err);
    return { ok: false, error: 'No se pudo procesar la consulta con el asistente de IA.', status: 500 };
  }
}

async function fetchImageAsBase64(imageUrl: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const response = await fetch(imageUrl);
    const buffer = await response.arrayBuffer();
    const mimeType = response.headers.get('content-type') || 'image/jpeg';
    const base64 = Buffer.from(buffer).toString('base64');
    return { data: base64, mimeType };
  } catch {
    return null;
  }
}

export async function analyzeImage(auth: AuthInfo, imageUrl: string): Promise<AiResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GOOGLE_AI_API_KEY') {
    return { ok: false, error: 'API de IA no configurada. Configurá GOOGLE_AI_API_KEY en .env.local', status: 503 };
  }

  if (!imageUrl) {
    return { ok: false, error: 'URL de imagen requerida', status: 400 };
  }

  const imageData = await fetchImageAsBase64(imageUrl);
  if (!imageData) {
    return { ok: false, error: 'No se pudo descargar la imagen', status: 400 };
  }

  const [productsData, stockData, categoriesData] = await Promise.all([
    supabaseAdmin.from('products').select('id, name, sku, price_cents, cost'),
    supabaseAdmin.from('product_stock').select('product_id, stock, min_stock').eq('tenant_id', auth.tenantId).eq('active', true),
    supabaseAdmin.from('categories').select('id, name'),
  ]);

  const stockMap = new Map<string, Record<string, unknown>>(
    ((stockData.data as unknown[] | null) ?? []).map((row) => {
      const s = row as Record<string, unknown>;
      return [String(s.product_id), s];
    })
  );
  const productsWithStock: Array<{ name: string; stock: number; min_stock: number }> = ((productsData.data as unknown[] | null) ?? []).map((row) => {
    const p = row as Record<string, unknown>;
    const s = stockMap.get(String(p.id)) || {};
    return { name: String(p.name ?? ''), stock: Number(s.stock) || 0, min_stock: Number(s.min_stock) || 0 };
  });

  const productNames = productsWithStock.map((p) => String(p.name ?? '')).join(', ');
  const categoryNames = ((categoriesData.data as unknown[] | null) ?? []).map((c) => String((c as Record<string, unknown>).name ?? '')).join(', ');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `Analizá esta foto de una góndola o estante de un negocio.
Productos registrados en el sistema: ${productNames || 'No hay productos registrados'}.
Categorías: ${categoryNames || 'Sin categorías'}.

Respondé en español con este formato JSON (sin markdown):
{
  "description": "Descripción breve de lo que se ve en la imagen",
  "estimatedStock": [
    { "productName": "nombre del producto detectado", "estimatedQuantity": 5, "confidence": "alta/media/baja" }
  ],
  "observations": ["observación 1", "observación 2"],
  "suggestedActions": ["acción recomendada 1"]
}

Si no se ve una góndola o productos en la imagen, devolvé un JSON con description explicando qué se ve y estimatedStock vacío.`;

  try {
    const result = await model.generateContent([
      { text: prompt },
      { inlineData: { data: imageData.data, mimeType: imageData.mimeType } },
    ]);
    const reply = result.response.text() || '{}';

    let parsed;
    try {
      const cleaned = reply.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { description: reply, estimatedStock: [], observations: [], suggestedActions: [] };
    }

    const matched: Array<{
      productName: string;
      estimatedQuantity: number;
      confidence: string;
      actualProduct: { name: string; stock: number; minStock: number } | null;
      matchFound: boolean;
    }> = [];
    if (parsed.estimatedStock && productsWithStock.length) {
      for (const est of parsed.estimatedStock) {
        const actual = productsWithStock.find(
          (p) => {
            const name = String(p.name ?? '');
            return name.toLowerCase().includes(est.productName.toLowerCase()) ||
              est.productName.toLowerCase().includes(name.toLowerCase());
          }
        );
        matched.push({
          ...est,
          actualProduct: actual ? { name: String(actual.name ?? ''), stock: Number(actual.stock) || 0, minStock: Number(actual.min_stock) || 0 } : null,
          matchFound: !!actual,
        });
      }
    }

    return {
      ok: true,
      data: {
        analysis: parsed,
        matchedProducts: matched,
        productCount: productsWithStock.length,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al analizar imagen';
    console.error('Gemini Vision error:', msg);
    return { ok: false, error: 'Error al analizar la imagen con IA', status: 500 };
  }
}