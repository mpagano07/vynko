import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { selectAllRows } from '@/lib/supabase-paging';
import type { AuthInfo } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { createActivityLog } from '@/lib/activity-log';
import {
  PARTY_TAX_FIELD_KEYS,
  normalizePartyTaxFields,
  normalizeProvidedTaxFields,
  validatePartyTaxFields,
  type PartyTaxFields,
} from '@/lib/tax-fields';
import {
  buildPartyCandidate,
  partyImportBodyGuard,
  partyImportRateLimits,
  partyNameKey,
  type PartyImportCandidate,
  type PartyImportProgressCallback,
  type PartyImportRowResult,
  type PreparedPartyImport,
} from '@/lib/party-import';

export type CustomerResult<T = unknown> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

export async function listCustomers(auth: AuthInfo): Promise<CustomerResult> {
  const buildPage = (from: number, to: number) => {
    let query = supabaseAdmin
      .from('customers')
      .select('*')
      .order('name', { ascending: true })
      // Tiebreak único: sin él el loop de rangos puede solapar filas.
      .order('id', { ascending: true });
    if (auth.allTenants) query = query.in('tenant_id', auth.tenantIds);
    else query = query.eq('tenant_id', auth.tenantId);
    return query.range(from, to);
  };
  // PostgREST corta todo SELECT en 1000 filas (db-max-rows) sin avisar, así
  // que el listado se recorre por rangos hasta agotar el tenant.
  const { data, error } = await selectAllRows(buildPage);

  if (error) {
    logger.error('DB error:', { error });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }
  return { ok: true, data: data || [], status: 200 };
}

export async function createCustomer(
  auth: AuthInfo,
  body: Record<string, unknown>
): Promise<CustomerResult> {
  try {
    if (!body.name) {
      return { ok: false, error: 'El nombre del cliente es requerido', status: 400 };
    }

    const tax = normalizePartyTaxFields(body as PartyTaxFields);
    const taxError = validatePartyTaxFields(tax, { requireCuit: true });
    if (taxError) return { ok: false, error: taxError, status: 400 };

    const { data, error } = await supabaseAdmin
      .from('customers')
      .insert({
        tenant_id: auth.tenantId,
        name: body.name,
        email: body.email || null,
        phone: body.phone || null,
        address: body.address || null,
        notes: body.notes || null,
        cuit: tax.cuit,
        iva_condition: tax.iva_condition || 'consumidor_final',
        document_type: tax.document_type || 'DNI',
        document_number: tax.document_number,
      })
      .select()
      .single();

    if (error) {
      logger.error('DB error:', { error });
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }
    return { ok: true, data, status: 201 };
  } catch {
    return { ok: false, error: 'Invalid request body', status: 400 };
  }
}

const CUSTOMER_ALLOWED_FIELDS = [
  'name',
  'email',
  'phone',
  'address',
  'notes',
  'cuit',
  'iva_condition',
  'document_type',
  'document_number',
];

export async function updateCustomer(
  auth: AuthInfo,
  id: string,
  body: Record<string, unknown>
): Promise<CustomerResult> {
  try {
    const updates: Record<string, unknown> = {};
    for (const key of CUSTOMER_ALLOWED_FIELDS) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return { ok: false, error: 'No hay campos para actualizar', status: 400 };
    }

    const taxTouched = PARTY_TAX_FIELD_KEYS.some((key) => updates[key] !== undefined);
    if (taxTouched) Object.assign(updates, normalizeProvidedTaxFields(body));

    if (taxTouched) {
      const { data: existing } = await supabaseAdmin
        .from('customers')
        .select('cuit, iva_condition, document_type, document_number')
        .eq('id', id)
        .eq('tenant_id', auth.tenantId)
        .maybeSingle();

      const taxError = validatePartyTaxFields({ ...(existing || {}), ...updates }, { requireCuit: true });
      if (taxError) return { ok: false, error: taxError, status: 400 };
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('customers')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', auth.tenantId)
      .select()
      .single();

    if (error) {
      logger.error('DB error:', { error });
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }
    return { ok: true, data, status: 200 };
  } catch {
    return { ok: false, error: 'Invalid request body', status: 400 };
  }
}

export async function deleteCustomer(auth: AuthInfo, id: string): Promise<CustomerResult> {
  const { error } = await supabaseAdmin
    .from('customers')
    .delete()
    .eq('id', id)
    .eq('tenant_id', auth.tenantId);

  if (error) {
    logger.error('DB error:', { error });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
  }
  return { ok: true, data: { success: true }, status: 200 };
}

