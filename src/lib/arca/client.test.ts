import { describe, it, expect } from 'vitest';
import { parseLoginTicketResponse, buildCbtesAsocXml, buildFecaeRequestBody } from './client';
import type { FecaeRequestData } from './client';

/**
 * ARCA devuelve el ticket XML escapado dentro de <loginCmsReturn>, como ocurre
 * en un <loginCmsReturn> real de WSAA (homologación y producción).
 */
const ESCAPED_RESPONSE = [
  '<soapenv:Envelope><soapenv:Body>',
  '<loginCmsResponse xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov">',
  '<loginCmsReturn>&lt;loginTicketResponse&gt;&lt;header&gt;',
  '&lt;uniqueId&gt;123456&lt;/uniqueId&gt;',
  '&lt;generationTime&gt;2026-10-14T10:00:00-03:00&lt;/generationTime&gt;',
  '&lt;expirationTime&gt;2026-10-14T22:00:00-03:00&lt;/expirationTime&gt;',
  '&lt;/header&gt;&lt;credentials&gt;',
  '&lt;token&gt;ABC123&lt;/token&gt;',
  '&lt;sign&gt;SIGN456&lt;/sign&gt;',
  '&lt;/credentials&gt;&lt;/loginTicketResponse&gt;',
  '</loginCmsReturn>',
  '</loginCmsResponse></soapenv:Body></soapenv:Envelope>',
].join('');

const UNESCAPED_RESPONSE = [
  '<soapenv:Envelope><soapenv:Body>',
  '<loginCmsResponse xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov">',
  '<loginCmsReturn><loginTicketResponse><header>',
  '<expirationTime>2026-10-14T22:00:00-03:00</expirationTime>',
  '</header><credentials>',
  '<token>ABC123</token>',
  '<sign>SIGN456</sign>',
  '</credentials></loginTicketResponse></loginCmsReturn>',
  '</loginCmsResponse></soapenv:Body></soapenv:Envelope>',
].join('');

describe('parseLoginTicketResponse', () => {
  it('decodifica las entidades y extrae Token y Sign de la respuesta escapada', () => {
    const ticket = parseLoginTicketResponse(ESCAPED_RESPONSE);

    expect(ticket.token).toBe('ABC123');
    expect(ticket.sign).toBe('SIGN456');
    expect(ticket.expirationTime).toBe('2026-10-14T22:00:00-03:00');
  });

  it('también acepta una respuesta sin escapar', () => {
    const ticket = parseLoginTicketResponse(UNESCAPED_RESPONSE);

    expect(ticket.token).toBe('ABC123');
    expect(ticket.sign).toBe('SIGN456');
  });

  it('falla si la respuesta no trae credenciales', () => {
    expect(() =>
      parseLoginTicketResponse('<loginCmsReturn><credentials></credentials></loginCmsReturn>')
    ).toThrow(/no se recibieron Token y Sign/);
  });
});

describe('buildCbtesAsocXml', () => {
  it('devuelve una cadena vacía cuando no hay comprobantes asociados', () => {
    expect(buildCbtesAsocXml()).toBe('');
    expect(buildCbtesAsocXml([])).toBe('');
  });

  it('genera el bloque CbtesAsoc con tipo, punto de venta y número', () => {
    const xml = buildCbtesAsocXml([{ tipo: 6, ptoVta: 1, nro: 42 }]);
    expect(xml).toContain('<CbtesAsoc>');
    expect(xml).toContain('<CbteAsoc>');
    expect(xml).toContain('<Tipo>6</Tipo>');
    expect(xml).toContain('<PtoVta>1</PtoVta>');
    expect(xml).toContain('<Nro>42</Nro>');
    expect(xml).toContain('</CbtesAsoc>');
  });

  it('incluye el CUIT del emisor cuando está presente', () => {
    const xml = buildCbtesAsocXml([{ tipo: 1, ptoVta: 2, nro: 7, cuit: 20111111112 }]);
    expect(xml).toContain('<Cuit>20111111112</Cuit>');
  });

  it('soporta múltiples comprobantes asociados', () => {
    const xml = buildCbtesAsocXml([
      { tipo: 6, ptoVta: 1, nro: 1 },
      { tipo: 6, ptoVta: 1, nro: 2 },
    ]);
    expect(xml.match(/<CbteAsoc>/g)).toHaveLength(2);
  });
});

const AUTH = { token: 'T', sign: 'S', cuit: 20111111112 };

function baseData(overrides: Partial<FecaeRequestData> = {}): FecaeRequestData {
  return {
    ptoVta: 1,
    cbteTipo: 6,
    concepto: 1,
    docTipo: 99,
    docNro: 0,
    cbteNro: 1,
    fechaCbte: '20261014',
    impTotal: 121,
    impNeto: 100,
    impOpEx: 0,
    impTrib: 0,
    impIva: 21,
    ...overrides,
  };
}

describe('buildFecaeRequestBody', () => {
  it('incluye CondicionIVAReceptorId con el código del receptor', () => {
    const xml = buildFecaeRequestBody(AUTH, baseData({ condicionIvaReceptorId: 5 }));
    expect(xml).toContain('<CondicionIVAReceptorId>5</CondicionIVAReceptorId>');
  });

  it('omite CondicionIVAReceptorId si no se informa', () => {
    const xml = buildFecaeRequestBody(AUTH, baseData());
    expect(xml).not.toContain('CondicionIVAReceptorId');
  });

  it('respeta el orden del esquema: ImpIVA → CondicionIVAReceptorId → CbtesAsoc → Iva', () => {
    const xml = buildFecaeRequestBody(
      AUTH,
      baseData({
        condicionIvaReceptorId: 1,
        iva: [{ Id: 5, BaseImp: 100, Importe: 21 }],
        cbtesAsoc: [{ tipo: 6, ptoVta: 1, nro: 42, cuit: 20111111112 }],
      })
    );

    const posImpIva = xml.indexOf('<ImpIVA>');
    const posCondicion = xml.indexOf('<CondicionIVAReceptorId>');
    const posCbtesAsoc = xml.indexOf('<CbtesAsoc>');
    const posIva = xml.indexOf('<Iva>');

    expect(posImpIva).toBeGreaterThan(-1);
    expect(posImpIva).toBeLessThan(posCondicion);
    expect(posCondicion).toBeLessThan(posCbtesAsoc);
    expect(posCbtesAsoc).toBeLessThan(posIva);
  });
});
