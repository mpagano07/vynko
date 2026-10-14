import { describe, it, expect } from 'vitest';
import {
  voucherLetter,
  voucherCode,
  voucherDisplayName,
  ivaConditionLabel,
  formatInvoiceDate,
  formatCaeDueDate,
} from './invoice-document';

describe('voucherLetter', () => {
  it('devuelve la letra de una factura', () => {
    expect(voucherLetter('A')).toBe('A');
    expect(voucherLetter('B')).toBe('B');
    expect(voucherLetter('C')).toBe('C');
  });

  it('devuelve la letra de las notas', () => {
    expect(voucherLetter('NC_A')).toBe('A');
    expect(voucherLetter('NC_B')).toBe('B');
    expect(voucherLetter('NC_C')).toBe('C');
    expect(voucherLetter('ND_B')).toBe('B');
  });
});

describe('voucherCode', () => {
  it('mapea al código numérico de ARCA', () => {
    expect(voucherCode('A')).toBe(1);
    expect(voucherCode('B')).toBe(6);
    expect(voucherCode('C')).toBe(11);
    expect(voucherCode('NC_A')).toBe(3);
    expect(voucherCode('NC_B')).toBe(8);
    expect(voucherCode('NC_C')).toBe(13);
  });
});

describe('voucherDisplayName', () => {
  it('usa el nombre oficial del comprobante', () => {
    expect(voucherDisplayName('A')).toBe('Factura A');
    expect(voucherDisplayName('B')).toBe('Factura B');
    expect(voucherDisplayName('C')).toBe('Factura C');
    expect(voucherDisplayName('NC_B')).toBe('Nota de Crédito B');
  });

  it('cae a un nombre genérico para tipos desconocidos', () => {
    expect(voucherDisplayName('XYZ')).toBe('Factura XYZ');
  });
});

describe('ivaConditionLabel', () => {
  it('traduce las condiciones conocidas', () => {
    expect(ivaConditionLabel('responsable_inscripto')).toBe('IVA Responsable Inscripto');
    expect(ivaConditionLabel('monotributista')).toBe('Responsable Monotributo');
    expect(ivaConditionLabel('consumidor_final')).toBe('Consumidor Final');
    expect(ivaConditionLabel('sujeto_exento')).toBe('Sujeto Exento');
  });

  it('usa Consumidor Final por defecto', () => {
    expect(ivaConditionLabel(null)).toBe('Consumidor Final');
    expect(ivaConditionLabel(undefined)).toBe('Consumidor Final');
  });
});

describe('formatInvoiceDate', () => {
  it('formatea una fecha ISO a dd/mm/aaaa', () => {
    // Mediodía local: al formatear de vuelta en la misma zona, el día no cambia.
    const noon = new Date(2026, 9, 14, 12, 0, 0);
    expect(formatInvoiceDate(noon.toISOString())).toBe('14/10/2026');
  });

  it('devuelve vacío ante una fecha ausente o inválida', () => {
    expect(formatInvoiceDate(null)).toBe('');
    expect(formatInvoiceDate('no-es-fecha')).toBe('');
  });
});

describe('formatCaeDueDate', () => {
  it('convierte YYYYMMDD a dd/mm/aaaa', () => {
    expect(formatCaeDueDate('20261024')).toBe('24/10/2026');
  });

  it('devuelve un guion si falta o es inválido', () => {
    expect(formatCaeDueDate(null)).toBe('—');
    expect(formatCaeDueDate('2026')).toBe('—');
  });
});
