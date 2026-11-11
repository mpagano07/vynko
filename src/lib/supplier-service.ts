import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { selectAllRows } from '@/lib/supabase-paging';
import { createActivityLog } from '@/lib/activity-log';
import type { AuthInfo } from '@/lib/api-auth';
import { getRoleInTenant, hasCapability } from '@/lib/membership-role';
import { logger } from '@/lib/logger';
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

export type SupplierResult<T = unknown> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

/**
 * El alta/edición/baja de proveedores es datos maestros administrativos: se
 * limita a owner/manager. La lectura sigue abierta a cualquier miembro del
 * tenant.
 */
async function assertSupplierManager(
  auth: AuthInfo
): Promise<{ ok: false; error: string; status: 403 } | null> {
  if (hasCapability(await getRoleInTenant(auth.userId, auth.tenantId), 'manage_purchases')) return null;
  return {
    ok: false,
    error: 'Sólo el dueño o un administrador pueden gestionar proveedores',
    status: 403,
  };
}

export async function listSuppliers(auth: AuthInfo): Promise<SupplierResult> {
  const buildPage = (from: number, to: number) => {
    let query = supabaseAdmin
      .from('suppliers')
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

export async function createSupplier(
  auth: AuthInfo,
  body: Record<string, unknown>
): Promise<SupplierResult> {
  try {
    const forbidden = await assertSupplierManager(auth);
    if (forbidden) return forbidden;

    if (!body.name) {
      return { ok: false, error: 'El nombre del proveedor es requerido', status: 400 };
    }

    const tax = normalizePartyTaxFields(body as PartyTaxFields);
    const taxError = validatePartyTaxFields(tax);
    if (taxError) return { ok: false, error: taxError, status: 400 };

    const { data: existing } = await supabaseAdmin
      .from('suppliers')
      .select('id')
      .eq('tenant_id', auth.tenantId)
      .ilike('name', body.name as string)
      .maybeSingle();

    if (existing) {
      return { ok: false, error: 'Ya existe un proveedor con ese nombre', status: 409 };
    }

    const { data, error } = await supabaseAdmin
      .from('suppliers')
      .insert({
        tenant_id: auth.tenantId,
        name: body.name,
        contact_name: body.contact_name || null,
        email: body.email || null,
        phone: body.phone || null,
        address: body.address || null,
        notes: body.notes || null,
        cuit: tax.cuit,
        iva_condition: tax.iva_condition,
        document_type: tax.document_type,
        document_number: tax.document_number,
      })
      .select()
      .single();

    if (error) {
      logger.error('DB error:', { error });
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }

    await supabaseAdmin
      .from('providers')
      .insert({
        id: data.id,
        tenant_id: auth.tenantId,
        name: body.name,
        email: body.email || null,
        phone: body.phone || null,
        address: body.address || null,
        cuit: tax.cuit,
        iva_condition: tax.iva_condition,
        document_type: tax.document_type,
        document_number: tax.document_number,
      })
      .select()
      .single();

    await createActivityLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'created',
      entityType: 'supplier',
      entityId: data.id,
      details: { name: body.name },
    });

    return { ok: true, data, status: 201 };
  } catch {
    return { ok: false, error: 'Invalid request body', status: 400 };
  }
}

const SUPPLIER_ALLOWED_FIELDS = [
  'name',
  'contact_name',
  'email',
  'phone',
  'address',
  'notes',
  'cuit',
  'iva_condition',
  'document_type',
  'document_number',
];

