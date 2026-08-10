import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('merges tailwind classes, resolving conflicts', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('accepts falsy values and ignores them', () => {
    expect(cn('text-sm', false, null, undefined, 'text-gray-900')).toBe('text-sm text-gray-900');
  });

  it('joins multiple class inputs', () => {
    expect(cn('flex', 'items-center')).toBe('flex items-center');
  });

  it('returns an empty string for empty inputs', () => {
    expect(cn()).toBe('');
  });
});
