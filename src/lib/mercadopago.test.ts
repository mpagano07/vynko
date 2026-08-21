import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { verifyMercadoPagoSignature } from './mercadopago';

function makeSignature(ts: string, secret: string, dataId: string, requestId: string): string {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(manifest);
  return hmac.digest('hex');
}

function makeRequest(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/webhooks/mercadopago', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
}

describe('verifyMercadoPagoSignature', () => {
  const SECRET = 'test-webhook-secret-123';
  const DATA_ID = 'preapproval-123';
  const REQUEST_ID = 'req-456';
  const nowSeconds = Math.floor(Date.now() / 1000);
  const TIMESTAMP = String(nowSeconds);

  beforeEach(() => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    vi.unstubAllEnvs();
  });

  it('returns true for a valid signature', () => {
    const v1 = makeSignature(TIMESTAMP, SECRET, DATA_ID, REQUEST_ID);
    const req = makeRequest({
      'x-signature': `ts=${TIMESTAMP},v1=${v1}`,
      'x-request-id': REQUEST_ID,
    });
    expect(verifyMercadoPagoSignature(req, DATA_ID)).toBe(true);
  });

  it('returns false when signature hash does not match', () => {
    const req = makeRequest({
      'x-signature': `ts=${TIMESTAMP},v1=0000000000000000000000000000000000000000000000000000000000000000`,
      'x-request-id': REQUEST_ID,
    });
    expect(verifyMercadoPagoSignature(req, DATA_ID)).toBe(false);
  });

  it('returns false when x-signature header is missing', () => {
    const req = makeRequest({ 'x-request-id': REQUEST_ID });
    expect(verifyMercadoPagoSignature(req, DATA_ID)).toBe(false);
  });

  it('returns false when x-request-id header is missing', () => {
    const req = makeRequest({ 'x-signature': `ts=${TIMESTAMP},v1=fake` });
    expect(verifyMercadoPagoSignature(req, DATA_ID)).toBe(false);
  });

  it('returns false when ts is missing from x-signature', () => {
    const req = makeRequest({
      'x-signature': `v1=fakehash`,
      'x-request-id': REQUEST_ID,
    });
    expect(verifyMercadoPagoSignature(req, DATA_ID)).toBe(false);
  });

  it('returns false when v1 is missing from x-signature', () => {
    const req = makeRequest({
      'x-signature': `ts=${TIMESTAMP}`,
      'x-request-id': REQUEST_ID,
    });
    expect(verifyMercadoPagoSignature(req, DATA_ID)).toBe(false);
  });

  it('bypasses verification in dev mode when MERCADOPAGO_WEBHOOK_SECRET is not set', () => {
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    vi.stubEnv('NODE_ENV', 'development');

    const req = makeRequest({});
    expect(verifyMercadoPagoSignature(req, DATA_ID)).toBe(true);
  });

  it('rejects in production when MERCADOPAGO_WEBHOOK_SECRET is not set', () => {
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    vi.stubEnv('NODE_ENV', 'production');

    const req = makeRequest({});
    expect(verifyMercadoPagoSignature(req, DATA_ID)).toBe(false);
  });

  it('works with empty dataId', () => {
    const v1 = makeSignature(TIMESTAMP, SECRET, '', REQUEST_ID);
    const req = makeRequest({
      'x-signature': `ts=${TIMESTAMP},v1=${v1}`,
      'x-request-id': REQUEST_ID,
    });
    expect(verifyMercadoPagoSignature(req)).toBe(true);
  });

  it('handles extra fields in x-signature gracefully', () => {
    const v1 = makeSignature(TIMESTAMP, SECRET, DATA_ID, REQUEST_ID);
    const req = makeRequest({
      'x-signature': `ts=${TIMESTAMP},v1=${v1},extra=ignored`,
      'x-request-id': REQUEST_ID,
    });
    expect(verifyMercadoPagoSignature(req, DATA_ID)).toBe(true);
  });

  it('rejects signatures older than 10 minutes', () => {
    const staleTs = String(nowSeconds - 11 * 60);
    const v1 = makeSignature(staleTs, SECRET, DATA_ID, REQUEST_ID);
    const req = makeRequest({
      'x-signature': `ts=${staleTs},v1=${v1}`,
      'x-request-id': REQUEST_ID,
    });
    expect(verifyMercadoPagoSignature(req, DATA_ID)).toBe(false);
  });

  it('accepts signatures within the clock skew window', () => {
    const recentTs = String(nowSeconds - 5 * 60);
    const v1 = makeSignature(recentTs, SECRET, DATA_ID, REQUEST_ID);
    const req = makeRequest({
      'x-signature': `ts=${recentTs},v1=${v1}`,
      'x-request-id': REQUEST_ID,
    });
    expect(verifyMercadoPagoSignature(req, DATA_ID)).toBe(true);
  });

  it('rejects timestamps too far in the future', () => {
    const futureTs = String(nowSeconds + 11 * 60);
    const v1 = makeSignature(futureTs, SECRET, DATA_ID, REQUEST_ID);
    const req = makeRequest({
      'x-signature': `ts=${futureTs},v1=${v1}`,
      'x-request-id': REQUEST_ID,
    });
    expect(verifyMercadoPagoSignature(req, DATA_ID)).toBe(false);
  });

  it('rejects non-hex v1 values', () => {
    const req = makeRequest({
      'x-signature': `ts=${TIMESTAMP},v1=zzzz-not-hex-at-all!!!!!!!!!!!!!!!!!!!!!!!!`,
      'x-request-id': REQUEST_ID,
    });
    expect(verifyMercadoPagoSignature(req, DATA_ID)).toBe(false);
  });

  it('rejects truncated v1 values (length mismatch)', () => {
    const v1 = makeSignature(TIMESTAMP, SECRET, DATA_ID, REQUEST_ID).slice(0, 32);
    const req = makeRequest({
      'x-signature': `ts=${TIMESTAMP},v1=${v1}`,
      'x-request-id': REQUEST_ID,
    });
    expect(verifyMercadoPagoSignature(req, DATA_ID)).toBe(false);
  });
});
