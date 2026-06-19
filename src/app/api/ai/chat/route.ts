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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_OPENAI_API_KEY') {
    return NextResponse.json({ error: 'API de IA no configurada. Configurá OPENAI_API_KEY en .env.local' }, { status: 503 });
  }

  const { message } = await request.json();
  if (!message || typeof message !== 'string') {
    return NextResponse.json({ error: 'Mensaje requerido' }, { status: 400 });
  }

  const context = await getTenantContext(auth.tenantId);

  const openai = new OpenAI({ apiKey });

  const systemPrompt = `Sos un asistente de inteligencia artificial especializado en gestión de inventario y ventas para un negocio. 
Tus respuestas deben ser breves, claras y en español. Usá un tono profesional pero amigable.

Contexto actual del negocio:
- Total de productos: ${context.productCount}
- Categorías: ${context.categoryCount}
- Productos con stock crítico: ${context.lowStockCount}
- Ventas recientes (últimas 10): ${context.recentSales.map(s => `$${s.total.toFixed(2)}`).join(', ')}

Productos en inventario:
${context.products.slice(0, 30).map(p => `- ${p.name}: ${p.stock} unidades (mín: ${p.min_stock}, máx: ${p.max_stock}, precio: $${p.price.toFixed(2)}, costo: $${p.cost.toFixed(2)})`).join('\n')}

Podés ayudar con:
- Consultas sobre stock de productos específicos
- Recomendaciones de reposición
- Análisis de ventas
- Identificar productos con bajo rendimiento
- Sugerencias para optimizar inventario
- Responder preguntas sobre el negocio basado en los datos disponibles`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    const reply = completion.choices[0]?.message?.content || 'Lo siento, no pude procesar tu consulta.';
    return NextResponse.json({ reply });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al comunicarse con la IA';
    console.error('OpenAI error:', msg);
    return NextResponse.json({ error: 'Error al procesar la consulta con IA. Verificá tu clave de API.' }, { status: 500 });
  }
}
