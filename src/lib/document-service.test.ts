import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { createDocument } from './document-service';
import type { AuthInfo } from '@/lib/api-auth';
import type { DocumentType } from '@/lib/types/document';

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: supabaseMock,
}));

vi.mock('@/lib/track-event', () => ({
  trackEvent: vi.fn(async () => undefined),
}));

const AUTH: AuthInfo = { tenantId: 'tenant-1', userId: 'user-1' } as AuthInfo;

const baseBody = {
  document_type: 'presupuesto' as DocumentType,
  customer_name: 'Ana',
  items: [{ description: 'Producto', quantity: 1, unit_price_cents: 100 }],
};

const seqUpdates = () =>
  supabaseMock.__calls.filter(
    (c) => c.table === 'commercial_document_sequences' && c.method === 'update'
  );

describe('createDocument con numeracion', () => {
  beforeEach(() => {
    supabaseMock.__reset();
  });

  it('devuelve el numero reservado cuando el insert del documento falla por un error que no es numero repetido', async () => {
    supabaseMock.__queue('commercial_document_sequences', { data: { next_number: 5 }, error: null });
    supabaseMock.__queue('commercial_document_sequences', { data: [{ next_number: 6 }], error: null });
    supabaseMock.__queue('commercial_documents', {
      data: null,
      error: { code: '22P02', message: 'invalid input' },
    });

    const result = await createDocument(AUTH, baseBody);

    expect(result).toMatchObject({ ok: false, status: 409 });

    // El numero 5 se reclamo y, como el documento no se grabo, se devolvio
    // con un CAS reverso (eq next_number=6) para no dejar un hueco.
    const release = seqUpdates().find((c) => (c.args[0] as Record<string, unknown>).next_number === 5);
    expect(release).toBeDefined();
    const releaseEqs = supabaseMock.__calls.filter(
      (c) =>
        c.table === 'commercial_document_sequences' &&
        c.method === 'eq' &&
        c.args[0] === 'next_number' &&
        c.args[1] === 6
    );
    expect(releaseEqs.length).toBeGreaterThan(0);
  });

  it('no devuelve el numero cuando el fallo fue por numero repetido', async () => {
    supabaseMock.__queue('commercial_document_sequences', { data: { next_number: 5 }, error: null });
    supabaseMock.__queue('commercial_document_sequences', { data: [{ next_number: 6 }], error: null });
    supabaseMock.__queue('commercial_documents', {
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });

    const result = await createDocument(AUTH, baseBody);

    expect(result).toMatchObject({ ok: false, status: 409 });

    // Con 23505 el numero ya pertenece a otro documento: devolverlo haria que
    // la siguiente intento chocara de nuevo, asi que NO se hace rollback.
    const releases = seqUpdates().filter((c) => (c.args[0] as Record<string, unknown>).next_number === 5);
    expect(releases).toHaveLength(0);
  });
});