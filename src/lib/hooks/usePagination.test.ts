import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePagination } from './usePagination';

describe('usePagination', () => {
  it('devuelve la primera página por defecto', () => {
    const items = [1, 2, 3, 4, 5];
    const { result } = renderHook(() => usePagination(items, 2));
    expect(result.current.currentPage).toBe(1);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.pageItems).toEqual([1, 2]);
  });

  it('pagina correctamente pasando a la siguiente página', () => {
    const items = Array.from({ length: 10 }, (_, i) => i + 1);
    const { result } = renderHook(() => usePagination(items, 4));
    act(() => result.current.setCurrentPage(3));
    expect(result.current.pageItems).toEqual([9, 10]);
    expect(result.current.totalPages).toBe(3);
  });

  it('clampa la página actual si la lista se achica', () => {
    const { result, rerender } = renderHook(({ items }) => usePagination(items, 2), {
      initialProps: { items: Array.from({ length: 10 }, (_, i) => i + 1) },
    });
    act(() => result.current.setCurrentPage(5));
    expect(result.current.currentPage).toBe(5);
    expect(result.current.pageItems).toEqual([9, 10]);
    rerender({ items: [1, 2] });
    expect(result.current.currentPage).toBe(1);
    expect(result.current.pageItems).toEqual([1, 2]);
  });

  it('no permite páginas menores a 1', () => {
    const { result } = renderHook(() => usePagination([1, 2, 3], 2));
    act(() => result.current.setCurrentPage(0));
    expect(result.current.currentPage).toBe(1);
  });

  it('maneja listas vacías y undefined', () => {
    const { result: empty } = renderHook(() => usePagination([], 5));
    expect(empty.current.totalPages).toBe(1);
    expect(empty.current.pageItems).toEqual([]);
    const { result: undef } = renderHook(() => usePagination(undefined, 5));
    expect(undef.current.totalPages).toBe(1);
    expect(undef.current.pageItems).toEqual([]);
  });
});