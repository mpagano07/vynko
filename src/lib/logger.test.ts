import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { logger, setLogContextProvider } from './logger';
import { findLog, readLogs } from '@/test/log-output';

type Spies = { error: { mock: { calls: unknown[][] } }; warn: { mock: { calls: unknown[][] } }; log: { mock: { calls: unknown[][] } } };

describe('logger', () => {
  let spies: Spies;

  beforeEach(() => {
    spies = {
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    };
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    setLogContextProvider(undefined);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('emite una linea JSON con nivel, timestamp y mensaje', () => {
    logger.error('DB error', { error: new Error('boom') });

    const [record] = readLogs(spies.error);
    expect(record).toMatchObject({ level: 'error', msg: 'DB error' });
    expect(typeof record.time).toBe('string');
    const error = record.error as { message: string; stack: string };
    expect(error.message).toBe('boom');
    expect(error.stack).toContain('Error: boom');
  });

  it('saca el dos puntos del mensaje cuando el detalle va en un campo con nombre', () => {
    logger.warn('tenant_users check failed, failing open:', { error: 'boom' });

    const [record] = readLogs(spies.warn);
    expect(record.msg).toBe('tenant_users check failed, failing open');
    expect(record.error).toBe('boom');
  });

  it('conserva los campos de un error plano de Supabase', () => {
    logger.error('DB error', { error: { code: '23505', message: 'duplicate', hint: 'conflict' } });

    const [record] = readLogs(spies.error);
    expect(record.error).toMatchObject({ code: '23505', message: 'duplicate', hint: 'conflict' });
  });

  it('acepta un Error como unico argumento', () => {
    logger.error(new Error('solo el error'));

    const [record] = readLogs(spies.error);
    expect(record.msg).toBe('solo el error');
    expect((record.error as { message: string }).message).toBe('solo el error');
  });

  it('respeta LOG_LEVEL', () => {
    vi.stubEnv('LOG_LEVEL', 'warn');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(readLogs(spies.log)).toHaveLength(0);
    expect(readLogs(spies.warn).map((r) => r.msg)).toEqual(['w']);
    expect(readLogs(spies.error).map((r) => r.msg)).toEqual(['e']);
  });

  it('inyecta el contexto de request en cada linea', () => {
    setLogContextProvider(() => ({ requestId: 'req-1', tenantId: 'tenant-9' }));

    logger.error('DB error');

    expect(findLog(spies.error, 'DB error')).toMatchObject({
      requestId: 'req-1',
      tenantId: 'tenant-9',
    });
  });

  it('los bindings de un child van en cada linea y no pisan los campos reservados', () => {
    const child = logger.child({ tenantId: 'tenant-1', level: 'no-pisar' });

    child.error('DB error');

    const [record] = readLogs(spies.error);
    expect(record.tenantId).toBe('tenant-1');
    expect(record.level).toBe('error');
    expect(record.msg).toBe('DB error');
  });

  it('serializa referencias circulares sin romper el log', () => {
    const circular: Record<string, unknown> = { name: 'a' };
    circular.self = circular;

    logger.error('circular', { error: circular });

    const [record] = readLogs(spies.error);
    expect(record.error).toMatchObject({ name: 'a', self: '[circular]' });
  });
});