export async function updateSupplier(
  auth: AuthInfo,
  id: string,
  body: Record<string, unknown>
): Promise<SupplierResult> {
  try {
    const forbidden = await assertSupplierManager(auth);
    if (forbidden) return forbidden;

    const updateData: Record<string, unknown> = {};
    for (const key of SUPPLIER_ALLOWED_FIELDS) {
      if (body[key] !== undefined) updateData[key] = body[key];
    }

    const taxTouched = PARTY_TAX_FIELD_KEYS.some((key) => updateData[key] !== undefined);
    if (taxTouched) {
      Object.assign(updateData, normalizeProvidedTaxFields(body));

      const { data: existing } = await supabaseAdmin
        .from('suppliers')
        .select('cuit, iva_condition, document_type, document_number')
        .eq('id', id)
        .eq('tenant_id', auth.tenantId)
        .maybeSingle();

      const taxError = validatePartyTaxFields({ ...(existing || {}), ...updateData });
      if (taxError) return { ok: false, error: taxError, status: 400 };
    }

    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('suppliers')
      .update(updateData)
      .eq('id', id)
      .eq('tenant_id', auth.tenantId)
      .select()
      .single();

    if (error) {
      logger.error('DB error:', { error });
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }

    await supabaseAdmin
      .from('providers')
      .update({
        name: updateData.name || undefined,
        email: body.email !== undefined ? body.email : undefined,
        phone: body.phone !== undefined ? body.phone : undefined,
        address: body.address !== undefined ? body.address : undefined,
        cuit: body.cuit !== undefined ? updateData.cuit : undefined,
        iva_condition: body.iva_condition !== undefined ? updateData.iva_condition : undefined,
        document_type: body.document_type !== undefined ? updateData.document_type : undefined,
        document_number: body.document_number !== undefined ? updateData.document_number : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', auth.tenantId);

    await createActivityLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'updated',
      entityType: 'supplier',
      entityId: id,
      details: { name: data?.name },
    });

    return { ok: true, data, status: 200 };
  } catch {
    return { ok: false, error: 'Invalid request body', status: 400 };
  }
}

export async function deleteSupplier(auth: AuthInfo, id: string): Promise<SupplierResult> {
  const forbidden = await assertSupplierManager(auth);
  if (forbidden) return forbidden;

  const { data: deleted } = await supabaseAdmin
    .from('suppliers')
    .delete()
    .eq('id', id)
    .eq('tenant_id', auth.tenantId)
    .select('name')
    .single();

  if (!deleted) return { ok: false, error: 'Proveedor no encontrado', status: 404 };

  await supabaseAdmin
    .from('providers')
    .delete()
    .eq('id', id)
    .eq('tenant_id', auth.tenantId);

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'deleted',
    entityType: 'supplier',
    details: { name: deleted.name },
  });

  return { ok: true, data: { success: true }, status: 200 };
}

/**
 * Import de proveedores, con el mismo protocolo que el de productos y el de
 * clientes: `prepare` resuelve todo lo que no escribe (guardas + validación de
 * filas) y `execute` va resolviendo fila por fila reportando progreso para que
 * la ruta streamee el "X de N".
 *
 * Como el alta manual, pasa por `assertSupplierManager` y mantiene la tabla
 * espejo `providers` (que no tiene contacto ni notas) en cada alta y update.
 *
 * Matcheo y semántica de celdas vacías: igual que clientes (CUIT, si no
 * nombre; vacío = no informar). Defaults del alta: Responsable Inscripto +
 * CUIT, sin exigir CUIT (no les facturamos a los proveedores).
 */
