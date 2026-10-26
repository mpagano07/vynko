import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Archivos de verificacion de propiedad que los buscadores piden servir en la
 * RAIZ del dominio (no en `src/app`, no en `public/` con prefijo).
 *
 * El riesgo de estos archivos no es el bug: es el refactor. Nada del codigo los
 * importa, asi que un `rm` de "archivos sueltos en public/" los borra sin que
 * compile nada raro, y el sintoma aparece semanas despues como "no pudimos
 * verificar tu sitio" en Bing. Este test los congela en su forma valida.
 */
const PUBLIC_DIR = join(process.cwd(), 'public');

describe('archivos de verificacion de buscadores', () => {
  it('publica BingSiteAuth.xml en la raiz', () => {
    // `public/BingSiteAuth.xml` se sirve como `https://vynko.dev/BingSiteAuth.xml`,
    // que es exactamente la URL que Bing pide verificar.
    expect(existsSync(join(PUBLIC_DIR, 'BingSiteAuth.xml'))).toBe(true);
  });

  it('BingSiteAuth.xml declara el XML y un unico codigo de verificacion', () => {
    const xml = readFileSync(join(PUBLIC_DIR, 'BingSiteAuth.xml'), 'utf8');

    expect(xml).toMatch(/^<\?xml version="1\.0"\?>/);
    // El formato es cerrado: `<users><user>CODIGO_DE_32_HEX</user></users>`.
    // Si el codigo se trunca, se reemplaza por otro de otra cuenta o se guarda
    // como HTML, Bing solo dice "no pudimos acceder al archivo" y no aclara que
    // el problema es el contenido.
    expect(xml).toMatch(/<users>\s*<user>[0-9A-F]{32}<\/user>\s*<\/users>/);
    expect(xml.match(/<user>/g)).toHaveLength(1);
  });
});
