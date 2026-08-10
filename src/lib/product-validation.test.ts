import { describe, expect, it } from 'vitest';
import {
  validateProduct,
  validateProductName,
  validateSku,
  validatePrice,
  validateStock,
} from './product-validation';

describe('validateProductName', () => {
  it('acepta un nombre válido', () => {
    expect(validateProductName('Coca Cola')).toBeNull();
  });

  it('rechaza nombre vacío', () => {
    expect(validateProductName('')).toBe('El nombre del producto es requerido');
  });

  it('rechaza nombre solo con espacios', () => {
    expect(validateProductName('   ')).toBe('El nombre del producto es requerido');
  });

  it('rechaza nombre no-string', () => {
    expect(validateProductName(123)).toBe('El nombre del producto es requerido');
  });
});

describe('validateSku', () => {
  it('acepta SKU opcional (undefined/null/vacío)', () => {
    expect(validateSku(undefined)).toBeNull();
    expect(validateSku(null)).toBeNull();
    expect(validateSku('')).toBeNull();
  });

  it('acepta un SKU alfanumérico válido', () => {
    expect(validateSku('ABC-123')).toBeNull();
    expect(validateSku('a1.b2_c3')).toBeNull();
  });

  it('rechaza SKU demasiado corto', () => {
    expect(validateSku('ab')).toBe('El SKU debe tener al menos 3 caracteres');
  });

  it('rechaza SKU demasiado largo', () => {
    expect(validateSku('x'.repeat(65))).toBe('El SKU no puede superar los 64 caracteres');
  });

  it('rechaza SKU con caracteres inválidos', () => {
    expect(validateSku('abc def')).toBe('El SKU solo puede contener letras, números y los símbolos . _ -');
    expect(validateSku('abc@def')).toBe('El SKU solo puede contener letras, números y los símbolos . _ -');
  });

  it('rechaza SKU que empieza con carácter no alfanumérico', () => {
    expect(validateSku('-abc')).toBe('El SKU solo puede contener letras, números y los símbolos . _ -');
  });

  it('rechaza SKU no-string', () => {
    expect(validateSku(42)).toBe('El SKU debe ser un texto');
  });
});

describe('validatePrice', () => {
  it('acepta precio opcional', () => {
    expect(validatePrice(undefined)).toBeNull();
    expect(validatePrice(null)).toBeNull();
  });

  it('acepta precio positivo', () => {
    expect(validatePrice(1500)).toBeNull();
    expect(validatePrice(1234.56)).toBeNull();
  });

  it('acepta precio cero', () => {
    expect(validatePrice(0)).toBeNull();
  });

  it('rechaza precio negativo', () => {
    expect(validatePrice(-10)).toBe('El precio no puede ser negativo');
  });

  it('rechaza precio no numérico', () => {
    expect(validatePrice('abc')).toBe('El precio debe ser un número');
    expect(validatePrice(NaN)).toBe('El precio debe ser un número');
  });
});

describe('validateStock', () => {
  it('acepta stock opcional', () => {
    expect(validateStock(undefined)).toBeNull();
    expect(validateStock(null)).toBeNull();
  });

  it('acepta stock entero positivo y cero', () => {
    expect(validateStock(0)).toBeNull();
    expect(validateStock(50)).toBeNull();
  });

  it('rechaza stock negativo', () => {
    expect(validateStock(-5)).toBe('El stock no puede ser negativo');
  });

  it('rechaza stock decimal', () => {
    expect(validateStock(2.5)).toBe('El stock debe ser un número entero');
  });

  it('rechaza stock no numérico', () => {
    expect(validateStock('mucho')).toBe('El stock debe ser un número entero');
  });
});

describe('validateProduct', () => {
  it('devuelve error de nombre cuando falta', () => {
    const errors = validateProduct({ name: '', sku: 'SKU1', price: 100 });
    expect(errors.name).toBe('El nombre del producto es requerido');
  });

  it('devuelve error de SKU y precio juntos', () => {
    const errors = validateProduct({ name: 'Prod', sku: 'x', price: -5 });
    expect(errors.sku).toBe('El SKU debe tener al menos 3 caracteres');
    expect(errors.price).toBe('El precio no puede ser negativo');
  });

  it('no devuelve errores para un producto válido', () => {
    const errors = validateProduct({ name: 'Prod', sku: 'SKU-001', price: 99.9, stock: 10 });
    expect(errors).toEqual({});
  });
});