export async function getCustomerHistory(auth: AuthInfo, id: string): Promise<CustomerResult> {
  const { data: sales, error } = await supabaseAdmin
    .from('sales')
    .select(`
      id, total_cents, status, notes, created_at,
      items:sale_items(
        id, quantity, unit_price_cents, subtotal_cents,
        product:products(name)
      )
    `)
    .eq('tenant_id', auth.tenantId)
    .eq('customer_id', id)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('DB error:', { error });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  const totalSpent = (sales ?? []).reduce((sum, s) => sum + (s.total_cents || 0), 0);
  const visitCount = (sales ?? []).length;

  const formatted = (sales ?? []).map((s) => ({
    ...s,
    total: (s.total_cents || 0) / 100,
    items: (s.items || []).map((i) => {
      const product = Array.isArray(i.product)
        ? (i.product[0] as Record<string, unknown> | undefined)
        : (i.product as unknown as Record<string, unknown> | undefined);
      return {
        ...i,
        unit_price: (i.unit_price_cents || 0) / 100,
        subtotal: (i.subtotal_cents || 0) / 100,
        product_name: product?.name || 'Producto',
      };
    }),
  }));

  return { ok: true, data: { sales: formatted, totalSpent: totalSpent / 100, visitCount }, status: 200 };
}

/**
 * Import de clientes, con el mismo protocolo que el de productos: se prepara
 * todo lo que no escribe (guardas + validación de filas), y `execute` va
 * resolviendo fila por fila reportando progreso para que la ruta streamee el
 * "X de N".
 *
 * Matcheo: una fila actualiza al cliente existente con ese CUIT (si trae) o,
 * si no, al de ese nombre (comparación case-insensitive, mismo criterio que
 * el nombre es la única clave que tiene un cliente sin CUIT). El resto son
 * altas. Las filas repetidas dentro del mismo archivo actualizan al mismo
 * cliente en vez de duplicarlo.
 *
 * Una celda vacía significa "no informar": en un update se conserva el valor
 * que ya tenía el cliente (igual que el import de productos con el stock).
 */
