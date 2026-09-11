export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function matchesQuery(text: string | null | undefined, query: string): boolean {
  if (!text) return false;
  return normalizeForSearch(text).includes(normalizeForSearch(query));
}