// El `openGraph` propio de esta landing reemplaza (merge superficial) el del
// layout raiz y pierde su card generado. Este re-export a nivel de segmento
// vuelve a aportar la imagen (file-based tiene prioridad sobre metadata).
export const runtime = 'nodejs';

export { default, alt, size, contentType } from '@/app/opengraph-image';
