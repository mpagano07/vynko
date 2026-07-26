import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { GoogleGenerativeAI } from '@google/generative-ai';

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

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GOOGLE_AI_API_KEY') {
    return NextResponse.json({ error: 'API de IA no configurada. Configurá GOOGLE_AI_API_KEY en .env.local' }, { status: 503 });
  }

  const { imageUrl } = await request.json();
  if (!imageUrl) {
    return NextResponse.json({ error: 'URL de imagen requerida' }, { status: 400 });
  }

  const imageData = await fetchImageAsBase64(imageUrl);
  if (!imageData) {
    return NextResponse.json({ error: 'No se pudo descargar la imagen' }, { status: 400 });
  }

  const [productsData, stockData, categoriesData] = await Promise.all([
    supabaseAdmin.from('products').select('id, name, sku, price_cents, cost'),
    supabaseAdmin.from('product_stock').select('product_id, stock, min_stock').eq('tenant_id', auth.tenantId),
    supabaseAdmin.from('categories').select('id, name'),
  ]);

  const stockMap = new Map((stockData.data || []).map((s: any) => [s.product_id, s]));
  const productsWithStock = (productsData.data || []).map((p: any) => {
    const s = stockMap.get(p.id) || { stock: 0, min_stock: 0 };
    return { ...p, stock: s.stock, min_stock: s.min_stock };
  });

  const productNames = productsWithStock.map((p: any) => p.name).join(', ');
  const categoryNames = (categoriesData.data || []).map((c: any) => c.name).join(', ');

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

    const matched: any[] = [];
    if (parsed.estimatedStock && productsWithStock.length) {
      for (const est of parsed.estimatedStock) {
        const actual = productsWithStock.find(
          (p) => p.name.toLowerCase().includes(est.productName.toLowerCase()) ||
                 est.productName.toLowerCase().includes(p.name.toLowerCase())
        );
        matched.push({
          ...est,
          actualProduct: actual ? { name: actual.name, stock: actual.stock, minStock: actual.min_stock } : null,
          matchFound: !!actual,
        });
      }
    }

    return NextResponse.json({
      analysis: parsed,
      matchedProducts: matched,
      productCount: productsWithStock.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al analizar imagen';
    console.error('Gemini Vision error:', msg);
    return NextResponse.json({ error: 'Error al analizar la imagen con IA' }, { status: 500 });
  }
}
