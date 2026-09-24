const LONG_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
};

export function formatDate(
  value: string | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions | string,
  locale = 'es-AR'
): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  if (typeof options === 'string') {
    return date.toLocaleDateString(options, LONG_DATE_OPTIONS);
  }
  return date.toLocaleDateString(locale, options ?? LONG_DATE_OPTIONS);
}

export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return 'ahora';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  return `hace ${Math.floor(diff / 86400)}d`;
}