import { describe, expect, it } from 'vitest';
import { SEO_PAGES, type SeoLandingContent } from './seo-landing';

import { content as controlDeStock } from '@/app/control-de-stock/page';
import { content as controlDeCompras } from '@/app/control-de-compras/page';
import { content as ventasYCaja } from '@/app/ventas-y-caja/page';
import { content as alternativaAExcel } from '@/app/alternativa-a-excel/page';
import { content as gestionArgentina } from '@/app/software-gestion-argentina/page';
import { content as importarProductos } from '@/app/importar-productos-mercadolibre-tiendanube/page';

/**
 * Todas las landings, para verificar el contenido de cada una contra las
 * invariantes de SEO. Si una landing se agrega sin completar los campos, el
 * tipo lo marca en compile time; estas pruebas cubren lo que el tipo no ve:
 * textos vacios, guias sin pasos y enlaces internos que no existen.
 */
const LANDINGS: Record<string, SeoLandingContent> = {
  'control-de-stock': controlDeStock,
  'control-de-compras': controlDeCompras,
  'ventas-y-caja': ventasYCaja,
  'alternativa-a-excel': alternativaAExcel,
  'software-gestion-argentina': gestionArgentina,
  'importar-productos-mercadolibre-tiendanube': importarProductos,
};

const REGISTRY_SLUGS = new Set<string>(SEO_PAGES.map((page) => page.slug));

describe('landings SEO', () => {
  it('el registro y las landings reales estan en sync', () => {
    expect(Object.keys(LANDINGS).sort()).toEqual([...REGISTRY_SLUGS].sort());
  });

  for (const [slug, content] of Object.entries(LANDINGS)) {
    describe(slug, () => {
      it('el slug coincide con la ruta', () => {
        expect(content.slug).toBe(slug);
      });

      it('tiene todos los textos completos', () => {
        const textos: string[] = [
          content.metaTitle,
          content.metaDescription,
          content.badge,
          content.h1,
          content.intro,
          content.problemsTitle,
          content.problemsIntro,
          content.featuresTitle,
          content.featuresIntro,
          content.howToTitle,
          content.howToIntro,
          content.comparisonTitle,
          content.comparisonIntro,
          content.roiTitle,
          content.roiIntro,
          content.audienceTitle,
          content.audienceIntro,
          content.pricingTitle,
          content.pricingIntro,
          content.faqTitle,
          content.guaranteeTitle,
          content.guaranteeIntro,
          content.finalCtaTitle,
          content.finalCtaText,
        ];

        for (const texto of textos) {
          expect(texto.trim().length, `texto vacio en ${slug}`).toBeGreaterThan(0);
        }
      });

      it('el titulo entra en el limite que muestra Google', () => {
        // El template del layout agrega " | Vynko" (8 caracteres).
        expect(content.metaTitle.length + 8).toBeLessThanOrEqual(70);
      });

      it('el H1 describe el problema, no solo el nombre del producto', () => {
        // Que el H1 sea igual al title es válido: lo que no puede ser es un H1
        // que solo dice "Vynko" o repite el nombre de la marca sin explicar de
        // qué se trata la pagina.
        expect(content.h1.trim().length).toBeGreaterThan(20);
        expect(content.h1.toLowerCase()).not.toBe('vynko');
        expect(content.h1.toLowerCase().startsWith('vynko |')).toBe(false);
      });

      it('tiene una guia "como hacer X" con pasos', () => {
        expect(content.howTo.length).toBeGreaterThanOrEqual(3);
        for (const paso of content.howTo) {
          expect(paso.title.trim().length).toBeGreaterThan(0);
          expect(paso.desc.trim().length).toBeGreaterThan(0);
        }
      });

      it('tiene una comparativa con filas', () => {
        expect(content.comparison.length).toBeGreaterThanOrEqual(4);
        for (const fila of content.comparison) {
          expect(fila.label.trim().length).toBeGreaterThan(0);
          expect(fila.excel.trim().length).toBeGreaterThan(0);
          expect(fila.vynko.trim().length).toBeGreaterThan(0);
        }
      });

      it('tiene preguntas frecuentes', () => {
        expect(content.faq.length).toBeGreaterThanOrEqual(4);
      });

      it('los enlaces internos apuntan a landings que existen y no a si misma', () => {
        expect(content.related.length).toBeGreaterThanOrEqual(2);
        for (const link of content.related) {
          expect(REGISTRY_SLUGS.has(link.slug), `slug inexistente: ${link.slug}`).toBe(true);
          expect(link.slug, 'no se enlaza a si misma').not.toBe(content.slug);
          expect(link.title.trim().length).toBeGreaterThan(0);
          expect(link.desc.trim().length).toBeGreaterThan(0);
        }
      });

      it('no repite el mismo enlace interno dos veces', () => {
        const slugs = content.related.map((link) => link.slug);
        expect(new Set(slugs).size).toBe(slugs.length);
      });
    });
  }
});
