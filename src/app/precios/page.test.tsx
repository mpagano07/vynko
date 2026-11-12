import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ImgHTMLAttributes, ReactNode } from 'react';
import PreciosPage from './page';
import { PLANS, PLAN_ORDER } from '@/lib/plans';

vi.mock('next/headers', () => ({
  // La página es un Server Component: `headers()` define país (AR) y nonce.
  headers: vi.fn(async () => new Headers({ 'x-vercel-ip-country': 'AR', 'x-nonce': 'nonce-test' })),
}));

vi.mock('next/image', () => ({
  // Stub mínimo: sólo importa que el logo renderice.
  default: ({ src, alt, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string; alt: string; children?: ReactNode }) => (
    // eslint-disable-next-line @next/next/no-img-element -- mock del componente Image
    <img src={src} alt={alt} {...rest} />
  ),
}));

describe('página pública de precios', () => {
  it('renderiza los planes del catálogo, la comparativa y la FAQ', async () => {
    const ui = await PreciosPage();
    render(ui);

    // Hero + secciones clave.
    expect(screen.getByRole('heading', { name: /precios claros, sin permanencia/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /qué incluye cada plan/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /preguntas frecuentes sobre precios/i })).toBeInTheDocument();

    // La comparativa se agrupa en acordeones temáticos y el primero arranca abierto.
    const comparativa = document.querySelector('#comparativa') as HTMLElement;
    const grupos = Array.from(comparativa.querySelectorAll('details'));
    expect(grupos).toHaveLength(3);
    expect(grupos[0].open).toBe(true);
    expect(grupos[1].open).toBe(false);
    expect(grupos[2].open).toBe(false);
    expect(grupos[0].querySelector('summary')?.textContent).toContain('Catálogo y stock');
    expect(grupos[1].querySelector('summary')?.textContent).toContain('Ventas y caja');
    expect(grupos[2].querySelector('summary')?.textContent).toContain('Compras y equipo');

    // El plan recomendado muestra el subtítulo de posicionamiento.
    expect(screen.getByText(/recomendado para comercios en crecimiento/i)).toBeInTheDocument();

    // Cada plan declarado aparece en la grilla (y en la tabla comparativa).
    for (const id of PLAN_ORDER) {
      const name = PLANS[id].name;
      expect(screen.getAllByText(new RegExp(`^${name}$`)).length).toBeGreaterThanOrEqual(1);
    }

    // El JSON-LD de FAQ va con el nonce del request.
    const script = document.querySelector('script[type="application/ld+json"]');
    expect(script?.getAttribute('nonce')).toBe('nonce-test');
    expect(script?.textContent).toContain('FAQPage');
  });
});
