import QRCode from 'qrcode';

export interface ArcaQrData {
  ver: number; // 1
  fecha: string; // YYYY-MM-DD
  cuit: number; // CUIT emisor
  ptoVta: number; // Punto de venta
  tipoCmp: number; // Tipo de comprobante
  nroCmp: number; // Número de comprobante
  importe: number; // Importe total con 2 decimales
  moneda: string; // 'PES'
  ctz: number; // Cotización (1 para pesos)
  tipoDocRec?: number; // 80 (CUIT), 96 (DNI), 99 (Consumidor final)
  nroDocRec?: number; // Número de documento del receptor
  tipoCodAut: 'E'; // 'E' para CAE
  codAut: number; // Número de CAE de 14 dígitos
  // Comprobante asociado (RG 4540). Presente en Notas de Crédito/Débito, que
  // referencian el comprobante original.
  cbteAsoc?: {
    tipo: number;
    ptoVta: number;
    nro: number;
    cuit?: number;
  };
}

/**
 * Builds the official ARCA URL containing the base64-encoded JSON payload as required by RG 4291/2018.
 */
export function buildArcaQrUrl(data: ArcaQrData): string {
  const jsonStr = JSON.stringify(data);
  const base64 = Buffer.from(jsonStr, 'utf8').toString('base64');
  return `https://www.afip.gob.ar/fe/qr/?p=${base64}`;
}

/**
 * Generates a base64 PNG data-url for the official ARCA QR code.
 */
export async function generateQrImageDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 256,
  });
}
