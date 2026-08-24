import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { PLAN_LIMITS } from '@/lib/plans';
import type { PlanId } from '@/lib/plans';

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

export async function POST(request: Request) {
  try {
    const auth = await getAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const { name } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'El nombre de la sucursal es requerido' }, { status: 400 });
    }

    const tenantId = crypto.randomUUID();
    const tenantSlug = `${slugify(name) || 'sucursal'}-${crypto.randomUUID().slice(0, 8)}`;

    let inheritPlan = 'starter';
    let inheritStatus = 'free';
    let inheritPeriodEnd: string | null = null;
    if (auth.tenantIds.length > 0) {
      const { data: allUserTenants } = await supabaseAdmin
        .from('tenants')
        .select('subscription_plan, subscription_status, subscription_current_period_end')
        .in('id', auth.tenantIds);
      if (allUserTenants && allUserTenants.length > 0) {
        const planRank: Record<string, number> = { enterprise: 4, business: 3, starter: 2, free: 1 };
        const statusRank: Record<string, number> = { active: 5, incomplete: 4, past_due: 3, canceled: 2, free: 1 };
        let bestScore = 0;
        for (const t of allUserTenants) {
          const s = t.subscription_status || 'free';
          const p = t.subscription_plan || 'free';
          const score = (statusRank[s] || 0) + (planRank[p] || 0);
          if (score > bestScore) {
            bestScore = score;
            inheritPlan = p;
            inheritStatus = s;
            inheritPeriodEnd = t.subscription_current_period_end;
          }
        }
      }
    }

    const maxBranches = PLAN_LIMITS[inheritPlan as PlanId]?.branches ?? 1;
    if (auth.tenantIds.length >= maxBranches) {
      return NextResponse.json(
        { error: `Tu plan actual (${inheritPlan}) permite hasta ${maxBranches} sucursal${maxBranches !== 1 ? 'es' : ''}.` },
        { status: 403 }
      );
    }

    const insertData: Record<string, unknown> = {
      id: tenantId,
      name: name.trim(),
      slug: tenantSlug,
      subscription_plan: inheritPlan,
      subscription_status: inheritStatus,
    };
    if (inheritPeriodEnd) {
      insertData.subscription_current_period_end = inheritPeriodEnd;
    }

    const { error: tenantError } = await supabaseAdmin
      .from('tenants')
      .insert(insertData);

    if (tenantError) {
      { console.error('DB error:', tenantError); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 }); }
    }

    const { error: tenantUserError } = await supabaseAdmin
      .from('tenant_users')
      .insert({
        tenant_id: tenantId,
        user_id: auth.userId,
        role: 'owner',
      });

    if (tenantUserError) {
      { console.error('DB error:', tenantUserError); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 }); }
    }

    const { data: tenantData } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .single();

    return NextResponse.json({ tenant: tenantData });
  } catch (err) {
    console.error('Error creating tenant:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
