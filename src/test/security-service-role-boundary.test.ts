import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Fase 4.1 — "Service Role en el proxy (cliente acotado)".
 *
 * La duda que cierra esta auditoria: ?cuanto servicio expone la key de service
 * role dentro de la app? La respuesta esperada es "dos clientes, acotados":
 *
 * 1. `src/lib/supabaseAdmin.ts`, un crypto a nivel modulo, usado solo por
 *    modulos de servidor (route handlers, services) detras de auth-gates. El
 *    surface real de lo que puede tocar cada usuario esta verificado por
 *    `tenant-isolation.*` y `security-role-gates` (403/aislamiento por tenant).
 * 2. `src/proxy.ts` (el middleware de esta version de Next), que crea su PROPIO
 *    cliente de service role. NO es un cliente "libre": cada query esta atada al
 *    `user.id` de la sesion ya resuelta por `supabase.auth.getUser()`:
 *      - `tenant_users.tenant_id` filtrado por `user_id = user.id`
 *      - `profiles.onboarding_pending` filtrado por `id = user.id`
 *      - `tenants` (estado de suscripcion) filtrado `.in('id', tenantIds)`, y
 *        `tenantIds` deriva EXCLUSIVAMENTE de la membresia del propio usuario.
 *    No hay ningun parametro de la request que llegue a esas queries: ni
 *    tenant_id, ni user_id, ni ids de objetos. Es el patron "cliente acotado":
 *    se elige sobre "RPC SECURITY DEFINER" porque no hay operacion nueva que
 *    exponer; las que ya estan en RPCs atomicas (045/046/048) validan tenant y
 *    uuid adentro.
 *
 * Este test pinza ese invariante con una lectura estatica del codigo fuente:
 * el nombre de la env var `SUPABASE_SERVICE_ROLE_KEY` no puede aparecer en
 * ningun archivo de `src/` fuera de los dos clientes permitidos (y de tests,
 * que lo mencionan al mockear). Si alguien crea un tercer cliente de service
 * role (en un route handler, un component, un hook), el test falla y lo obliga
 * a justificar la excepcion o a mover la operacion a un RPC acotado.
 *
 * Es una RED (no una valla): captura el caso evidente, "el nombre de la key
 * llego a un modulo donde no deberia". No detecta una key hardcodeada con su
 * valor, que es un problema distinto (y lo ataca ggshield en CI).
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const srcRoot = path.join(repoRoot, 'src');

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.[cm]?[jt]sx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const SERVICE_ROLE_ENV = 'SUPABASE_SERVICE_ROLE_KEY';

const allowedServiceRoleFiles = new Set([
  path.join(srcRoot, 'lib', 'supabaseAdmin.ts'),
  path.join(srcRoot, 'proxy.ts'),
]);

const isTestMethod = (file: string) => file.split(path.sep).includes('test');

describe('service role: superficie acotada', () => {
  it('los dos clientes permitidos existen (el allowlist no puede quedar vacio)', () => {
    for (const file of allowedServiceRoleFiles) {
      expect(() => readFileSync(file, 'utf8')).not.toThrow();
    }
  });

  it('SUPABASE_SERVICE_ROLE_KEY solo vive en supabaseAdmin.ts, proxy.ts y tests', () => {
    const offenders = listSourceFiles(srcRoot)
      .filter((file) => !allowedServiceRoleFiles.has(file))
      .filter((file) => !isTestMethod(file))
      .filter((file) => {
        const content = readFileSync(file, 'utf8');
        return content.includes(SERVICE_ROLE_ENV);
      });

    expect(offenders).toEqual([]);
  });

  it('ningun modulo del bundle de cliente referencia la key', () => {
    const clientBoundaries = [path.join(srcRoot, 'app'), path.join(srcRoot, 'components')];
    const offenders: string[] = [];
    for (const dir of clientBoundaries) {
      for (const file of listSourceFiles(dir)) {
        const content = readFileSync(file, 'utf8');
        if (content.includes(SERVICE_ROLE_ENV)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});