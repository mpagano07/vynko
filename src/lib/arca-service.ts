import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { AuthInfo } from '@/lib/api-auth';
import type {
  ArcaConfig,
  ArcaEnvironment,
  ArcaConcept,
  ArcaVoucherType,
  CreateElectronicInvoiceRequest,
  ElectronicInvoiceRecord,
  ArcaIvaItem,
} from '@/lib/types/arca';
import {
  VOUCHER_TYPE_CODES,
  DOC_TYPE_CODES,
  PERCENTAGE_TO_IVA_ID,
  CONDICION_IVA_RECEPTOR_ID,
} from '@/lib/types/arca';
import {
  encryptSensitiveText,
  decryptSensitiveText,
  normalizePem,
  isValidCertificatePem,
  isValidPrivateKeyPem,
} from '@/lib/arca/crypto';
import {
  authenticateWsaa,
  getLastAuthorizedVoucher,
  authorizeElectronicInvoice,
  checkWsfeHealth,
} from '@/lib/arca/client';
import { buildArcaQrUrl, generateQrImageDataUrl } from '@/lib/arca/qr';
import { toArgentinaDate, toArgentinaDateCompact } from '@/lib/arca/date';
import { canUseFacturacionForUser } from '@/lib/arca/access-server';
import { canManageTenant, getRoleInTenant } from '@/lib/membership-role';
import { logger } from '@/lib/logger';

interface ServiceResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  status: number;
}

export function isSandboxConfig(config?: { cert_pem?: string | null; key_encrypted?: string | null } | null): boolean {
  return config?.cert_pem === 'SANDBOX_DEMO_CERT' || config?.key_encrypted === 'SANDBOX_DEMO_KEY';
}

/**
 * Indica si un comprobante guardado se emitió en Modo Sandbox. Se deriva del
 * flag `sandbox` que quedó registrado en `afip_response` al autorizarlo.
 */
export function isSandboxInvoice(
  invoice?: { afip_response?: Record<string, unknown> | null } | null
): boolean {
  return Boolean(invoice?.afip_response?.sandbox);
}

/**
 * Reparte `amount` (centavos) entre las líneas de forma proporcional a su
 * importe, garantizando que la suma de las partes sea exactamente `amount`
 * (el residuo de redondeo se asigna a las líneas con mayor parte fraccionaria).
 */
export function allocateProportionally(lineTotals: number[], amount: number): number[] {
  const total = lineTotals.reduce((sum, v) => sum + v, 0);
  if (amount <= 0 || total <= 0) return lineTotals.map(() => 0);

  const raw = lineTotals.map((v) => (v * amount) / total);
  const floors = raw.map((v) => Math.floor(v));
  const remainder = amount - floors.reduce((sum, v) => sum + v, 0);

  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);

  const result = [...floors];
  for (let k = 0; k < remainder; k++) {
    result[order[k % order.length].i] += 1;
  }
  return result;
}

/**
 * Determina el tipo de Nota de Crédito que corresponde a una factura emitida.
 * Solo las facturas (A/B/C) se pueden acreditar; devuelve `null` si el
 * comprobante original no es una factura.
 */
export function resolveCreditNoteType(
  originalInvoiceType: string
): 'NC_A' | 'NC_B' | 'NC_C' | null {
  if (originalInvoiceType === 'A') return 'NC_A';
  if (originalInvoiceType === 'B') return 'NC_B';
  if (originalInvoiceType === 'C') return 'NC_C';
  return null;
}

/**
 * Gets ARCA configuration for the tenant (omits private key).
 */