export async function prepareCustomerImport(
  auth: AuthInfo,
  rows: Record<string, unknown>[] | undefined
): Promise<PreparedPartyImport> {
  const guarded = partyImportBodyGuard(rows);
  if (!guarded.ok) return guarded;
  const importRows = guarded.rows;

  const limited = await partyImportRateLimits(auth, 'customers');
  if (limited) return limited;

  // Un resultado por fila, indexado por posición, para que el número de fila
  // del reporte coincida con el del archivo (misma mecánica que productos).
  const slots: (PartyImportRowResult | null)[] = new Array(importRows.length).fill(null);

  // ── Fase 1: validar TODAS las filas sin tocar la base ────────────────────
  //
  // La validación fiscal completa depende del camino que tome cada fila (un
  // update se mergea con lo que ya tiene el cliente), así que acá sólo se
  // valida lo que es de la fila: nombre, labels de IVA/documento reconocibles
  // y el formato de los datos fiscales propios. El requireCuit de clientes se
  // evalúa en el write, sobre el registro final.
  const candidates: PartyImportCandidate[] = [];
  for (let i = 0; i < importRows.length; i++) {
    const built = buildPartyCandidate(importRows[i] ?? {}, i);
    if (!built.ok) {
      slots[i] = { row: i + 1, status: 'skipped', error: built.error };
      continue;
    }
    const candidate = built.candidate;

    const ownTax = normalizePartyTaxFields({
      cuit: candidate.cuit ?? '',
      iva_condition: candidate.ivaCondition ?? '',
      document_type: candidate.documentType ?? '',
      document_number: candidate.documentNumber ?? '',
    });
    const taxError = validatePartyTaxFields(ownTax);
    if (taxError) {
      slots[i] = { row: i + 1, status: 'skipped', name: candidate.name, error: taxError };
      continue;
    }

    candidates.push(candidate);
  }

  // ── Fase 2: cargar los clientes del tenant, una sola lectura ────────────
  const { data: existing, error } = await supabaseAdmin
    .from('customers')
    .select('id, name, cuit, iva_condition, document_type, document_number, email, phone, address, notes')
    .eq('tenant_id', auth.tenantId);
  if (error) {
    logger.error('prepareCustomerImport: fallo la lectura de existentes', { error });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  const byId = new Map<string, Record<string, unknown>>();
  const byCuit = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const record of (existing ?? []) as Record<string, unknown>[]) {
    byId.set(String(record.id), record);
    const cuitDigits = String(record.cuit ?? '').replace(/\D/g, '');
    if (cuitDigits && !byCuit.has(cuitDigits)) byCuit.set(cuitDigits, String(record.id));
    const nameKey = partyNameKey(record.name);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, String(record.id));
  }

  const total = importRows.length;

  // ── Fase 3: escribir ─────────────────────────────────────────────────────
  const execute = async (onProgress?: PartyImportProgressCallback) => {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const slot of slots) {
      if (!slot) continue;
      if (slot.status === 'created') created++;
      else if (slot.status === 'updated') updated++;
      else skipped++;
    }
    let processed = skipped;
    const emit = () => onProgress?.({ processed, total, created, updated, skipped });

    // Un primer evento con las filas ya descartadas por la validación: la barra
    // arranca mostrando el avance real y no en cero cuando el archivo venía
    // con errores (misma mecánica que el import de productos).
    emit();

    for (const candidate of candidates) {
      const cuitDigits = candidate.cuit ? candidate.cuit.replace(/\D/g, '') : '';
      const existingId =
        (cuitDigits ? byCuit.get(cuitDigits) : undefined) ?? byName.get(partyNameKey(candidate.name));

      if (!existingId) {
        // Alta: defaults del formulario de clientes (consumidor final + DNI).
        const tax = normalizePartyTaxFields({
          cuit: candidate.cuit ?? '',
          iva_condition: candidate.ivaCondition ?? 'consumidor_final',
          document_type: candidate.documentType ?? 'DNI',
          document_number: candidate.documentNumber ?? '',
        });
        const taxError = validatePartyTaxFields(tax, { requireCuit: true });
        if (taxError) {
          slots[candidate.index] = { row: candidate.rowNumber, status: 'skipped', name: candidate.name, error: taxError };
          skipped++;
          processed++;
          emit();
          continue;
        }

        const { data, error: insertError } = await supabaseAdmin
          .from('customers')
          .insert({
            tenant_id: auth.tenantId,
            name: candidate.name,
            email: candidate.email,
            phone: candidate.phone,
            address: candidate.address,
            notes: candidate.notes,
            cuit: tax.cuit,
            iva_condition: tax.iva_condition || 'consumidor_final',
            document_type: tax.document_type || 'DNI',
            document_number: tax.document_number,
          })
          .select()
          .single();

        if (insertError || !data) {
          logger.error('prepareCustomerImport: fallo el alta', { error: insertError });
          slots[candidate.index] = {
            row: candidate.rowNumber,
            status: 'skipped',
            name: candidate.name,
            error: 'Ocurrio un error inesperado. Intenta de nuevo.',
          };
          skipped++;
          processed++;
          emit();
          continue;
        }

        const record = data as Record<string, unknown>;
        byId.set(String(record.id), record);
        if (cuitDigits) byCuit.set(cuitDigits, String(record.id));
        byName.set(partyNameKey(candidate.name), String(record.id));
        slots[candidate.index] = { row: candidate.rowNumber, status: 'created', name: candidate.name };
        created++;
        processed++;
        emit();
        continue;
      }

      // Update: se mergea con lo que ya tiene el cliente y se valida el
      // resultado final (mismo criterio que updateCustomer).
      const existingRecord = byId.get(existingId) as Record<string, unknown>;
      const mergedTax = normalizePartyTaxFields({
        cuit: candidate.cuit !== null ? candidate.cuit : String(existingRecord.cuit ?? ''),
        iva_condition: candidate.ivaCondition ?? String(existingRecord.iva_condition ?? ''),
        document_type: candidate.documentType ?? String(existingRecord.document_type ?? ''),
        document_number:
          candidate.documentNumber !== null ? candidate.documentNumber : String(existingRecord.document_number ?? ''),
      });
      const taxError = validatePartyTaxFields(mergedTax, { requireCuit: true });
      if (taxError) {
        slots[candidate.index] = { row: candidate.rowNumber, status: 'skipped', name: candidate.name, error: taxError };
        skipped++;
        processed++;
        emit();
        continue;
      }

      // El nombre siempre viene en la fila (es obligatorio), así que el update
      // siempre tiene al menos un campo: reimportar un export sin cambios
      // reporta "actualizados", igual que el import de productos.
      const updates: Record<string, unknown> = {
        name: candidate.name,
        updated_at: new Date().toISOString(),
      };
      if (candidate.email !== null) updates.email = candidate.email;
      if (candidate.phone !== null) updates.phone = candidate.phone;
      if (candidate.address !== null) updates.address = candidate.address;
      if (candidate.notes !== null) updates.notes = candidate.notes;
      if (candidate.cuit !== null) updates.cuit = mergedTax.cuit;
      if (candidate.ivaCondition !== undefined) updates.iva_condition = mergedTax.iva_condition || 'consumidor_final';
      if (candidate.documentType !== undefined) updates.document_type = mergedTax.document_type || 'DNI';
      if (candidate.documentNumber !== null) updates.document_number = mergedTax.document_number;

      const { error: updateError } = await supabaseAdmin
        .from('customers')
        .update(updates)
        .eq('id', existingId)
        .eq('tenant_id', auth.tenantId);

      if (updateError) {
        logger.error('prepareCustomerImport: fallo el update', { error: updateError });
        slots[candidate.index] = {
          row: candidate.rowNumber,
          status: 'skipped',
          name: candidate.name,
          error: 'Ocurrio un error inesperado. Intenta de nuevo.',
        };
        skipped++;
        processed++;
        emit();
        continue;
      }

      // El registro en memoria refleja el update para que una fila posterior
      // del mismo archivo mergee contra el valor nuevo.
      byId.set(existingId, { ...existingRecord, ...updates });
      if (candidate.cuit !== null && mergedTax.cuit) byCuit.set(String(mergedTax.cuit), existingId);
      slots[candidate.index] = { row: candidate.rowNumber, status: 'updated', name: candidate.name };
      updated++;
      processed++;
      emit();
    }

    const results = slots.filter((r): r is PartyImportRowResult => r !== null);

    await createActivityLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'imported',
      entityType: 'import',
      details: { kind: 'customers', created, updated, skipped, total },
    });

    return { results, summary: { created, updated, skipped, total } };
  };

  return { ok: true, total, execute };
}
