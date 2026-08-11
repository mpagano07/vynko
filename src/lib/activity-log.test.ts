import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createActivityLog } from './activity-log';
import { supabaseMock } from '@/test/supabase-mock';

vi.mock('@/lib/supabaseAdmin', async () => {
  const mod = await import('@/test/supabase-mock');
  return { supabaseAdmin: mod.supabaseMock };
});

describe('activity-log', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inserts log with all correct data and provided userName', async () => {
    supabaseMock.__queue('activity_logs', { data: null, error: null });

    await createActivityLog({
      tenantId: 'tenant-1',
      userId: 'user-1',
      userName: 'Matias',
      action: 'created',
      entityType: 'product',
      entityId: 'prod-1',
      details: { name: 'Coca Cola' },
    });

    const insertCall = supabaseMock.__calls.find(
      (c) => c.table === 'activity_logs' && c.method === 'insert'
    );

    expect(insertCall).toBeDefined();
    expect(insertCall?.args[0]).toEqual({
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      user_name: 'Matias',
      action: 'created',
      entity_type: 'product',
      entity_id: 'prod-1',
      details: { name: 'Coca Cola' },
    });
  });

  it('resolves userName from profiles when not provided', async () => {
    supabaseMock.__queue('profiles', { data: { full_name: 'Usuario Prueba' } });
    supabaseMock.__queue('activity_logs', { data: null, error: null });

    await createActivityLog({
      tenantId: 'tenant-1',
      userId: 'user-2',
      action: 'deleted',
      entityType: 'customer',
    });

    const profileQuery = supabaseMock.__calls.find(
      (c) => c.table === 'profiles' && c.method === 'eq'
    );
    expect(profileQuery).toBeDefined();
    expect(profileQuery?.args[0]).toBe('id');
    expect(profileQuery?.args[1]).toBe('user-2');

    const insertCall = supabaseMock.__calls.find(
      (c) => c.table === 'activity_logs' && c.method === 'insert'
    );
    expect(insertCall?.args[0]).toMatchObject({
      user_name: 'Usuario Prueba',
      entity_id: null,
      details: {},
    });
  });

  it('defaults to "Usuario" if profile is not found', async () => {
    supabaseMock.__queue('profiles', { data: null, error: { message: 'Not found' } });
    supabaseMock.__queue('activity_logs', { data: null, error: null });

    await createActivityLog({
      tenantId: 'tenant-1',
      userId: 'user-3',
      action: 'updated',
      entityType: 'settings',
    });

    const insertCall = supabaseMock.__calls.find(
      (c) => c.table === 'activity_logs' && c.method === 'insert'
    );
    const insertArgs = insertCall?.args[0] as { user_name: string } | undefined;
    expect(insertArgs?.user_name).toBe('Usuario');
  });

  it('logs error to console when insert fails', async () => {
    supabaseMock.__queue('activity_logs', { data: null, error: { message: 'DB Error' } });

    await createActivityLog({
      tenantId: 'tenant-1',
      userId: 'user-1',
      userName: 'Matias',
      action: 'created',
      entityType: 'product',
    });

    expect(console.error).toHaveBeenCalledWith(
      'Error creating activity log:',
      { message: 'DB Error' }
    );
  });
});