export async function getArcaConfig(auth: AuthInfo): Promise<ServiceResult<ArcaConfig>> {
  try {
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('cuit, punto_venta')
      .eq('id', auth.tenantId)
      .maybeSingle();

    const { data: config, error } = await supabaseAdmin
      .from('tenant_arca_config')
      .select('*')
      .eq('tenant_id', auth.tenantId)
      .maybeSingle();

    if (error || !config) {
      if (error && error.code !== '42P01') {
        logger.warn('Could not fetch tenant_arca_config, falling back to defaults', { error });
      }
      return {
        ok: true,
        data: {
          id: '',
          tenant_id: auth.tenantId,
          cuit: tenant?.cuit || '',
          punto_venta: tenant?.punto_venta || 1,
          environment: 'homologacion',
          concept: 1,
          has_cert: false,
          has_key: false,
          is_active: false,
        },
        status: 200,
      };
    }

    return {
      ok: true,
      data: {
        id: config.id,
        tenant_id: config.tenant_id,
        cuit: config.cuit,
        punto_venta: config.punto_venta,
        environment: config.environment as ArcaEnvironment,
        concept: config.concept as ArcaConcept,
        has_cert: Boolean(config.cert_pem),
        has_key: Boolean(config.key_encrypted),
        is_active: Boolean(config.is_active),
        is_sandbox: isSandboxConfig(config),
        last_tested_at: config.last_tested_at,
        last_error: config.last_error,
      },
      status: 200,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    return { ok: false, error: msg, status: 500 };
  }
}

/**
 * Saves ARCA configuration and handles certificate and private key encryption.
 */
export async function saveArcaConfig(
  auth: AuthInfo,
  input: {
    cuit: string;
    punto_venta: number;
    environment: ArcaEnvironment;
    concept: ArcaConcept;
    cert_pem?: string;
    key_pem?: string;
    is_sandbox?: boolean;
  }
): Promise<ServiceResult<{ success: boolean }>> {
  try {
    // Escribir la config de ARCA incluye subir/reemplazar la clave privada RSA y
    // el certificado de la empresa: es una accion administrativa. Sin este
    // chequeo cualquier `member` podia sobreescribir la identidad fiscal del
    // tenant (CUIT, punto de venta, entorno) y sus credenciales.
    if (!(await canManageTenant(await getRoleInTenant(auth.userId, auth.tenantId)))) {
      return { ok: false, error: 'No tenés permisos para configurar la facturación electrónica', status: 403 };
    }

    if (!(await canUseFacturacionForUser(auth.userId, auth.tenantId))) {
      return {
        ok: false,
        error: 'La facturación electrónica no está habilitada para esta cuenta',
        status: 403,
      };
    }

    const cleanCuit = input.cuit.replace(/\D/g, '');
    if (cleanCuit.length !== 11) {
      return { ok: false, error: 'El CUIT debe tener exactamente 11 dígitos numéricos', status: 400 };
    }

    if (!input.punto_venta || input.punto_venta < 1) {
      return { ok: false, error: 'El punto de venta debe ser un número mayor a 0', status: 400 };
    }

    // El sandbox emite CAEs simulados marcados como autorizados; no puede usarse
    // contra el entorno de producción, donde se emitirían comprobantes de valores
    // fiscales reales.
    if (input.is_sandbox === true && input.environment === 'produccion') {
      return {
        ok: false,
        error:
          'El Modo Sandbox solo está disponible en el entorno de Homologación (pruebas). Cambiá el entorno a Homologación para activarlo.',
        status: 400,
      };
    }

    const { data: existing } = await supabaseAdmin
      .from('tenant_arca_config')
      .select('id, cert_pem, key_encrypted, key_iv, key_tag, is_active')
      .eq('tenant_id', auth.tenantId)
      .maybeSingle();

    let certPem = existing?.cert_pem || null;
    let keyEncrypted = existing?.key_encrypted || null;
    let keyIv = existing?.key_iv || null;
    let keyTag = existing?.key_tag || null;

    let credentialsChanged = false;
    const hadSandboxCredentials = isSandboxConfig(existing);

    if (input.is_sandbox === true) {
      certPem = 'SANDBOX_DEMO_CERT';
      keyEncrypted = 'SANDBOX_DEMO_KEY';
      keyIv = 'sandbox';
      keyTag = 'sandbox';
      credentialsChanged = true;
    } else {
      // `is_sandbox === false` explícito significa "desactivar el modo demo":
      // hay que limpiar las credenciales sentinela, si no la config queda
      // atrapada en sandbox y nunca se puede cargar un certificado real.
      if (input.is_sandbox === false && hadSandboxCredentials) {
        certPem = null;
        keyEncrypted = null;
        keyIv = null;
        keyTag = null;
        credentialsChanged = true;
      }

      if (input.cert_pem && input.cert_pem.trim().length > 0) {
        const normalizedCert = normalizePem(input.cert_pem);
        if (!isValidCertificatePem(normalizedCert)) {
          return { ok: false, error: 'El archivo de certificado no tiene un formato X.509 válido', status: 400 };
        }
        certPem = normalizedCert;
        credentialsChanged = true;
      }

      if (input.key_pem && input.key_pem.trim().length > 0) {
        const normalizedKey = normalizePem(input.key_pem);
        if (!isValidPrivateKeyPem(normalizedKey)) {
          return { ok: false, error: 'La clave privada no tiene un formato RSA PEM válido', status: 400 };
        }
        const enc = encryptSensitiveText(normalizedKey);
        keyEncrypted = enc.encrypted;
        keyIv = enc.iv;
        keyTag = enc.tag;
        credentialsChanged = true;
      }
    }

    const payload: Record<string, unknown> = {
      tenant_id: auth.tenantId,
      cuit: cleanCuit,
      punto_venta: input.punto_venta,
      environment: input.environment,
      concept: input.concept,
      cert_pem: certPem,
      key_encrypted: keyEncrypted,
      key_iv: keyIv,
      key_tag: keyTag,
      updated_at: new Date().toISOString(),
    };

    // Al cambiar (o limpiar) credenciales hay que volver a probar la conexión.
    if (credentialsChanged) {
      payload.is_active = false;
      payload.wsaa_token = null;
      payload.wsaa_sign = null;
      payload.wsaa_expiration = null;
    }

    const { error: writeError } = existing?.id
      ? await supabaseAdmin.from('tenant_arca_config').update(payload).eq('id', existing.id)
      : await supabaseAdmin.from('tenant_arca_config').insert(payload);

    if (writeError) {
      logger.error('Error saving tenant_arca_config', { error: writeError });
      return { ok: false, error: 'No se pudo guardar la configuración de ARCA', status: 500 };
    }

    // Sincronizar en tenants
    await supabaseAdmin
      .from('tenants')
      .update({
        cuit: cleanCuit,
        punto_venta: input.punto_venta,
      })
      .eq('id', auth.tenantId);

    return { ok: true, data: { success: true }, status: 200 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al guardar configuración';
    return { ok: false, error: msg, status: 500 };
  }
}

/**
 * Gets a valid WSAA token and sign (reuses cached if still valid).
 */
async function getOrRenewWsaaToken(
  configRow: {
    id: string;
    environment: ArcaEnvironment;
    cert_pem: string;
    key_encrypted: string;
    key_iv: string;
    key_tag: string;
    wsaa_token?: string;
    wsaa_sign?: string;
    wsaa_expiration?: string;
  }
): Promise<{ token: string; sign: string }> {
  // Verificar si el token en caché es válido y le quedan al menos 15 minutos
  if (configRow.wsaa_token && configRow.wsaa_sign && configRow.wsaa_expiration) {
    const exp = new Date(configRow.wsaa_expiration).getTime();
    const margin = 15 * 60 * 1000;
    if (exp - Date.now() > margin) {
      return { token: configRow.wsaa_token, sign: configRow.wsaa_sign };
    }
  }

  // Desencriptar clave privada
  const keyPem = decryptSensitiveText({
    encrypted: configRow.key_encrypted,
    iv: configRow.key_iv,
    tag: configRow.key_tag,
  });

  const ticket = await authenticateWsaa(configRow.environment, configRow.cert_pem, keyPem);

  // Actualizar caché en base de datos
  await supabaseAdmin
    .from('tenant_arca_config')
    .update({
      wsaa_token: ticket.token,
      wsaa_sign: ticket.sign,
      wsaa_expiration: ticket.expirationTime,
    })
    .eq('id', configRow.id);

  return { token: ticket.token, sign: ticket.sign };
}

/**
 * Tests connection with ARCA servers and point of sale.
 */
export async function testArcaConnection(auth: AuthInfo): Promise<
  ServiceResult<{
    serverHealth: { appServer: string; dbServer: string; authServer: string };
    lastVoucher: number;
    environment: string;
    puntoVenta: number;
  }>
> {
  try {
    // Autenticarse contra ARCA con la clave privada guardada es parte de la
    // administracion fiscal: no puede gatillarlo cualquier `member`.
    if (!(await canManageTenant(await getRoleInTenant(auth.userId, auth.tenantId)))) {
      return { ok: false, error: 'No tenés permisos para operar la facturación electrónica', status: 403 };
    }

    if (!(await canUseFacturacionForUser(auth.userId, auth.tenantId))) {
      return {
        ok: false,
        error: 'La facturación electrónica no está habilitada para esta cuenta',
        status: 403,
      };
    }

    const { data: config } = await supabaseAdmin
      .from('tenant_arca_config')
      .select('*')
      .eq('tenant_id', auth.tenantId)
      .maybeSingle();

    if (!config || !config.cert_pem || !config.key_encrypted) {
      return {
        ok: false,
        error: 'Debes cargar el Certificado Digital (.crt) y la Clave Privada (.key) antes de probar la conexión',
        status: 400,
      };
    }

    if (isSandboxConfig(config)) {
      await supabaseAdmin
        .from('tenant_arca_config')
        .update({
          is_active: true,
          last_tested_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', config.id);

      return {
        ok: true,
        data: {
          serverHealth: {
            appServer: 'OK (Sandbox)',
            dbServer: 'OK (Sandbox)',
            authServer: 'OK (Sandbox)',
          },
          lastVoucher: 1,
          environment: 'homologacion',
          puntoVenta: config.punto_venta || 1,
        },
        status: 200,
      };
    }

    const env = config.environment as ArcaEnvironment;
    const serverHealth = await checkWsfeHealth(env);

    // Renovar o validar WSAA
    const authTicket = await getOrRenewWsaaToken(config);

    // Obtener último comprobante para probar WSFE (Factura B tipo 6 o Factura C tipo 11)
    const cuitNum = parseInt(config.cuit.replace(/\D/g, ''), 10);
    const cbteTipoTest: ArcaVoucherType = 11; // Factura C por defecto para test
    let lastVoucher = 0;

    try {
      lastVoucher = await getLastAuthorizedVoucher(env, { ...authTicket, cuit: cuitNum }, config.punto_venta, cbteTipoTest);
    } catch {
      // Si falla con tipo 11, probar con tipo 6 (Factura B)
      lastVoucher = await getLastAuthorizedVoucher(env, { ...authTicket, cuit: cuitNum }, config.punto_venta, 6);
    }

    // Conexión exitosa
    await supabaseAdmin
      .from('tenant_arca_config')
      .update({
        is_active: true,
        last_tested_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('id', config.id);

    return {
      ok: true,
      data: {
        serverHealth,
        lastVoucher,
        environment: env,
        puntoVenta: config.punto_venta,
      },
      status: 200,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error de conexión con ARCA';

    // Registrar error
    await supabaseAdmin
      .from('tenant_arca_config')
      .update({
        is_active: false,
        last_tested_at: new Date().toISOString(),
        last_error: msg,
      })
      .eq('tenant_id', auth.tenantId);

    return { ok: false, error: msg, status: 500 };
  }
}

/**
 * Determina el tipo de comprobante según la condición del emisor y del receptor.
 *
 * La serie válida la fija el EMISOR, así que su condición manda sobre lo que
 * se pidió: un Responsable Inscripto nunca emite serie C, y un monotributista
 * (o exento / no inscripto) nunca emite serie A ni B. Si lo pedido no es
 * válido para el emisor se cae al tipo correcto.
 */
export function resolveVoucherType(
  emisorCondition: string,
  receptorCondition: string,
  requestedType?: string
): { voucherType: ArcaVoucherType; invoiceTypeStr: string } {
  // Responsable Inscripto: serie A (1/2/3) y B (6/7/8).
  if (emisorCondition === 'responsable_inscripto') {
    if (requestedType && VOUCHER_TYPE_CODES[requestedType] !== undefined) {
      const esSerieA_B = ['A', 'ND_A', 'NC_A', 'B', 'ND_B', 'NC_B'].includes(requestedType);
      if (esSerieA_B) {
        return { voucherType: VOUCHER_TYPE_CODES[requestedType], invoiceTypeStr: requestedType };
      }
    }

    // Sin tipo pedido válido: A para Responsable Inscripto, B para el resto.
    if (receptorCondition === 'responsable_inscripto') {
      return { voucherType: 1, invoiceTypeStr: 'A' };
    }
    return { voucherType: 6, invoiceTypeStr: 'B' };
  }

  // Emisor Monotributista / Exento / No Inscripto: solo serie C (11/12/13).
  if (requestedType && VOUCHER_TYPE_CODES[requestedType] !== undefined) {
    const esSerieC = ['C', 'ND_C', 'NC_C'].includes(requestedType);
    if (esSerieC) {
      return { voucherType: VOUCHER_TYPE_CODES[requestedType], invoiceTypeStr: requestedType };
    }
  }

  return { voucherType: 11, invoiceTypeStr: 'C' };
}

/**
 * Creates an electronic invoice with ARCA authorization (CAE).
 */
export async function createElectronicInvoice(
  auth: AuthInfo,
  payload: CreateElectronicInvoiceRequest
): Promise<ServiceResult<ElectronicInvoiceRecord>> {
  try {
    // Feature en pruebas: sólo la cuenta admin puede emitir (el sidebar y el
    // checkout la ocultan, pero la decisión que vale es esta). Fail closed.
    if (!(await canUseFacturacionForUser(auth.userId, auth.tenantId))) {
      return {
        ok: false,
        error: 'La facturación electrónica no está habilitada para esta cuenta',
        status: 403,
      };
    }

    // Las Notas de Crédito no se emiten "sueltas": deben acreditar una factura
    // existente (CbtesAsoc). Se emiten exclusivamente por createCreditNote.
    if (payload.invoice_type && payload.invoice_type.startsWith('NC_')) {
      return {
        ok: false,
        error: 'Las Notas de Crédito se emiten acreditando una factura existente',
        status: 400,
      };
    }

    // Idempotencia por venta: un reintento del checkout (timeout, doble click)
    // no debe emitir un segundo comprobante. Si la venta ya tiene un comprobante
    // aprobado, se devuelve ese. Si ese comprobante fue anulado por una Nota de
    // Crédito, se rechaza para no emitir uno nuevo (sería doble facturación).
    if (payload.sale_id) {
      const { data: existing } = await supabaseAdmin
        .from('electronic_invoices')
        .select('id, status')
        .eq('tenant_id', auth.tenantId)
        .eq('sale_id', payload.sale_id)
        .in('status', ['approved', 'cancelled'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        if (existing.status === 'cancelled') {
          return {
            ok: false,
            error: 'La venta ya fue facturada y el comprobante fue anulado por una Nota de Crédito',
            status: 409,
          };
        }
        const existingResult = await getElectronicInvoiceById(auth, existing.id);
        if (existingResult.ok) return { ok: true, data: existingResult.data, status: 200 };
      }
    }

    if (!payload.items || payload.items.length === 0) {
      return { ok: false, error: 'La factura debe tener al menos un ítem', status: 400 };
    }

    const { data: config } = await supabaseAdmin
      .from('tenant_arca_config')
      .select('*')
      .eq('tenant_id', auth.tenantId)
      .maybeSingle();

    if (!config || !config.is_active || !config.cert_pem || !config.key_encrypted) {
      return {
        ok: false,
        error: 'ARCA no está configurado o activo en esta empresa. Verificá la conexión en Ajustes > Empresa.',
        status: 400,
      };
    }

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('iva_condition, razon_social, company_name')
      .eq('id', auth.tenantId)
      .single();

    const emisorCondition = tenant?.iva_condition || 'responsable_inscripto';
    const receptorCondition = payload.iva_condition || 'consumidor_final';

    const { voucherType, invoiceTypeStr } = resolveVoucherType(
      emisorCondition,
      receptorCondition,
      payload.invoice_type
    );

    // Resolver tipo de documento del receptor
    let docTipo = 99; // Sin identificar
    let docNro = 0;

    if (payload.document_number && payload.document_number.trim().length > 0) {
      const cleanDoc = payload.document_number.replace(/\D/g, '');
      docNro = parseInt(cleanDoc, 10) || 0;

      if (payload.document_type === 'CUIT') docTipo = DOC_TYPE_CODES.CUIT;
      else if (payload.document_type === 'CUIL') docTipo = DOC_TYPE_CODES.CUIL;
      else if (payload.document_type === 'DNI') docTipo = DOC_TYPE_CODES.DNI;
      else if (cleanDoc.length === 11) docTipo = DOC_TYPE_CODES.CUIT;
      else if (cleanDoc.length >= 7) docTipo = DOC_TYPE_CODES.DNI;
    }

    // Cálculo de montos en centavos y pesos
    let totalCents = 0;
    let netCents = 0;
    let ivaCents = 0;

    // La factura se emite por el importe final de la venta. El descuento/recargo
    // se reparte proporcionalmente entre los ítems para que la suma de los
    // netos + IVA coincida exactamente con lo cobrado.
    const lineTotals = payload.items.map((item) => item.quantity * item.unit_price_cents);
    const discountShares = allocateProportionally(lineTotals, Math.max(0, Math.round(payload.discount_cents || 0)));
    const surchargeShares = allocateProportionally(lineTotals, Math.max(0, Math.round(payload.surcharge_cents || 0)));
    const effectiveLineTotals = lineTotals.map((lineTotal, i) =>
      Math.max(0, lineTotal - discountShares[i] + surchargeShares[i])
    );

    // Alícuotas agrupadas para ARCA
    const ivaMap = new Map<number, { baseImp: number; importe: number }>();

    for (let i = 0; i < payload.items.length; i++) {
      const item = payload.items[i];
      const lineTotal = effectiveLineTotals[i];
      totalCents += lineTotal;

      if (voucherType === 11) {
        // Factura C (Monotributo): no discrimina IVA
        netCents += lineTotal;
      } else {
        // Factura A o B: calcula neto e IVA (por defecto 21%)
        const rate = item.iva_percentage !== undefined ? item.iva_percentage : 21;
        const lineNet = Math.round(lineTotal / (1 + rate / 100));
        const lineIva = lineTotal - lineNet;

        netCents += lineNet;
        ivaCents += lineIva;

        const current = ivaMap.get(rate) || { baseImp: 0, importe: 0 };
        current.baseImp += lineNet / 100;
        current.importe += lineIva / 100;
        ivaMap.set(rate, current);
      }
    }

    const ivaList: ArcaIvaItem[] = [];
    if (voucherType !== 11) {
      for (const [rate, val] of ivaMap.entries()) {
        const id = PERCENTAGE_TO_IVA_ID[rate] || 5;
        ivaList.push({
          Id: id,
          BaseImp: Number(val.baseImp.toFixed(2)),
          Importe: Number(val.importe.toFixed(2)),
        });
      }
    }

    const impTotal = totalCents / 100;
    const impNeto = voucherType === 11 ? impTotal : netCents / 100;
    const impIva = voucherType === 11 ? 0 : ivaCents / 100;
    const cuitNum = parseInt(config.cuit.replace(/\D/g, ''), 10) || 20409378472;

    let nextNum = 1;
    let cae = '';
    let caeFchVto = '';

    if (isSandboxConfig(config)) {
      const { data: lastInv } = await supabaseAdmin
        .from('electronic_invoices')
        .select('invoice_number')
        .eq('tenant_id', auth.tenantId)
        .eq('punto_venta', config.punto_venta)
        .eq('invoice_type', invoiceTypeStr)
        .order('invoice_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      nextNum = (lastInv?.invoice_number || 0) + 1;
      cae = '74' + String(Date.now()).slice(-8) + String(Math.floor(1000 + Math.random() * 9000));
      const vtoDate = new Date(Date.now() + 10 * 24 * 3600 * 1000);
      caeFchVto = toArgentinaDateCompact(vtoDate);
    } else {
      const env = config.environment as ArcaEnvironment;
      const authTicket = await getOrRenewWsaaToken(config);

      // Obtener siguiente número correlativo
      const lastNum = await getLastAuthorizedVoucher(env, { ...authTicket, cuit: cuitNum }, config.punto_venta, voucherType);
      nextNum = lastNum + 1;

      const fechaCbte = toArgentinaDateCompact();

      // Solicitar CAE
      const res = await authorizeElectronicInvoice(
        env,
        { ...authTicket, cuit: cuitNum },
        {
          ptoVta: config.punto_venta,
          cbteTipo: voucherType,
          concepto: (payload.concept || config.concept || 1) as 1 | 2 | 3,
          docTipo,
          docNro,
          cbteNro: nextNum,
          fechaCbte,
          impTotal,
          impNeto,
          impOpEx: 0,
          impTrib: 0,
          impIva,
          iva: ivaList.length > 0 ? ivaList : undefined,
          condicionIvaReceptorId: CONDICION_IVA_RECEPTOR_ID[receptorCondition] ?? 5,
        }
      );

      if (res.resultado !== 'A' || !res.cae) {
        const errMsg = res.errores?.map((e) => e.mensaje).join(' | ') || 'ARCA rechazó el comprobante';
        return { ok: false, error: errMsg, status: 400 };
      }

      cae = res.cae;
      caeFchVto = res.caeFchVto || '';
    }

    // Generar URL del QR oficial
    const qrUrl = buildArcaQrUrl({
      ver: 1,
      fecha: toArgentinaDate(),
      cuit: cuitNum,
      ptoVta: config.punto_venta,
      tipoCmp: voucherType,
      nroCmp: nextNum,
      importe: impTotal,
      moneda: 'PES',
      ctz: 1,
      tipoDocRec: docTipo,
      nroDocRec: docNro,
      tipoCodAut: 'E',
      codAut: parseInt(cae, 10),
    });

    // Guardar en tabla electronic_invoices
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('electronic_invoices')
      .insert({
        tenant_id: auth.tenantId,
        sale_id: payload.sale_id || null,
        invoice_number: nextNum,
        punto_venta: config.punto_venta,
        invoice_type: invoiceTypeStr,
        cuit_emisor: config.cuit,
        cuit_receptor: docTipo === 80 ? String(docNro) : null,
        customer_id: payload.customer_id || null,
        customer_name: payload.customer_name,
        document_type: payload.document_type || (docTipo === 80 ? 'CUIT' : 'DNI'),
        document_number: docNro > 0 ? String(docNro) : null,
        iva_condition: receptorCondition,
        total_cents: totalCents,
        net_cents: netCents,
        iva_cents: ivaCents,
        iva_percentage: voucherType === 11 ? 0 : 21,
        other_taxes_cents: 0,
        cae: cae,
        cae_due_date: caeFchVto,
        afip_result: 'A',
        afip_response: { sandbox: isSandboxConfig(config), authorized_at: new Date().toISOString() },
        status: 'approved',
        created_by: auth.userId,
      })
      .select('*')
      .single();

    if (insertErr || !inserted) {
      logger.error('Error saving authorized electronic invoice to database', { insertErr });
      return { ok: false, error: 'Comprobante autorizado en ARCA pero ocurrió un error al guardarlo', status: 500 };
    }

    // Insertar ítems
    const invoiceItems = payload.items.map((it, i) => {
      const lineTotal = effectiveLineTotals[i];
      const rate = voucherType === 11 ? 0 : (it.iva_percentage !== undefined ? it.iva_percentage : 21);
      const lineNet = voucherType === 11 ? lineTotal : Math.round(lineTotal / (1 + rate / 100));
      const lineIva = lineTotal - lineNet;

      return {
        invoice_id: inserted.id,
        product_id: it.product_id || null,
        description: it.description,
        quantity: it.quantity,
        unit_price_cents: it.unit_price_cents,
        subtotal_cents: lineTotal,
        iva_percentage: rate,
        iva_cents: lineIva,
      };
    });

    await supabaseAdmin.from('invoice_items').insert(invoiceItems);

    return {
      ok: true,
      data: {
        ...inserted,
        is_sandbox: isSandboxConfig(config),
        qr_url: qrUrl,
      },
      status: 201,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al emitir factura electrónica';
    return { ok: false, error: msg, status: 500 };
  }
}

/**
 * Resuelve el código de tipo de documento de ARCA a partir de la fila
 * almacenada. La columna `document_type` puede venir como 'SinIdentificar'
 * aunque el número tenga 11 dígitos, así que se cae al largo para deducirlo.
 */
function resolveDocTypeCode(documentType?: string | null, documentNumber?: string | null): number {
  if (documentType === 'CUIT') return DOC_TYPE_CODES.CUIT;
  if (documentType === 'CUIL') return DOC_TYPE_CODES.CUIL;
  if (documentType === 'DNI') return DOC_TYPE_CODES.DNI;

  const clean = (documentNumber || '').replace(/\D/g, '');
  if (clean.length === 11) return DOC_TYPE_CODES.CUIT;
  if (clean.length >= 7) return DOC_TYPE_CODES.DNI;
  return DOC_TYPE_CODES.ConsumidorFinal;
}

/**
 * Emite una Nota de Crédito que acredita una factura aprobada. La NC se emite
 * por el mismo importe y referencia al comprobante original (CbtesAsoc). Al
 * aprobarse, la factura original queda marcada como `cancelled`.
 *
 * Un reintento sobre una factura ya acreditada devuelve la NC existente.
 */
export async function createCreditNote(
  auth: AuthInfo,
  originalInvoiceId: string
): Promise<ServiceResult<ElectronicInvoiceRecord>> {
  try {
    // Mismo guard que la emisión: la feature es sólo para la cuenta admin
    // mientras dure la prueba.
    if (!(await canUseFacturacionForUser(auth.userId, auth.tenantId))) {
      return {
        ok: false,
        error: 'La facturación electrónica no está habilitada para esta cuenta',
        status: 403,
      };
    }

    const { data: original, error } = await supabaseAdmin
      .from('electronic_invoices')
      .select('*, items:invoice_items(*)')
      .eq('id', originalInvoiceId)
      .eq('tenant_id', auth.tenantId)
      .single();

    if (error || !original) {
      return { ok: false, error: 'Comprobante no encontrado', status: 404 };
    }

    if (original.status !== 'approved') {
      return {
        ok: false,
        error: 'Solo se puede emitir una Nota de Crédito de un comprobante aprobado',
        status: 400,
      };
    }

    // Idempotencia: una factura no puede acreditarse dos veces.
    const { data: existingNc } = await supabaseAdmin
      .from('electronic_invoices')
      .select('id')
      .eq('tenant_id', auth.tenantId)
      .eq('related_invoice_id', originalInvoiceId)
      .eq('status', 'approved')
      .limit(1)
      .maybeSingle();
    if (existingNc?.id) {
      const got = await getElectronicInvoiceById(auth, existingNc.id);
      if (got.ok) return { ok: true, data: got.data, status: 200 };
    }

    const ncTypeStr = resolveCreditNoteType(original.invoice_type);
    if (!ncTypeStr) {
      return { ok: false, error: 'Solo se pueden acreditar Facturas A, B o C', status: 400 };
    }

    const { data: config } = await supabaseAdmin
      .from('tenant_arca_config')
      .select('*')
      .eq('tenant_id', auth.tenantId)
      .maybeSingle();

    if (!config || !config.is_active || !config.cert_pem || !config.key_encrypted) {
      return {
        ok: false,
        error: 'ARCA no está configurado o activo en esta empresa. Verificá la conexión en Ajustes > Empresa.',
        status: 400,
      };
    }

    const voucherType = VOUCHER_TYPE_CODES[ncTypeStr];
    const originalVoucherType = VOUCHER_TYPE_CODES[original.invoice_type];
    const cuitNum = parseInt((config.cuit || '').replace(/\D/g, ''), 10) || 0;

    const docTipo = resolveDocTypeCode(original.document_type, original.document_number);
    const docNro = parseInt((original.document_number || '').replace(/\D/g, ''), 10) || 0;

    // La NC se emite por el mismo importe que la factura original: las notas de
    // crédito llevan importes positivos y se las distingue por el tipo (3/8/13).
    const impTotal = original.total_cents / 100;
    const impNeto = voucherType === 11 ? impTotal : original.net_cents / 100;
    const impIva = voucherType === 11 ? 0 : original.iva_cents / 100;

    const ivaList: ArcaIvaItem[] = [];
    if (voucherType !== 11) {
      const grouped = new Map<number, { baseImp: number; importe: number }>();
      for (const it of (original.items || []) as Array<Record<string, unknown>>) {
        const rate = Number(it.iva_percentage) || 0;
        const itemIva = Number(it.iva_cents) || 0;
        const itemNet = Number(it.subtotal_cents) - itemIva;
        const cur = grouped.get(rate) || { baseImp: 0, importe: 0 };
        cur.baseImp += itemNet / 100;
        cur.importe += itemIva / 100;
        grouped.set(rate, cur);
      }
      for (const [rate, val] of grouped.entries()) {
        ivaList.push({
          Id: PERCENTAGE_TO_IVA_ID[rate] || 5,
          BaseImp: Number(val.baseImp.toFixed(2)),
          Importe: Number(val.importe.toFixed(2)),
        });
      }
    }

    let nextNum = 1;
    let cae = '';
    let caeFchVto = '';

    if (isSandboxConfig(config)) {
      const { data: lastInv } = await supabaseAdmin
        .from('electronic_invoices')
        .select('invoice_number')
        .eq('tenant_id', auth.tenantId)
        .eq('punto_venta', config.punto_venta)
        .eq('invoice_type', ncTypeStr)
        .order('invoice_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      nextNum = (lastInv?.invoice_number || 0) + 1;
      cae = '74' + String(Date.now()).slice(-8) + String(Math.floor(1000 + Math.random() * 9000));
      caeFchVto = toArgentinaDateCompact(new Date(Date.now() + 10 * 24 * 3600 * 1000));
    } else {
      const env = config.environment as ArcaEnvironment;
      const authTicket = await getOrRenewWsaaToken(config);

      const lastNum = await getLastAuthorizedVoucher(env, { ...authTicket, cuit: cuitNum }, config.punto_venta, voucherType);
      nextNum = lastNum + 1;

      const res = await authorizeElectronicInvoice(
        env,
        { ...authTicket, cuit: cuitNum },
        {
          ptoVta: config.punto_venta,
          cbteTipo: voucherType,
          concepto: (config.concept || 1) as 1 | 2 | 3,
          docTipo,
          docNro,
          cbteNro: nextNum,
          fechaCbte: toArgentinaDateCompact(),
          impTotal,
          impNeto,
          impOpEx: 0,
          impTrib: 0,
          impIva,
          iva: ivaList.length > 0 ? ivaList : undefined,
          condicionIvaReceptorId: CONDICION_IVA_RECEPTOR_ID[original.iva_condition] ?? 5,
          cbtesAsoc: [
            {
              tipo: originalVoucherType,
              ptoVta: original.punto_venta,
              nro: original.invoice_number,
              cuit: cuitNum,
            },
          ],
        }
      );

      if (res.resultado !== 'A' || !res.cae) {
        const errMsg = res.errores?.map((e) => e.mensaje).join(' | ') || 'ARCA rechazó la Nota de Crédito';
        return { ok: false, error: errMsg, status: 400 };
      }

      cae = res.cae;
      caeFchVto = res.caeFchVto || '';
    }

    const qrUrl = buildArcaQrUrl({
      ver: 1,
      fecha: toArgentinaDate(),
      cuit: cuitNum,
      ptoVta: config.punto_venta,
      tipoCmp: voucherType,
      nroCmp: nextNum,
      importe: impTotal,
      moneda: 'PES',
      ctz: 1,
      tipoDocRec: docTipo,
      nroDocRec: docNro,
      tipoCodAut: 'E',
      codAut: parseInt(cae, 10),
      cbteAsoc: {
        tipo: originalVoucherType,
        ptoVta: original.punto_venta,
        nro: original.invoice_number,
        cuit: cuitNum,
      },
    });

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('electronic_invoices')
      .insert({
        tenant_id: auth.tenantId,
        sale_id: null,
        related_invoice_id: original.id,
        invoice_number: nextNum,
        punto_venta: config.punto_venta,
        invoice_type: ncTypeStr,
        cuit_emisor: config.cuit,
        cuit_receptor: docTipo === 80 ? String(docNro) : null,
        customer_id: original.customer_id || null,
        customer_name: original.customer_name,
        document_type: original.document_type,
        document_number: original.document_number,
        iva_condition: original.iva_condition,
        total_cents: original.total_cents,
        net_cents: original.net_cents,
        iva_cents: original.iva_cents,
        iva_percentage: original.iva_percentage,
        other_taxes_cents: 0,
        cae,
        cae_due_date: caeFchVto,
        afip_result: 'A',
        afip_response: {
          sandbox: isSandboxConfig(config),
          credit_note_for: original.id,
          authorized_at: new Date().toISOString(),
        },
        status: 'approved',
        created_by: auth.userId,
      })
      .select('*')
      .single();

    if (insertErr || !inserted) {
      logger.error('Error saving authorized credit note to database', { insertErr });
      return {
        ok: false,
        error: 'Nota de Crédito autorizada en ARCA pero ocurrió un error al guardarla',
        status: 500,
      };
    }

    const originalItems = (original.items || []) as Array<Record<string, unknown>>;
    if (originalItems.length > 0) {
      await supabaseAdmin.from('invoice_items').insert(
        originalItems.map((it) => ({
          invoice_id: inserted.id,
          product_id: (it.product_id as string) || null,
          description: it.description as string,
          quantity: it.quantity as number,
          unit_price_cents: it.unit_price_cents as number,
          subtotal_cents: it.subtotal_cents as number,
          iva_percentage: it.iva_percentage as number,
          iva_cents: it.iva_cents as number,
        }))
      );
    }

    // La factura original queda anulada por la NC.
    await supabaseAdmin
      .from('electronic_invoices')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', original.id)
      .eq('tenant_id', auth.tenantId);

    return { ok: true, data: { ...inserted, is_sandbox: isSandboxConfig(config), qr_url: qrUrl }, status: 201 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al emitir Nota de Crédito';
    return { ok: false, error: msg, status: 500 };
  }
}

/**
 * Lists electronic invoices for the tenant.
 */
export async function listElectronicInvoices(
  auth: AuthInfo,
  options?: {
    limit?: number;
    offset?: number;
    status?: string;
  }
): Promise<ServiceResult<{ invoices: ElectronicInvoiceRecord[]; total: number }>> {
  try {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    let query = supabaseAdmin
      .from('electronic_invoices')
      .select('*', { count: 'exact' })
      .eq('tenant_id', auth.tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (options?.status) {
      query = query.eq('status', options.status);
    }

    const { data, count, error } = await query;

    if (error) {
      logger.error('Error listing electronic invoices', { error });
      return { ok: false, error: 'Error al listar facturas', status: 500 };
    }

    const invoices = (data || []).map((inv) => {
      const cuitNum = parseInt((inv.cuit_emisor || '').replace(/\D/g, ''), 10);
      const docNro = parseInt((inv.document_number || '').replace(/\D/g, ''), 10) || 0;
      const docTipo = inv.document_type === 'CUIT' ? 80 : (inv.document_type === 'DNI' ? 96 : 99);
      const voucherType = VOUCHER_TYPE_CODES[inv.invoice_type] || 6;

      const qrUrl = inv.cae
        ? buildArcaQrUrl({
            ver: 1,
            fecha: toArgentinaDate(inv.created_at),
            cuit: cuitNum,
            ptoVta: inv.punto_venta,
            tipoCmp: voucherType,
            nroCmp: inv.invoice_number,
            importe: inv.total_cents / 100,
            moneda: 'PES',
            ctz: 1,
            tipoDocRec: docTipo,
            nroDocRec: docNro,
            tipoCodAut: 'E',
            codAut: parseInt(inv.cae, 10) || 0,
          })
        : undefined;

      return {
        ...inv,
        is_sandbox: isSandboxInvoice(inv),
        qr_url: qrUrl,
      };
    });

    return {
      ok: true,
      data: {
        invoices,
        total: count || 0,
      },
      status: 200,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al listar comprobantes';
    return { ok: false, error: msg, status: 500 };
  }
}

/**
 * Gets a single electronic invoice by ID with items and QR data URL.
 */
export async function getElectronicInvoiceById(
  auth: AuthInfo,
  invoiceId: string
): Promise<ServiceResult<ElectronicInvoiceRecord & { qr_data_url?: string }>> {
  try {
    const { data: invoice, error } = await supabaseAdmin
      .from('electronic_invoices')
      .select('*, items:invoice_items(*)')
      .eq('id', invoiceId)
      .eq('tenant_id', auth.tenantId)
      .single();

    if (error || !invoice) {
      return { ok: false, error: 'Factura no encontrada', status: 404 };
    }

    const cuitNum = parseInt((invoice.cuit_emisor || '').replace(/\D/g, ''), 10);
    const docNro = parseInt((invoice.document_number || '').replace(/\D/g, ''), 10) || 0;
    const docTipo = invoice.document_type === 'CUIT' ? 80 : (invoice.document_type === 'DNI' ? 96 : 99);
    const voucherType = VOUCHER_TYPE_CODES[invoice.invoice_type] || 6;

    let qrUrl: string | undefined;
    let qrDataUrl: string | undefined;

    // Las Notas de Crédito/Débito referencian en su QR el comprobante que
    // ajustan (RG 4540), por lo que se busca el original para asociarlo.
    let cbteAsoc: { tipo: number; ptoVta: number; nro: number; cuit?: number } | undefined;
    if (invoice.related_invoice_id) {
      const { data: original } = await supabaseAdmin
        .from('electronic_invoices')
        .select('invoice_type, punto_venta, invoice_number, cuit_emisor')
        .eq('id', invoice.related_invoice_id)
        .eq('tenant_id', auth.tenantId)
        .maybeSingle();
      if (original) {
        cbteAsoc = {
          tipo: VOUCHER_TYPE_CODES[original.invoice_type] || 6,
          ptoVta: original.punto_venta,
          nro: original.invoice_number,
          cuit: parseInt((original.cuit_emisor || '').replace(/\D/g, ''), 10) || cuitNum,
        };
      }
    }

    if (invoice.cae) {
      qrUrl = buildArcaQrUrl({
        ver: 1,
        fecha: toArgentinaDate(invoice.created_at),
        cuit: cuitNum,
        ptoVta: invoice.punto_venta,
        tipoCmp: voucherType,
        nroCmp: invoice.invoice_number,
        importe: invoice.total_cents / 100,
        moneda: 'PES',
        ctz: 1,
        tipoDocRec: docTipo,
        nroDocRec: docNro,
        tipoCodAut: 'E',
        codAut: parseInt(invoice.cae, 10) || 0,
        cbteAsoc,
      });

      try {
        qrDataUrl = await generateQrImageDataUrl(qrUrl);
      } catch {
        // Fallback gracefully without data URL
      }
    }

    return {
      ok: true,
      data: {
        ...invoice,
        is_sandbox: isSandboxInvoice(invoice),
        qr_url: qrUrl,
        qr_data_url: qrDataUrl,
      },
      status: 200,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al obtener comprobante';
    return { ok: false, error: msg, status: 500 };
  }
}
