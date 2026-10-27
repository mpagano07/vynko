import { describe, expect, it } from 'vitest';
import { metadata } from './page';

/**
 * `/precios` no vive en el registro de landings (`SEO_LANDING_PAGES`), asi que
 * las invariantes de `seo-landing-content.test.ts` no la cubren. Es la pagina
 * que compite por "cuanto cuesta": si el snippet se corta antes de "45 dias
 * gratis, sin tarjeta", se pierde el argumento que la hace competitiva.
 */
describe('metadata de /precios', () => {
  const title = String(metadata.title);
  const description = String(metadata.description);

  it('el titulo entra en el ancho del snippet', () => {
    // El layout raiz agrega " | Vynko".
    expect(title.length + 8).toBeLessThanOrEqual(60);
  });

  it('la descripcion no se corta en Google', () => {
    expect(description.length).toBeLessThanOrEqual(158);
  });

  it('declara canonical propio y es indexable', () => {
    expect(metadata.alternates?.canonical).toBe('/precios');
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });
});
