import { describe, expect, it } from 'vitest';
import { normalizeForSearch, matchesQuery } from './text';

describe('normalizeForSearch', () => {
  it('quita acentos y pasa a minúsculas', () => {
    expect(normalizeForSearch('Café Espresso')).toBe('cafe espresso');
    expect(normalizeForSearch('Yogur Natural')).toBe('yogur natural');
    expect(normalizeForSearch('Gómez Pérez Ávila')).toBe('gomez perez avila');
  });

  it('mantiene caracteres sin acentos y números', () => {
    expect(normalizeForSearch('SKU-001')).toBe('sku-001');
    expect(normalizeForSearch('Pan 000 1kg')).toBe('pan 000 1kg');
  });

  it('maneja strings vacíos', () => {
    expect(normalizeForSearch('')).toBe('');
  });
});

describe('matchesQuery', () => {
  it('encuentra texto con y sin acento indistintamente', () => {
    expect(matchesQuery('Café Espresso', 'cafe')).toBe(true);
    expect(matchesQuery('cafe espresso', 'Café')).toBe(true);
    expect(matchesQuery('Jugo de Naranja', 'jugo')).toBe(true);
  });

  it('no matchea texto no relacionado', () => {
    expect(matchesQuery('Leche Entera', 'cafe')).toBe(false);
    expect(matchesQuery('Harina', 'manteca')).toBe(false);
  });

  it('maneja valores nulos o vacíos', () => {
    expect(matchesQuery(null, 'cafe')).toBe(false);
    expect(matchesQuery(undefined, 'cafe')).toBe(false);
    expect(matchesQuery('cafe', '')).toBe(true);
  });
});