import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const secret = process.env.CRON_SECRET || process.env.INTERNAL_CRON_SECRET;
    if (!secret || token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // Purge old activity logs (>90 days)
    const { error: actErr, count: actCount } = await supabaseAdmin
      .from('activity_logs')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff);
    if (actErr) {
      logger.error('purge activity_logs failed', { error: actErr.message });
      return NextResponse.json({ error: 'Failed to purge activity_logs' }, { status: 500 });
    }

    // Purge old stock transfers (>90 days) - items cascade
    const { error: trErr, count: trCount } = await supabaseAdmin
      .from('stock_transfers')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff);
    if (trErr) {
      logger.error('purge stock_transfers failed', { error: trErr.message });
      return NextResponse.json({ error: 'Failed to purge stock_transfers' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      cutoff,
      deleted: {
        activity_logs: actCount ?? 0,
        stock_transfers: trCount ?? 0,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error';
    logger.error('purge-old-records error', { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
