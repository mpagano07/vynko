import { MercadoPagoConfig, PreApproval } from 'mercadopago';

let _client: MercadoPagoConfig | null = null;

function getClient(): MercadoPagoConfig {
  if (_client) return _client;

  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      'MercadoPago access token is required. Ensure MERCADOPAGO_ACCESS_TOKEN is set in your environment variables.'
    );
  }

  _client = new MercadoPagoConfig({ accessToken: token });
  return _client;
}

export function createPreApproval(body: {
  payer_email: string;
  reason: string;
  back_url: string;
  external_reference: string;
  auto_recurring: {
    frequency: number;
    frequency_type: 'months';
    transaction_amount: number;
    currency_id: string;
  };
}) {
  const preApproval = new PreApproval(getClient());
  return preApproval.create({ body });
}

export function getPreApprovalById(id: string) {
  const preApproval = new PreApproval(getClient());
  return preApproval.get({ id });
}

export function cancelPreApproval(id: string) {
  const preApproval = new PreApproval(getClient());
  return preApproval.update({ id, body: { status: 'cancelled' } });
}

export function verifyMercadoPagoSignature(request: Request, dataId?: string): boolean {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('MERCADOPAGO_WEBHOOK_SECRET is not configured in environment variables.');
      return false;
    }
    // In dev mode without secret, log warning but allow bypass
    console.warn('MERCADOPAGO_WEBHOOK_SECRET is not set. Skipping signature verification in dev mode.');
    return true;
  }

  const xSignature = request.headers.get('x-signature');
  const xRequestId = request.headers.get('x-request-id');

  if (!xSignature || !xRequestId) {
    return false;
  }

  // x-signature format: "ts=1700000000,v1=hash..."
  const parts = xSignature.split(',');
  let ts = '';
  let v1 = '';

  for (const part of parts) {
    const [key, val] = part.trim().split('=');
    if (key === 'ts') ts = val;
    if (key === 'v1') v1 = val;
  }

  if (!ts || !v1) {
    return false;
  }

  // MercadoPago manifest format: id:<data.id>;request-id:<x-request-id>;ts:<ts>;
  const manifest = `id:${dataId || ''};request-id:${xRequestId};ts:${ts};`;

  try {
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(manifest);
    const hash = hmac.digest('hex');
    return hash === v1;
  } catch (err) {
    console.error('Error verifying MercadoPago signature:', err);
    return false;
  }
}

