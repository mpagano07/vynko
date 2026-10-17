import { describe, expect, it } from 'vitest';
import {
  formatCuit,
  formatCuitInput,
  formatDocumentNumberInput,
  normalizePartyTaxFields,
  normalizeProvidedTaxFields,
  validatePartyTaxFields,
} from './tax-fields';

describe('validatePartyTaxFields', () => {
  it('acepta un registro sin datos fiscales', () => {
    expect(validatePartyTaxFields({})).toBeNull();
    expect(validatePartyTaxFields({ cuit: '', document_number: '' })).toBeNull();
  });

  it('acepta un CUIT con separadores', () => {
    expect(validatePartyTaxFields({ cuit: '20-12345678-9', document_type: 'DNI', document_number: '12345678' })).toBeNull();
  });

  it('rechaza un CUIT con menos de 11 dígitos', () => {
    expect(validatePartyTaxFields({ cuit: '201234567' })).toMatch(/11 dígitos/);
  });

  it('rechaza un CUIT con letras', () => {
    expect(validatePartyTaxFields({ cuit: '20A12345678' })).toMatch(/números/);
  });

  it('rechaza un DNI con longitud inválida', () => {
    expect(validatePartyTaxFields({ document_type: 'DNI', document_number: '12345' })).toMatch(/7 u 8 dígitos/);
    expect(validatePartyTaxFields({ document_type: 'DNI', document_number: '123456789' })).toMatch(/7 u 8 dígitos/);
    expect(validatePartyTaxFields({ document_type: 'DNI', document_number: '12345678' })).toBeNull();
  });

  it('valida el largo del CUIL/CUIT del documento', () => {
    expect(validatePartyTaxFields({ document_type: 'CUIL', document_number: '20123456789' })).toBeNull();
    expect(validatePartyTaxFields({ document_type: 'CUIL', document_number: '2012345' })).toMatch(/11 dígitos/);
  });

  it('acepta pasaportes y cédulas alfanuméricos', () => {
    expect(validatePartyTaxFields({ document_type: 'Pasaporte', document_number: 'AB1234' })).toBeNull();
    expect(validatePartyTaxFields({ document_type: 'CE', document_number: '12' })).toMatch(/4 caracteres/);
  });

  it('rechaza condiciones de IVA desconocidas', () => {
    expect(validatePartyTaxFields({ iva_condition: 'monotributo' })).toMatch(/condición frente al IVA/);
    expect(validatePartyTaxFields({ iva_condition: 'monotributista' })).toBeNull();
  });

  it('sólo exige CUIT para Responsable Inscripto cuando se pide', () => {
    const ri = { iva_condition: 'responsable_inscripto' };
    expect(validatePartyTaxFields(ri)).toBeNull();
    expect(validatePartyTaxFields(ri, { requireCuit: true })).toMatch(/CUIT/);
    expect(validatePartyTaxFields({ ...ri, cuit: '30123456781' }, { requireCuit: true })).toBeNull();
  });
});

describe('normalizePartyTaxFields', () => {
  it('deja CUIT y documento sin separadores', () => {
    expect(
      normalizePartyTaxFields({
        cuit: ' 20-12345678-9 ',
        document_type: 'DNI',
        document_number: '12.345.678',
        iva_condition: 'monotributista',
      })
    ).toEqual({
      cuit: '20123456789',
      document_type: 'DNI',
      document_number: '12345678',
      iva_condition: 'monotributista',
    });
  });

  it('convierte vacíos en null', () => {
    expect(normalizePartyTaxFields({ cuit: '  ', document_number: '' })).toEqual({
      cuit: null,
      document_type: null,
      document_number: null,
      iva_condition: null,
    });
  });
});

describe('normalizeProvidedTaxFields', () => {
  it('normaliza sólo los campos enviados', () => {
    expect(normalizeProvidedTaxFields({ cuit: '20-12345678-9', name: 'Juan' })).toEqual({
      cuit: '20123456789',
    });
  });

  it('no toca los campos ausentes', () => {
    const out = normalizeProvidedTaxFields({ iva_condition: 'monotributista' });
    expect(out).toEqual({ iva_condition: 'monotributista' });
    expect('cuit' in out).toBe(false);
  });
});

describe('formatCuit', () => {
  it('formatea el CUIT de 11 dígitos', () => {
    expect(formatCuit('20123456789')).toBe('20-12345678-9');
  });

  it('devuelve el valor tal cual si no tiene 11 dígitos', () => {
    expect(formatCuit('20-123')).toBe('20-123');
    expect(formatCuit(null)).toBe('');
  });
});

describe('formatCuitInput', () => {
  it('arma los guiones a medida que se escribe', () => {
    expect(formatCuitInput('2')).toBe('2');
    expect(formatCuitInput('20')).toBe('20');
    expect(formatCuitInput('201')).toBe('20-1');
    expect(formatCuitInput('201234567')).toBe('20-1234567');
    expect(formatCuitInput('2012345678')).toBe('20-12345678');
    expect(formatCuitInput('20123456789')).toBe('20-12345678-9');
  });

  it('descarta todo lo que no sea número y corta en 11 dígitos', () => {
    expect(formatCuitInput('20a1234567899')).toBe('20-12345678-9');
    expect(formatCuitInput('20-12345678-9')).toBe('20-12345678-9');
  });
});

describe('formatDocumentNumberInput', () => {
  it('deja sólo números para DNI y corta en 8', () => {
    expect(formatDocumentNumberInput('12.345.678', 'DNI')).toBe('12345678');
    expect(formatDocumentNumberInput('123456789', 'DNI')).toBe('12345678');
    expect(formatDocumentNumberInput('', undefined)).toBe('');
  });

  it('permite 11 dígitos para CUIL', () => {
    expect(formatDocumentNumberInput('20 12345678 9', 'CUIL')).toBe('20123456789');
  });

  it('formatea con guiones cuando el tipo es CUIT', () => {
    expect(formatDocumentNumberInput('30112233445', 'CUIT')).toBe('30-11223344-5');
  });

  it('permite alfanuméricos en Pasaporte y CE', () => {
    expect(formatDocumentNumberInput('ab12 3/x', 'Pasaporte')).toBe('ab123x');
    expect(formatDocumentNumberInput('ab12 3/x', 'CE')).toBe('ab123x');
  });
});
