import forge from 'node-forge';
import type { ArcaEnvironment, ArcaVoucherType, ArcaIvaItem } from '@/lib/types/arca';

const ENDPOINTS = {
  homologacion: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  },
  produccion: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  },
};

export interface WsaaAuthTicket {
  token: string;
  sign: string;
  expirationTime: string;
}

export interface FecaeRequestData {
  ptoVta: number;
  cbteTipo: ArcaVoucherType;
  concepto: 1 | 2 | 3;
  docTipo: number;
  docNro: number;
  cbteNro: number;
  fechaCbte: string; // YYYYMMDD
  impTotal: number;
  impNeto: number;
  impOpEx: number;
  impTrib: number;
  impIva: number;
  iva?: ArcaIvaItem[];
  // Condición frente al IVA del receptor (RG 5616). Debe informarse para que
  // ARCA acepte el comprobante: 1=RI, 4=Exento, 5=Consumidor Final, 6=Monotributo.
  condicionIvaReceptorId?: number;
  // Comprobantes asociados (RG 4540). Se usa para emitir Notas de Crédito que
  // referencian la factura original que acreditan.
  cbtesAsoc?: {
    tipo: ArcaVoucherType;
    ptoVta: number;
    nro: number;
    cuit?: number;
  }[];
}

export interface FecaeResponseData {
  resultado: 'A' | 'R';
  cae?: string;
  caeFchVto?: string;
  cbteNro: number;
  puntoVenta: number;
  cbteTipo: ArcaVoucherType;
  errores?: { codigo: number; mensaje: string }[];
  observaciones?: { codigo: number; mensaje: string }[];
}

/**
 * Decodes the XML entities that ARCA uses when it embeds the login ticket
 * XML (escaped) inside the SOAP <loginCmsReturn> element. `&amp;` must be
 * decoded last to avoid double-decoding.
 */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Extracts inner text of an XML tag safely.
 */
function getTagValue(xml: string, tagName: string): string | null {
  const match = new RegExp(`<(?:\w+:)?${tagName}[^>]*>([\\s\\S]*?)<\\/(?:\w+:)?${tagName}>`, 'i').exec(xml);
  return match ? match[1].trim() : null;
}

/**
 * Parses multiple error/observation tags from ARCA responses.
 */
function parseCodeMessageList(xml: string, containerTag: string): { codigo: number; mensaje: string }[] {
  const results: { codigo: number; mensaje: string }[] = [];
  const containerMatch = new RegExp(`<(?:\w+:)?${containerTag}[^>]*>([\\s\\S]*?)<\\/(?:\w+:)?${containerTag}>`, 'i').exec(xml);
  if (!containerMatch) return results;

  const inner = containerMatch[1];
  const itemRegex = /<(?:\w+:)?(?:Err|Obs)[^>]*>([\s\S]*?)<\/(?:\w+:)?(?:Err|Obs)>/gi;
  let itemMatch: RegExpExecArray | null;

  while ((itemMatch = itemRegex.exec(inner)) !== null) {
    const code = getTagValue(itemMatch[1], 'Code') || getTagValue(itemMatch[1], 'codigo');
    const msg = getTagValue(itemMatch[1], 'Msg') || getTagValue(itemMatch[1], 'mensaje');
    if (code && msg) {
      results.push({ codigo: parseInt(code, 10), mensaje: msg });
    }
  }

  return results;
}

/**
 * Generates and signs a Login Ticket Request (TRA) using PKCS#7 / CMS (node-forge).
 */
export function createSignedLoginTicket(certPem: string, keyPem: string): string {
  const now = Date.now();
  // Compensar posible desincronización de reloj con ARCA (10 minutos antes y después)
  const genTime = new Date(now - 10 * 60 * 1000).toISOString();
  const expTime = new Date(now + 10 * 60 * 1000).toISOString();
  const uniqueId = Math.floor(now / 1000);

  const traXml = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${genTime}</generationTime>
    <expirationTime>${expTime}</expirationTime>
  </header>
  <service>wsfe</service>
</loginTicketRequest>`.trim();

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(traXml, 'utf8');

  // Cargar certificado y clave privada
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);

  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      {
        type: forge.pki.oids.contentType,
        value: forge.pki.oids.data,
      },
      {
        type: forge.pki.oids.messageDigest,
      },
      {
        type: forge.pki.oids.signingTime,
        // Sin `value`: node-forge autocompleta con `new Date()` (pkcs7.js) y
        // lo serializa como UTCTime RFC 2985.
      },
    ],
  });

  // OBLIGATORIO para ARCA: firma adjunta (detached: false)
  p7.sign({ detached: false });

  const asn1 = p7.toAsn1();
  const der = forge.asn1.toDer(asn1).getBytes();
  return forge.util.encode64(der);
}

/**
 * Requests Token & Sign from WSAA.
 */
export async function authenticateWsaa(
  environment: ArcaEnvironment,
  certPem: string,
  keyPem: string
): Promise<WsaaAuthTicket> {
  const cmsBase64 = createSignedLoginTicket(certPem, keyPem);
  const url = ENDPOINTS[environment].wsaa;

  const soapPayload = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cmsBase64}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`.trim();

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '',
    },
    body: soapPayload,
  });

  const responseText = await res.text();

  if (!res.ok || responseText.includes('soapenv:Fault') || responseText.includes('<faultstring>')) {
    const fault = getTagValue(responseText, 'faultstring') || 'Error al autenticar con ARCA WSAA';
    throw new Error(`ARCA WSAA: ${fault}`);
  }

  return parseLoginTicketResponse(responseText);
}

