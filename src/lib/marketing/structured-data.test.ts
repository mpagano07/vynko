import { describe, expect, it } from 'vitest';
import { getEffectivePrice } from '@/lib/plans';
import {
  ORGANIZATION_ID,
  SOFTWARE_APPLICATION_ID,
  buildSiteStructuredData,
  buildSoftwareApplicationJsonLd,
  serializeJsonLd,
} from './structured-data';

type Node = Record<string, unknown>;

const graph = (buildSiteStructuredData() as { '@graph': Node[] })['@graph'];
const byType = (type: string) => graph.find((node) => node['@type'] === type) as Node;

describe('buildSiteStructuredData', () => {
  it('usa el vocabulario de schema.org', () => {
    expect((buildSiteStructuredData() as Node)['@context']).toBe('https://schema.org');
  });

  it('describe la organización, el sitio y el producto', () => {
    expect(byType('Organization')).toBeDefined();
    expect(byType('WebSite')).toBeDefined();
    expect(byType('SoftwareApplication')).toBeDefined();
  });

  it('enlaza el sitio y el producto con la organización por @id', () => {
    expect((byType('WebSite').publisher as Node)['@id']).toBe(ORGANIZATION_ID);
    expect((byType('SoftwareApplication').publisher as Node)['@id']).toBe(ORGANIZATION_ID);
  });
});

describe('buildSoftwareApplicationJsonLd', () => {
  const app = buildSoftwareApplicationJsonLd();

  it('se marca como aplicación de negocio con @id estable', () => {
    expect(app['@type']).toBe('SoftwareApplication');
    expect(app['@id']).toBe(SOFTWARE_APPLICATION_ID);
    expect(app.applicationCategory).toBe('BusinessApplication');
  });

  it('publica la oferta en pesos con el precio del plan más barato vigente', () => {
    const offers = app.offers as Node;
    expect(offers.priceCurrency).toBe('ARS');
    expect(offers.price).toBe(getEffectivePrice('starter'));
    expect(offers.availability).toBe('https://schema.org/InStock');
  });

  it('acepta un precio explícito', () => {
    expect((buildSoftwareApplicationJsonLd(12345).offers as Node).price).toBe(12345);
  });
});

describe('serializeJsonLd', () => {
  it('escapa "<" para que un texto nunca cierre el script', () => {
    const serialized = serializeJsonLd({ text: '</script><script>alert(1)</script>' });
    expect(serialized).not.toContain('</script>');
    expect(serialized).toContain('\\u003c');
  });
});
