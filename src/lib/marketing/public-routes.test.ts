import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  NOINDEX_PATHS,
  PRIVATE_ROUTE_PREFIXES,
  PUBLIC_PATHS,
  SEO_LANDING_PAGES,
  isIndexablePath,
  isPublicPath,
  isShelllessPath,
  matchesPath,
  robotsForPath,
} from './public-routes';

const APP_DIR = join(process.cwd(), 'src', 'app');

describe('clasificacion de rutas', () => {
  it('la home es publica e indexable', () => {
    expect(isPublicPath('/')).toBe(true);
    expect(isIndexablePath('/')).toBe(true);
  });

  it('las landings SEO son publicas e indexables', () => {
    for (const page of SEO_LANDING_PAGES) {
      expect(isPublicPath(`/${page.slug}`)).toBe(true);
      expect(isIndexablePath(`/${page.slug}`)).toBe(true);
    }
  });

  it('las paginas legales son publicas e indexables', () => {
    for (const path of ['/privacidad', '/terminos', '/reembolsos', '/cookies']) {
      expect(isPublicPath(path)).toBe(true);
      expect(isIndexablePath(path)).toBe(true);
    }
  });

  it('las rutas de auth se sirven pero no se indexan', () => {
    for (const path of ['/login', '/auth/signup', '/auth/forgot-password', '/auth/reset-password']) {
      expect(isPublicPath(path)).toBe(true);
      expect(isIndexablePath(path)).toBe(false);
    }
  });

  it('las paginas de acceso e invitacion se sirven pero no se indexan', () => {
    expect(isPublicPath('/accept-invite')).toBe(true);
    expect(isIndexablePath('/accept-invite')).toBe(false);
    expect(isPublicPath('/no-access')).toBe(true);
    expect(isIndexablePath('/no-access')).toBe(false);
  });

  it('la app privada no es publica ni indexable', () => {
    for (const path of [
      '/dashboard',
      '/sales',
      '/sales/cash-register',
      '/products',
      '/providers',
      '/customers',
      '/documents',
      '/invoices',
      '/forecast',
      '/loss-prevention',
      '/activity-logs',
      '/qr-codes',
      '/scanning',
      '/settings',
      '/billing',
      '/onboarding',
      '/admin/analytics',
      '/ai',
      '/shelf-vision',
    ]) {
      expect(isPublicPath(path)).toBe(false);
      expect(isIndexablePath(path)).toBe(false);
    }
  });

  it('el onboarding se dibuja sin el shell de la app', () => {
    // Exige sesion (el gate del proxy lo bloquea) pero no muestra el sidebar.
    expect(isPublicPath('/onboarding')).toBe(false);
    expect(isShelllessPath('/onboarding')).toBe(true);
  });

  it('el billing SI muestra el shell de la app', () => {
    expect(isShelllessPath('/billing')).toBe(false);
  });
});

describe('robotsForPath', () => {
  it('deja indexar las landings, la home y las legales', () => {
    for (const path of ['/', '/control-de-stock', '/ventas-y-caja', '/privacidad', '/terminos']) {
      expect(robotsForPath(path)).toEqual({ index: true, follow: true });
    }
  });

  it('saca del indice las rutas de auth y las privadas', () => {
    for (const path of ['/login', '/auth/signup', '/accept-invite', '/dashboard', '/sales']) {
      expect(robotsForPath(path).index).toBe(false);
    }
  });

  it('siempre deja `follow` en true', () => {
    // `noindex, follow` permite que Google siga los enlaces de la pagina para
    // descubrir el resto del sitio, sin listar esa pagina en el indice.
    for (const path of ['/', '/login', '/dashboard']) {
      expect(robotsForPath(path).follow).toBe(true);
    }
  });

  it('declarar robots SIEMPRE, tambien para las rutas indexables', () => {
    // Omitir el campo deja el valor en manos de un default silencioso de
    // Next. Declararlo siempre lo hace auditable y testeable.
    expect(robotsForPath('/')).toHaveProperty('index');
    expect(robotsForPath('/login')).toHaveProperty('index');
  });
});

describe('matchesPath', () => {  it('exige frontera de segmento', () => {
    expect(matchesPath('/auth/signup', ['/auth'])).toBe(true);
    expect(matchesPath('/auth', ['/auth'])).toBe(true);
    expect(matchesPath('/author', ['/auth'])).toBe(false);
    expect(matchesPath('/dashboard-legacy', ['/dashboard'])).toBe(false);
  });
});

describe('coherencia de las listas', () => {
  it('toda ruta publica del sitemap es indexable', () => {
    for (const page of SEO_LANDING_PAGES) {
      expect(isIndexablePath(`/${page.slug}`)).toBe(true);
    }
  });

  it('las rutas privadas de robots.txt no son publicas', () => {
    for (const prefix of PRIVATE_ROUTE_PREFIXES) {
      expect(isPublicPath(prefix)).toBe(false);
    }
  });

  it('las rutas noindex son publicas (si no, no habria nada que marcar)', () => {
    for (const prefix of NOINDEX_PATHS) {
      expect(isPublicPath(prefix)).toBe(true);
      expect(isIndexablePath(prefix)).toBe(false);
    }
  });

  it('los prefijos de robots.txt no terminan en barra', () => {
    // `Disallow: /dashboard/` no bloquea `/dashboard`: solo sus subrutas.
    for (const prefix of PRIVATE_ROUTE_PREFIXES) {
      expect(prefix.endsWith('/')).toBe(false);
    }
  });
});

describe('registro de landings', () => {
  it('no repite slugs', () => {
    const slugs = SEO_LANDING_PAGES.map((page) => page.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('cada landing del registro tiene su route dir', () => {
    // Si se agrega una landing al registro y se olvida de crear el route, el
    // nav, el footer y el sitemap van a linkear a un 404.
    for (const page of SEO_LANDING_PAGES) {
      expect(existsSync(join(APP_DIR, page.slug, 'page.tsx')), `falta el route de /${page.slug}`).toBe(true);
    }
  });

  it('cada landing del registro tiene un lastmod con formato ISO', () => {
    for (const page of SEO_LANDING_PAGES) {
      expect(page.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('las landings del registro son todas publicas', () => {
    for (const page of SEO_LANDING_PAGES) {
      expect(PUBLIC_PATHS).toContain(`/${page.slug}`);
    }
  });
});