/**
 * Parses the WSAA login ticket response.
 *
 * ARCA devuelve el ticket XML escapado dentro de `<loginCmsReturn>`
 * (`&lt;token&gt;`...), así que hay que decodificar las entidades antes de
 * leer `<token>` y `<sign>`; si no, ambos quedarían vacíos.
 */
export function parseLoginTicketResponse(responseText: string): WsaaAuthTicket {
  const loginTicketXml = decodeXmlEntities(
    getTagValue(responseText, 'loginCmsReturn') || responseText
  );
  const token = getTagValue(loginTicketXml, 'token');
  const sign = getTagValue(loginTicketXml, 'sign');
  const expirationTime = getTagValue(loginTicketXml, 'expirationTime');

  if (!token || !sign) {
    throw new Error('Respuesta inválida de WSAA: no se recibieron Token y Sign');
  }

  return {
    token,
    sign,
    expirationTime: expirationTime || new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
  };
}

/**
 * Performs a SOAP request to WSFEv1.
 */
async function callWsfeSoap(
  environment: ArcaEnvironment,
  methodName: string,
  soapBodyContent: string
): Promise<string> {
  const url = ENDPOINTS[environment].wsfe;
  const soapPayload = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${methodName} xmlns="http://ar.gov.afip.dif.FEV1/">
      ${soapBodyContent}
    </${methodName}>
  </soap:Body>
</soap:Envelope>`.trim();

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `http://ar.gov.afip.dif.FEV1/${methodName}`,
    },
    body: soapPayload,
  });

  const text = await res.text();

  if (!res.ok && !text.includes('soap:Fault')) {
    throw new Error(`Error HTTP al comunicar con WSFE (${res.status} ${res.statusText})`);
  }

  if (text.includes('soap:Fault') || text.includes('<faultstring>')) {
    const fault = getTagValue(text, 'faultstring') || 'Error SOAP en WSFE';
    throw new Error(`ARCA WSFE: ${fault}`);
  }

  return text;
}

/**
 * Checks server status (FEDummy).
 */
export async function checkWsfeHealth(environment: ArcaEnvironment): Promise<{
  appServer: string;
  dbServer: string;
  authServer: string;
}> {
  const xml = await callWsfeSoap(environment, 'FEDummy', '');
  return {
    appServer: getTagValue(xml, 'AppServer') || 'UNKNOWN',
    dbServer: getTagValue(xml, 'DbServer') || 'UNKNOWN',
    authServer: getTagValue(xml, 'AuthServer') || 'UNKNOWN',
  };
}

/**
 * Gets the last authorized voucher number for a point of sale and voucher type.
 */
export async function getLastAuthorizedVoucher(
  environment: ArcaEnvironment,
  auth: { token: string; sign: string; cuit: number },
  ptoVta: number,
  cbteTipo: ArcaVoucherType
): Promise<number> {
  const body = `
    <Auth>
      <Token>${auth.token}</Token>
      <Sign>${auth.sign}</Sign>
      <Cuit>${auth.cuit}</Cuit>
    </Auth>
    <PtoVta>${ptoVta}</PtoVta>
    <CbteTipo>${cbteTipo}</CbteTipo>
  `;

  const xml = await callWsfeSoap(environment, 'FECompUltimoAutorizado', body);
  const errors = parseCodeMessageList(xml, 'Errors');
  if (errors.length > 0) {
    throw new Error(`ARCA Error ${errors[0].codigo}: ${errors[0].mensaje}`);
  }

  const nro = getTagValue(xml, 'CbteNro');
  return nro ? parseInt(nro, 10) : 0;
}

/**
 * Builds the `<CbtesAsoc>` block for FECAESolicitar. Exportado para poder
 * testear el XML sin pegarle a la red.
 */
