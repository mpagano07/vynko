import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * Reserva el proximo numero de un tipo de documento comercial.
 *
 * El claim es compare-and-set: se lee `next_number`, se intenta escribir
 * `candidate + 1` filtrando por `.eq('next_number', candidate)`. Si otro request
 * gano la carrera, el update no matchea ninguna fila y se reintenta con el
 * valor ya avanzado. Sin ese filtro el contador se pisaba (lost update) y dos
 * documentos podian reclamar el mismo numero, dejando que el UNIQUE de
 * `commercial_documents` fuera el unico que los frenara.
 */

const MAX_CLAIM_ATTEMPTS = 5;

const CLAIM_EXHAUSTED = {
  error: 'No se pudo generar el número de documento. Intentá de nuevo.',
  status: 409,
} as const;

export type DocumentNumberClaim =
  | { ok: true; number: number }
  | { ok: false; error: string; status: number };

export async function claimCommercialDocumentNumber(
  tenantId: string,
  documentType: string
): Promise<DocumentNumberClaim> {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const { data: seqResult } = await supabaseAdmin
      .from('commercial_document_sequences')
      .select('next_number')
      .eq('tenant_id', tenantId)
      .eq('document_type', documentType)
      .maybeSingle();

    const candidate = (seqResult?.next_number as number | undefined) ?? 1;

    if (!seqResult) {
      // upsert y no insert: si dos requests crean la fila a la vez, el insert
      // crudo revienta con UNIQUE y el claim quedaria sin contador.
      await supabaseAdmin
        .from('commercial_document_sequences')
        .upsert(
          {
            tenant_id: tenantId,
            document_type: documentType,
            next_number: candidate,
          },
          { onConflict: 'tenant_id,document_type' }
        );
    }

    const { data: claimed } = await supabaseAdmin
      .from('commercial_document_sequences')
      .update({ next_number: candidate + 1, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('document_type', documentType)
      .eq('next_number', candidate)
      .select('next_number');

    if (Array.isArray(claimed) && claimed.length > 0) {
      return { ok: true, number: candidate };
    }
  }

  return { ok: false, ...CLAIM_EXHAUSTED };
}

/**
 * Devuelve un numero reservado cuando el documento no llego a insertarse, para
 * que no quede un hueco en la numeracion.
 *
 * Es best-effort y tambien compare-and-set sobre `next_number = claimed + 1`:
 * si nadie avanzo el contador en el medio se recupera el numero, y si alguien
 * ya reclamo el siguiente no se toca nada (haber consumido ese numero es
 * preferible a retroceder el contador y provocar un choque).
 */
export async function releaseCommercialDocumentNumber(
  tenantId: string,
  documentType: string,
  claimedNumber: number
): Promise<void> {
  await supabaseAdmin
    .from('commercial_document_sequences')
    .update({ next_number: claimedNumber, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('document_type', documentType)
    .eq('next_number', claimedNumber + 1);
}
