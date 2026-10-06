import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import {
  claimCommercialDocumentNumber,
  releaseCommercialDocumentNumber,
} from './commercial-document-number';

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: supabaseMock,
}));

const seqUpdates = () =>
  supabaseMock.__calls.filter(
    (c) => c.table === 'commercial_document_sequences' && c.method === 'update'
  );

const seqEqOnNextNumber = () =>
  supabaseMock.__calls
    .filter((c) => c.table === 'commercial_document_sequences' && c.method === 'eq' && c.args[0] === 'next_number')
    .map((c) => c.args[1]);

describe('claimCommercialDocumentNumber', () => {
  beforeEach(() => {
    supabaseMock.__reset();
  });

  it('claims the next number with a compare-and-set on the current value', async () => {
    supabaseMock.__queue('commercial_document_sequences', { data: { next_number: 7 }, error: null });
    supabaseMock.__queue('commercial_document_sequences', { data: [{ next_number: 8 }], error: null });

    const result = await claimCommercialDocumentNumber('tenant-1', 'remito_salida');

    expect(result).toEqual({ ok: true, number: 7 });
    const updates = seqUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toMatchObject({ next_number: 8 });
    expect(seqEqOnNextNumber()).toEqual([7]);
  });

  it('retries when another request won the race (CAS matched no rows)', async () => {
    supabaseMock.__queue('commercial_document_sequences', { data: { next_number: 9 }, error: null });
    supabaseMock.__queue('commercial_document_sequences', { data: [], error: null });
    supabaseMock.__queue('commercial_document_sequences', { data: { next_number: 10 }, error: null });
    supabaseMock.__queue('commercial_document_sequences', { data: [{ next_number: 11 }], error: null });

    const result = await claimCommercialDocumentNumber('tenant-1', 'remito_salida');

    expect(result).toEqual({ ok: true, number: 10 });
    // El reintento va contra el valor ya avanzado por el request que gano.
    expect(seqUpdates()[1].args[0]).toMatchObject({ next_number: 11 });
    expect(seqEqOnNextNumber()).toEqual([9, 10]);
  });

  it('creates the sequence row with upsert when it does not exist yet', async () => {
    supabaseMock.__queue('commercial_document_sequences', { data: null, error: null });
    // El mock resuelve el builder como thenable, asi que el upsert consumido
    // tambien dequeuea (su resultado se descarta).
    supabaseMock.__queue('commercial_document_sequences', { data: null, error: null });
    supabaseMock.__queue('commercial_document_sequences', { data: [{ next_number: 1 }], error: null });

    const result = await claimCommercialDocumentNumber('tenant-1', 'remito_ingreso');

    expect(result).toMatchObject({ ok: true, number: 1 });
    const upsert = supabaseMock.__calls.find(
      (c) => c.table === 'commercial_document_sequences' && c.method === 'upsert'
    );
    expect(upsert?.args[0]).toMatchObject({
      tenant_id: 'tenant-1',
      document_type: 'remito_ingreso',
      next_number: 1,
    });
  });

  it('returns 409 after exhausting claim attempts', async () => {
    for (let i = 0; i < 5; i++) {
      supabaseMock.__queue('commercial_document_sequences', { data: { next_number: i + 1 }, error: null });
      supabaseMock.__queue('commercial_document_sequences', { data: [], error: null });
    }

    const result = await claimCommercialDocumentNumber('tenant-1', 'presupuesto');

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(seqUpdates()).toHaveLength(5);
  });
});

describe('releaseCommercialDocumentNumber', () => {
  beforeEach(() => {
    supabaseMock.__reset();
  });

  it('returns the claimed number only if nobody advanced the counter', async () => {
    await releaseCommercialDocumentNumber('tenant-1', 'remito_salida', 7);

    expect(seqUpdates()[0].args[0]).toMatchObject({ next_number: 7 });
    // El CAS reverso: solo se recupera si el contador sigue en claimed + 1.
    expect(seqEqOnNextNumber()).toEqual([8]);
  });
});