export async function prepareSupplierImport(
  auth: AuthInfo,
  rows: Record<string, unknown>[] | undefined
): Promise<PreparedPartyImport> {
  const guarded = partyImportBodyGuard(rows);
  if (!guarded.ok) return guarded;
  const importRows = guarded.rows;

  const limited = await partyImportRateLimits(auth, 'suppliers');
  if (limited) return limited;

  const forbidden = await assertSupplierManager(auth);
  if (forbidden) return forbidden;

  // Un resultado por fila, indexado por posición, para que el número de fila
  // del reporte coincida con el del archivo (misma mecánica que productos).
  const slots: (PartyImportRowResult | null)[] = new Array(importRows.length).fill(null);

  // ── Fase 1: validar TODAS las filas sin tocar la base ────────────────────
  //
  // Igual que clientes: sólo lo que es de la fila. El merge con el existente
  // (y su validación fiscal) se evalúa en el write de cada fila.
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

  // ── Fase 2: cargar los proveedores del tenant, una sola lectura ──────────
  const { data: existing, error } = await supabaseAdmin
    .from('suppliers')
    .select('id, name, cuit, iva_condition, document_type, document_number, email, phone, address, notes')
    .eq('tenant_id', auth.tenantId);
  if (error) {
    logger.error('prepareSupplierImport: fallo la lectura de existentes', { error });
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
        // Alta: defaults del formulario de proveedores (responsable inscripto
        // + CUIT). A diferencia de clientes, no se exige CUIT.
        const tax = normalizePartyTaxFields({
          cuit: candidate.cuit ?? '',
          iva_condition: candidate.ivaCondition ?? 'responsable_inscripto',
          document_type: candidate.documentType ?? 'CUIT',
          document_number: candidate.documentNumber ?? '',
        });
        const taxError = validatePartyTaxFields(tax);
        if (taxError) {
          slots[candidate.index] = { row: candidate.rowNumber, status: 'skipped', name: candidate.name, error: taxError };
          skipped++;
          processed++;
          emit();
          continue;
        }

        const { data, error: insertError } = await supabaseAdmin
          .from('suppliers')
          .insert({
            tenant_id: auth.tenantId,
            name: candidate.name,
            contact_name: candidate.contactName,
            email: candidate.email,
            phone: candidate.phone,
            address: candidate.address,
            notes: candidate.notes,
            cuit: tax.cuit,
            iva_condition: tax.iva_condition || 'responsable_inscripto',
            document_type: tax.document_type || 'CUIT',
            document_number: tax.document_number,
          })
          .select()
          .single();

        if (insertError || !data) {
          logger.error('prepareSupplierImport: fallo el alta', { error: insertError });
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

        // Espejo `providers` con el mismo id, igual que createSupplier (sin
        // contacto ni notas, que la tabla espejo no tiene).
        await supabaseAdmin.from('providers').insert({
          id: data.id,
          tenant_id: auth.tenantId,
          name: candidate.name,
          email: candidate.email,
          phone: candidate.phone,
          address: candidate.address,
          cuit: tax.cuit,
          iva_condition: tax.iva_condition || 'responsable_inscripto',
          document_type: tax.document_type || 'CUIT',
          document_number: tax.document_number,
        });

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

      // Update: se mergea con lo que ya tiene el proveedor y se valida el
      // resultado final (mismo criterio que updateSupplier).
      const existingRecord = byId.get(existingId) as Record<string, unknown>;
      const mergedTax = normalizePartyTaxFields({
        cuit: candidate.cuit !== null ? candidate.cuit : String(existingRecord.cuit ?? ''),
        iva_condition: candidate.ivaCondition ?? String(existingRecord.iva_condition ?? ''),
        document_type: candidate.documentType ?? String(existingRecord.document_type ?? ''),
        document_number:
          candidate.documentNumber !== null ? candidate.documentNumber : String(existingRecord.document_number ?? ''),
      });
      const taxError = validatePartyTaxFields(mergedTax);
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
      if (candidate.contactName !== null) updates.contact_name = candidate.contactName;
      if (candidate.email !== null) updates.email = candidate.email;
      if (candidate.phone !== null) updates.phone = candidate.phone;
      if (candidate.address !== null) updates.address = candidate.address;
      if (candidate.notes !== null) updates.notes = candidate.notes;
      if (candidate.cuit !== null) updates.cuit = mergedTax.cuit;
      if (candidate.ivaCondition !== undefined) updates.iva_condition = mergedTax.iva_condition || 'responsable_inscripto';
      if (candidate.documentType !== undefined) updates.document_type = mergedTax.document_type || 'CUIT';
      if (candidate.documentNumber !== null) updates.document_number = mergedTax.document_number;

      const { error: updateError } = await supabaseAdmin
        .from('suppliers')
        .update(updates)
        .eq('id', existingId)
        .eq('tenant_id', auth.tenantId);

      if (updateError) {
        logger.error('prepareSupplierImport: fallo el update', { error: updateError });
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

      // Espejo `providers`: sólo las columnas que la tabla espejo tiene.
      const mirror: Record<string, unknown> = { name: candidate.name, updated_at: updates.updated_at };
      if (candidate.email !== null) mirror.email = candidate.email;
      if (candidate.phone !== null) mirror.phone = candidate.phone;
      if (candidate.address !== null) mirror.address = candidate.address;
      if (candidate.cuit !== null) mirror.cuit = mergedTax.cuit;
      if (candidate.ivaCondition !== undefined) mirror.iva_condition = mergedTax.iva_condition || 'responsable_inscripto';
      if (candidate.documentType !== undefined) mirror.document_type = mergedTax.document_type || 'CUIT';
      if (candidate.documentNumber !== null) mirror.document_number = mergedTax.document_number;
      await supabaseAdmin
        .from('providers')
        .update(mirror)
        .eq('id', existingId)
        .eq('tenant_id', auth.tenantId);

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
      details: { kind: 'suppliers', created, updated, skipped, total },
    });

    return { results, summary: { created, updated, skipped, total } };
  };

  return { ok: true, total, execute };
}
