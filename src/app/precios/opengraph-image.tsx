// La pagina define su propio `openGraph` (titulo y descripcion de precios), y
// ese merge superficial descarta la imagen del layout raiz. El re-export a
// nivel de segmento vuelve a aportar la card generada.
export const runtime = 'nodejs';

export { default, alt, size, contentType } from '@/app/opengraph-image';
