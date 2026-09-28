import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeAttribute, isSafeImageUrl } from '@/lib/security/html-escape';

describe('escapeHtml', () => {
  it('neutralizes tag injection', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('neutralizes attribute breakouts', () => {
    expect(escapeHtml('" onerror="alert(1)')).toBe('&quot; onerror=&quot;alert(1)');
    expect(escapeHtml("' onload='alert(1)")).toBe('&#39; onload=&#39;alert(1)');
  });

  it('escapes ampersands once', () => {
    expect(escapeHtml('a & b &amp; c')).toBe('a &amp; b &amp;amp; c');
  });

  it('handles nullish and non-string values', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(0)).toBe('0');
    expect(escapeHtml(false)).toBe('false');
  });

  it('escapeAttribute matches escapeHtml semantics', () => {
    expect(escapeAttribute('<b>')).toBe('&lt;b&gt;');
  });
});

describe('isSafeImageUrl', () => {
  it('accepts https and http', () => {
    expect(isSafeImageUrl('https://cdn.example.com/a.png')).toBe(true);
    expect(isSafeImageUrl('http://cdn.example.com/a.png')).toBe(true);
  });

  it('accepts relative urls', () => {
    expect(isSafeImageUrl('/images/logo.png')).toBe(true);
  });

  it('accepts base64 png data urls only', () => {
    expect(isSafeImageUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isSafeImageUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false);
  });

  it('rejects script-bearing and unknown schemes', () => {
    expect(isSafeImageUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeImageUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeImageUrl('vbscript:msgbox(1)')).toBe(false);
  });

  it('rejects empty and non-string values', () => {
    expect(isSafeImageUrl('')).toBe(false);
    expect(isSafeImageUrl(null)).toBe(false);
    expect(isSafeImageUrl(42)).toBe(false);
  });
});
