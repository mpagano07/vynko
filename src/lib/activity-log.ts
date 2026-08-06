import { supabaseAdmin } from './supabaseAdmin';

export async function createActivityLog(params: {
  tenantId: string;
  userId: string;
  userName?: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, unknown>;
}) {
  const name = params.userName || await resolveUserName(params.userId);
  const { error } = await supabaseAdmin
    .from('activity_logs')
    .insert({
      tenant_id: params.tenantId,
      user_id: params.userId,
      user_name: name,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId || null,
      details: params.details || {},
    });

  if (error) console.error('Error creating activity log:', error);
}

async function resolveUserName(userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .single();
  return data?.full_name || 'Usuario';
}
