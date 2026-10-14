import { describe, it, expect } from 'vitest';
import { buildArcaQrUrl, generateQrImageDataUrl, type ArcaQrData } from './qr';

describe('arca qr generator', () => {
  it('generates a valid ARCA QR URL with base64 encoded data', () => {
    const data: ArcaQrData = {
      ver: 1,
      fecha: '2026-10-14',
      cuit: 20123456789,
      ptoVta: 1,
      tipoCmp: 6,
      nroCmp: 105,
      importe: 12500.5,
      moneda: 'PES',
      ctz: 1,
      tipoDocRec: 96,
      nroDocRec: 35123456,
      tipoCodAut: 'E',
      codAut: 74123456789012,
    };

    const url = buildArcaQrUrl(data);
    expect(url).toContain('https://www.afip.gob.ar/fe/qr/?p=');

    const base64Part = url.replace('https://www.afip.gob.ar/fe/qr/?p=', '');
    const decoded = JSON.parse(Buffer.from(base64Part, 'base64').toString('utf8'));

    expect(decoded.ver).toBe(1);
    expect(decoded.cuit).toBe(20123456789);
    expect(decoded.ptoVta).toBe(1);
    expect(decoded.tipoCmp).toBe(6);
    expect(decoded.nroCmp).toBe(105);
    expect(decoded.codAut).toBe(74123456789012);
  });

  it('incluye el comprobante asociado (cbteAsoc) en Notas de Crédito/Débito', () => {
    const data: ArcaQrData = {
      ver: 1,
      fecha: '2026-10-14',
      cuit: 20123456789,
      ptoVta: 1,
      tipoCmp: 8,
      nroCmp: 3,
      importe: 12500.5,
      moneda: 'PES',
      ctz: 1,
      tipoDocRec: 99,
      nroDocRec: 0,
      tipoCodAut: 'E',
      codAut: 74123456789012,
      cbteAsoc: { tipo: 6, ptoVta: 1, nro: 105, cuit: 20123456789 },
    };

    const base64Part = buildArcaQrUrl(data).replace('https://www.afip.gob.ar/fe/qr/?p=', '');
    const decoded = JSON.parse(Buffer.from(base64Part, 'base64').toString('utf8'));

    expect(decoded.cbteAsoc).toEqual({ tipo: 6, ptoVta: 1, nro: 105, cuit: 20123456789 });
  });

  it('omite cbteAsoc cuando no aplica', () => {
    const data: ArcaQrData = {
      ver: 1,
      fecha: '2026-10-14',
      cuit: 20123456789,
      ptoVta: 1,
      tipoCmp: 6,
      nroCmp: 105,
      importe: 100,
      moneda: 'PES',
      ctz: 1,
      tipoCodAut: 'E',
      codAut: 74123456789012,
    };

    const base64Part = buildArcaQrUrl(data).replace('https://www.afip.gob.ar/fe/qr/?p=', '');
    const decoded = JSON.parse(Buffer.from(base64Part, 'base64').toString('utf8'));

    expect(decoded).not.toHaveProperty('cbteAsoc');
  });

  it('generates a data url image from the URL', async () => {
    const url = 'https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjF9';
    const dataUrl = await generateQrImageDataUrl(url);

    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