export function buildCbtesAsocXml(
  cbtesAsoc?: FecaeRequestData['cbtesAsoc']
): string {
  if (!cbtesAsoc || cbtesAsoc.length === 0) return '';
  const items = cbtesAsoc
    .map(
      (a) => `
        <CbteAsoc>
          <Tipo>${a.tipo}</Tipo>
          <PtoVta>${a.ptoVta}</PtoVta>
          <Nro>${a.nro}</Nro>
          ${a.cuit ? `<Cuit>${a.cuit}</Cuit>` : ''}
        </CbteAsoc>`
    )
    .join('');
  return `<CbtesAsoc>${items}</CbtesAsoc>`;
}

/**
 * Builds the SOAP body for FECAESolicitar. Exportado para poder testear el orden
 * de los elementos sin pegarle a la red.
 */
export function buildFecaeRequestBody(
  auth: { token: string; sign: string; cuit: number },
  data: FecaeRequestData
): string {
  let ivaXml = '';
  if (data.iva && data.iva.length > 0) {
    const items = data.iva
      .map(
        (iv) => `
        <AlicIva>
          <Id>${iv.Id}</Id>
          <BaseImp>${iv.BaseImp.toFixed(2)}</BaseImp>
          <Importe>${iv.Importe.toFixed(2)}</Importe>
        </AlicIva>`
      )
      .join('');
    ivaXml = `<Iva>${items}</Iva>`;
  }

  // El orden de los elementos sigue el esquema de FEDetRequest: CondicionIVAReceptorId
  // va antes de CbtesAsoc, y CbtesAsoc antes de Iva. ARCA rechaza el comprobante si
  // el orden no coincide.
  const condicionIvaXml = data.condicionIvaReceptorId
    ? `<CondicionIVAReceptorId>${data.condicionIvaReceptorId}</CondicionIVAReceptorId>`
    : '';
  const cbtesAsocXml = buildCbtesAsocXml(data.cbtesAsoc);

  return `
    <Auth>
      <Token>${auth.token}</Token>
      <Sign>${auth.sign}</Sign>
      <Cuit>${auth.cuit}</Cuit>
    </Auth>
    <FeCAEReq>
      <FeCabReq>
        <CantReg>1</CantReg>
        <PtoVta>${data.ptoVta}</PtoVta>
        <CbteTipo>${data.cbteTipo}</CbteTipo>
      </FeCabReq>
      <FeDetReq>
        <FECAEDetRequest>
          <Concepto>${data.concepto}</Concepto>
          <DocTipo>${data.docTipo}</DocTipo>
          <DocNro>${data.docNro}</DocNro>
          <CbteDesde>${data.cbteNro}</CbteDesde>
          <CbteHasta>${data.cbteNro}</CbteHasta>
          <CbteFch>${data.fechaCbte}</CbteFch>
          <ImpTotal>${data.impTotal.toFixed(2)}</ImpTotal>
          <ImpTotConc>0.00</ImpTotConc>
          <ImpNeto>${data.impNeto.toFixed(2)}</ImpNeto>
          <ImpOpEx>${data.impOpEx.toFixed(2)}</ImpOpEx>
          <ImpTrib>${data.impTrib.toFixed(2)}</ImpTrib>
          <ImpIVA>${data.impIva.toFixed(2)}</ImpIVA>
          ${condicionIvaXml}
          ${cbtesAsocXml}
          ${ivaXml}
        </FECAEDetRequest>
      </FeDetReq>
    </FeCAEReq>
  `;
}

/**
 * Authorizes an electronic invoice (FECAESolicitar).
 */
export async function authorizeElectronicInvoice(
  environment: ArcaEnvironment,
  auth: { token: string; sign: string; cuit: number },
  data: FecaeRequestData
): Promise<FecaeResponseData> {
  const body = buildFecaeRequestBody(auth, data);

  const xml = await callWsfeSoap(environment, 'FECAESolicitar', body);

  const errors = parseCodeMessageList(xml, 'Errors');
  if (errors.length > 0) {
    return {
      resultado: 'R',
      cbteNro: data.cbteNro,
      puntoVenta: data.ptoVta,
      cbteTipo: data.cbteTipo,
      errores: errors,
    };
  }

  const resultado = (getTagValue(xml, 'Resultado') || 'R') as 'A' | 'R';
  const cae = getTagValue(xml, 'CAE') || undefined;
  const caeFchVto = getTagValue(xml, 'CAEFchVto') || undefined;
  const observaciones = parseCodeMessageList(xml, 'Observaciones');

  return {
    resultado,
    cae,
    caeFchVto,
    cbteNro: data.cbteNro,
    puntoVenta: data.ptoVta,
    cbteTipo: data.cbteTipo,
    observaciones: observaciones.length > 0 ? observaciones : undefined,
  };
}
