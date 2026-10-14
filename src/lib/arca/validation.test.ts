import { describe, it, expect } from 'vitest';
import { validateFacturaReceptor, CONSUMIDOR_FINAL_IDENTIFICACION_MIN } from './validation';

const base = {
  invoice_type: 'B',
  customer_name: 'Consumidor Final',
  document_type: 'SinIdentificar',
  document_number: '',
  iva_condition: 'consumidor_final',
};

describe('validateFacturaReceptor', () => {
  it('acepta una Factura B a consumidor final sin identificar por importes bajos', () => {
    expect(validateFacturaReceptor(base, 1000)).toBeNull();
  });

  it('exige nombre o razón social', () => {
    expect(validateFacturaReceptor({ ...base, customer_name: '  ' }, 1000)).toMatch(/razón social/);
  });

  it('Factura A exige CUIT (documento de 11 dígitos)', () => {
    expect(
      validateFacturaReceptor({ ...base, invoice_type: 'A', iva_condition: 'responsable_inscripto' }, 1000)
    ).toMatch(/CUIT del receptor/);

    expect(
      validateFacturaReceptor(
        {
          ...base,
          invoice_type: 'A',
          iva_condition: 'responsable_inscripto',
          document_type: 'CUIT',
          document_number: '30-71234567-8',
        },
        1000
      )
    ).toBeNull();
  });

  it('Factura A exige que el receptor sea Responsable Inscripto', () => {
    expect(
      validateFacturaReceptor(
        { ...base, invoice_type: 'A', document_type: 'CUIT', document_number: '30712345678' },
        1000
      )
    ).toMatch(/Responsable Inscripto/);
  });

  it('rechaza Factura B a un Responsable Inscripto', () => {
    expect(
      validateFacturaReceptor(
        {
          ...base,
          invoice_type: 'B',
          iva_condition: 'responsable_inscripto',
          document_type: 'CUIT',
          document_number: '30712345678',
        },
        1000
      )
    ).toMatch(/Factura A, no Factura B/);
  });

  it('valida la longitud del CUIT', () => {
    expect(
      validateFacturaReceptor(
        { ...base, document_type: 'CUIT', document_number: '3071234567' },
        1000
      )
    ).toMatch(/11 dígitos/);
  });

  it('valida la longitud del DNI', () => {
    expect(
      validateFacturaReceptor({ ...base, document_type: 'DNI', document_number: '123' }, 1000)
    ).toMatch(/7 u 8 dígitos/);
  });

  it('Factura C a un no consumidor final exige CUIT', () => {
    expect(
      validateFacturaReceptor(
        { ...base, invoice_type: 'C', iva_condition: 'monotributista' },
        1000
      )
    ).toMatch(/CUIT/);
  });

  it('exige identificación de consumidor final desde el monto límite', () => {
    expect(validateFacturaReceptor(base, CONSUMIDOR_FINAL_IDENTIFICACION_MIN)).toMatch(
      /identificar al cliente/
    );
    expect(validateFacturaReceptor(base, CONSUMIDOR_FINAL_IDENTIFICACION_MIN - 1)).toBeNull();
  });
});
