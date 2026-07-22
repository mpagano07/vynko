import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createServerSupabaseClient } from '@/lib/supabase';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { formatARS } from '@/lib/utils/currency';

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

async function getTenantContext(tenantId: string) {
  const [products, categories, recentSales] = await Promise.all([
    supabaseAdmin.from('products').select('name, stock, min_stock, max_stock, price_cents, cost').eq('tenant_id', tenantId),
    supabaseAdmin.from('categories').select('name').eq('tenant_id', tenantId),
    supabaseAdmin.from('sales').select('total_cents, created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(10),
  ]);

  const productList = (products.data || []).map((p: any) => ({
    name: p.name,
    stock: p.stock,
    min_stock: p.min_stock,
    max_stock: p.max_stock,
    price: p.price_cents ? p.price_cents / 100 : 0,
    cost: p.cost || 0,
  }));

  return {
    productCount: productList.length,
    products: productList,
    categoryCount: categories.data?.length || 0,
    recentSales: (recentSales.data || []).map((s: any) => ({
      total: s.total_cents ? s.total_cents / 100 : 0,
      date: s.created_at,
    })),
    lowStockCount: productList.filter((p: any) => (p.stock ?? 0) <= (p.min_stock ?? 0)).length,
  };
}

export async function POST(request: Request) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GOOGLE_AI_API_KEY') {
    return NextResponse.json({ error: 'API de IA no configurada. Configurá GOOGLE_AI_API_KEY en .env.local' }, { status: 503 });
  }

  const { message } = await request.json();
  if (!message || typeof message !== 'string') {
    return NextResponse.json({ error: 'Mensaje requerido' }, { status: 400 });
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
- Ventas recientes (últimas 10): ${context.recentSales.map(s => formatARS(s.total)).join(', ')}

Productos en inventario:
${context.products.slice(0, 30).map(p => `- ${p.name}: ${p.stock} unidades (mín: ${p.min_stock}, máx: ${p.max_stock}, precio: ${formatARS(p.price)}, costo: ${formatARS(p.cost)})`).join('\n')}

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
    return NextResponse.json({ reply });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    const stack = err instanceof Error ? err.stack : '';
    console.error('Gemini chat error:', msg);
    console.error('Stack:', stack);
    return NextResponse.json({ error: `Error: ${msg}` }, { status: 500 });
  }
}
