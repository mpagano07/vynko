const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

export function escapeAttribute(value: unknown): string {
  return escapeHtml(value);
}

// `data:` sólo se acepta para PNG base64, chequeado explícitamente más abajo:
// permitir `data:image/svg+xml` habilitaría XSS vía SVG inline.
const SAFE_URL_PROTOCOLS = ['http:', 'https:', 'blob:'];

export function isSafeImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.startsWith('data:image/png;base64,')) return true;
  try {
    const url = new URL(value, 'https://localhost');
    return SAFE_URL_PROTOCOLS.includes(url.protocol);
  } catch {
    return false;
  }
}
