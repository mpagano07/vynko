#!/usr/bin/env node
// Borra un usuario de prueba y toda su cascada: perfil, membresias, logs,
// notificaciones, invitaciones, tokens de reset y eventos de analytics.
// Los tenants quedan intactos salvo que se pase --include-tenant-data.
//
// Por defecto es dry-run: imprime exactamente que borraria y no toca nada.
// Hace falta --confirm para escribir.
//
//   node --env-file=.env.production scripts/purge-test-user.mjs a@b.com c@d.com
//   node --env-file=.env.production scripts/purge-test-user.mjs a@b.com --include-tenant-data --confirm
//
// Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY del ambiente
// que se quiera tocar. El script imprime el project ref para que se confirme
// contra que ambiente esta corriendo.

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const INCLUDE_TENANTS = args.includes('--include-tenant-data');
const emails = [...new Set(args.filter((a) => !a.startsWith('--')).map((e) => e.trim().toLowerCase()).filter(Boolean))];

if (emails.length === 0) {
  console.error('Uso: purge-test-user.mjs <email> [email...] [--include-tenant-data] [--confirm]');
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el ambiente.');
  process.exit(2);
}

const { createClient } = await import('@supabase/supabase-js');
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

// Columnas que guardan el id de auth del usuario.
const USER_ID_COLUMNS = ['user_id', 'created_by', 'updated_by', 'invited_by', 'actor_id', 'requested_by', 'approved_by', 'owner_id'];
// Columnas de email que identifican a un usuario de la app.
// A proposito NO se incluyen customers/providers/suppliers: ahi el email es un
// contacto de negocio y borrarlo por coincidencia destruye datos reales.
const USER_EMAIL_TABLES = new Set(['profiles', 'invitations', 'password_reset_tokens', 'analytics_events']);
const isTenantColumn = (col) => col === 'tenant_id' || col.endsWith('_tenant_id');

console.log(`Ambiente:     ${url}`);
console.log(`Project ref:  ${url.match(/https?:\/\/([a-z]{6})[a-z0-9]*\./)?.[1] ?? '??????'}`);
console.log(`Emails:       ${emails.join(', ')}`);
console.log(`Modo:         ${CONFIRM ? 'BORRADO REAL' : 'dry-run (no se escribe nada)'}`);
if (INCLUDE_TENANTS) console.log('Tenants:      se borran sus datos (--include-tenant-data)');
console.log('');

async function loadSchema() {
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/openapi+json' },
  });
  if (!res.ok) throw new Error(`No se pudo leer el schema de PostgREST (${res.status})`);
  const definitions = (await res.json()).definitions ?? {};
  const tables = new Set(Object.keys(definitions));
  const columns = new Map();
  const parents = new Map();
  const fks = new Map();
  for (const [table, def] of Object.entries(definitions)) {
    columns.set(table, new Set(Object.keys(def.properties ?? {})));
    const set = new Set();
    const links = [];
    for (const [prop, schema] of Object.entries(def.properties ?? {})) {
      const fk = /<fk table='([^']+)' column='([^']+)'/.exec(schema.description ?? '');
      if (fk && tables.has(fk[1])) {
        set.add(fk[1]);
        links.push({ table, column: prop, parent: fk[1], parentColumn: fk[2] });
      }
    }
    parents.set(table, set);
    fks.set(table, links);
  }
  return { tables, columns, parents, fks };
}

// Ordena para borrar de mas hoja a mas raiz: si A referencia a B, A va antes.
function deletionOrder(tableList, parents) {
  const nodes = [...tableList];
  const indeg = new Map(nodes.map((t) => [t, 0]));
  const children = new Map(nodes.map((t) => [t, []]));
  for (const t of nodes) {
    for (const p of parents.get(t) ?? []) {
      if (!indeg.has(p)) continue;
      indeg.set(p, indeg.get(p) + 1);
      children.get(p).push(t);
    }
  }
  const queue = nodes.filter((t) => indeg.get(t) === 0);
  const out = [];
  while (queue.length) {
    const t = queue.shift();
    out.push(t);
    for (const child of children.get(t)) {
      indeg.set(child, indeg.get(child) - 1);
      if (indeg.get(child) === 0) queue.push(child);
    }
  }
  return [...out, ...nodes.filter((t) => !out.includes(t))];
}

// Una misma fila puede aparecer en varios targets de la misma tabla (por
// ejemplo user_id y tenant_id a la vez), asi que se cuentan por clave primaria
// para no inflar el total del dry-run.
async function countDistinctRows(table, targets) {
  const pk = primaryKeyOf(table);
  if (!pk) return { error: 'sin clave primaria reconocible' };
  const keys = new Set();
  for (const t of targets) {
    const { data, error } = await db.from(table).select(pk).in(t.column, t.values);
    if (error) return { error: `${t.column}: ${error.message}` };
    for (const row of data ?? []) keys.add(JSON.stringify(row[pk]));
  }
  return { count: keys.size };
}

// La clave primaria no siempre se llama id: tenant_first_activity,
// sales_daily_totals y sales_monthly_totals composite por tenant_id.
function primaryKeyOf(table) {
  const cols = columns.get(table) ?? new Set();
  for (const candidate of ['id', 'tenant_id', 'user_id', 'email', 'name', 'sku']) {
    if (cols.has(candidate)) return candidate;
  }
  return null;
}

async function fetchIds(table, column, values) {
  const pk = primaryKeyOf(table);
  if (!pk) return [];
  const { data, error } = await db.from(table).select(pk).in(column, values);
  if (error) return [];
  return [...new Set((data ?? []).map((r) => r[pk]).filter((v) => v !== null && v !== undefined))];
}



async function findAuthUsers(wanted) {
  const found = new Map();
  const perPage = 1000;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers fallo: ${error.message}`);
    const batch = data?.users ?? [];
    for (const u of batch) {
      const email = (u.email ?? '').toLowerCase();
      if (wanted.includes(email)) found.set(email, u);
    }
    if (batch.length < perPage || wanted.every((e) => found.has(e))) break;
  }
  return found;
}

const { tables, columns, parents, fks } = await loadSchema();
const has = (table, col) => columns.get(table)?.has(col) === true;

// Las vistas no aceptan DELETE, asi que se detectan por el mensaje de Postgres
// y se marcan para no contarlas como error ni como fila pendiente.
//Ejemplos: sales_daily_totals, sales_monthly_totals, tenant_first_activity.
const isView = new Set();
const looksLikeView = (error) => {
  const msg = error?.message ?? '';
  return msg.includes('cannot delete from view') || msg.includes('is not a table');
};

const authUsers = await findAuthUsers(emails);
const authIds = [...authUsers.values()].map((u) => u.id);
console.log(`usuarios de auth encontrados: ${authIds.length}/${emails.length}`);
for (const email of emails) {
  const u = authUsers.get(email);
  console.log(`  ${u ? 'OK   ' : 'FALTA'} ${email}${u ? `  id=${u.id}` : ''}`);
}
if (authIds.length === 0) {
  console.log('\nNingun usuario de auth coincide. No hay nada que borrar.');
  process.exit(0);
}
console.log('');

const { data: profiles, error: profilesErr } = await db
  .from('profiles')
  .select('*')
  .or(`id.in.(${authIds.join(',')}),email.in.(${emails.join(',')})`);
if (profilesErr) throw new Error(`No se pudieron leer los perfiles: ${profilesErr.message}`);
const profileIds = (profiles ?? []).map((p) => p.id);

const { data: memberships, error: memErr } = await db.from('tenant_users').select('*').in('user_id', authIds);
if (memErr) throw new Error(`No se pudieron leer las membresias: ${memErr.message}`);
const { data: allMembers, error: allMemErr } = await db.from('tenant_users').select('tenant_id,user_id,role');
if (allMemErr) throw new Error(`No se pudieron leer los miembros: ${allMemErr.message}`);

// Tenents a los que el usuario es owner, mas los que quedan sin ningun miembro
// una vez borrado (si no, quedan huerfanos colgando).
const ownedTenantIds = new Set();
for (const m of memberships ?? []) {
  if ((m.role ?? '').toLowerCase() === 'owner') ownedTenantIds.add(m.tenant_id);
  const others = (allMembers ?? []).filter((o) => o.tenant_id === m.tenant_id && !authIds.includes(o.user_id));
  if (others.length === 0) ownedTenantIds.add(m.tenant_id);
}

const { data: tenants } = await db.from('tenants').select('id,name,slug');
const tenantName = new Map((tenants ?? []).map((t) => [t.id, t.name ?? t.slug ?? t.id]));

console.log(`perfiles: ${profileIds.length}`);
console.log(`membresias: ${(memberships ?? []).length}`);
for (const m of memberships ?? []) {
  console.log(`  ${(m.role ?? '?').padEnd(6)} ${tenantName.get(m.tenant_id) ?? m.tenant_id}`);
}
console.log(`tenants a borrar con --include-tenant-data: ${ownedTenantIds.size}`);
console.log('');

const plan = new Map();
const addTarget = (table, column, values, label) => {
  if (values.length === 0 || !has(table, column)) return;
  if (!plan.has(table)) plan.set(table, []);
  plan.get(table).push({ column, values, label });
};

// 1) Filas que apuntan al id de auth del usuario.
for (const table of tables) {
  for (const col of USER_ID_COLUMNS) addTarget(table, col, authIds, 'usuario');
}
// 2) Filas que apuntan al email, solo en tablas donde el email es del usuario.
for (const table of USER_EMAIL_TABLES) {
  if (!tables.has(table)) continue;
  for (const col of ['email', 'user_email']) addTarget(table, col, emails, 'email');
}
// El perfil tambien se busca por id, por si el email del perfil no coincide.
addTarget('profiles', 'id', [...new Set([...authIds, ...profileIds])], 'usuario');
// 3) Datos del tenant, solo si se pidio explicitamente.
if (INCLUDE_TENANTS && ownedTenantIds.size > 0) {
  const tids = [...ownedTenantIds];
  const seeds = new Set();
  for (const table of tables) {
    for (const col of columns.get(table)) {
      if (col === 'tenant_id') {
        addTarget(table, col, tids, 'tenant');
        seeds.add(table);
      } else if (isTenantColumn(col)) {
        // from_tenant_id / to_tenant_id (stock_transfers) son referencias
        // cruzadas: la fila es compartida con otro tenant, asi que se marcan
        // aparte para poder revisarlas antes de confirmar.
        addTarget(table, col, tids, `tenant*${col}`);
      }
    }
  }
  addTarget('tenants', 'id', tids, 'tenant');
  await expandTransitively(seeds, tids);
}

// 4) Cierre transitivo en ambas direcciones. Hay tablas SIN tenant_id que hay
// que alcanzar igual:
//   hacia abajo (hijas): sale_items de sales, po_items de purchase_orders, etc.
//   hacia arriba (padres): products, referenciado por product_stock.
// Recorrer solo una de las dos deja filas huerfanas o hace fallar el borrado.
async function expandTransitively(seeds, tids) {
  // PKs de las filas marcadas, por tabla.
  const selected = new Map();
  const queue = [];
  const mark = (table, ids) => {
    const known = selected.get(table);
    if (!known) {
      selected.set(table, new Set(ids));
      queue.push(table);
      return ids.length;
    }
    const fresh = ids.filter((id) => !known.has(id));
    for (const id of fresh) known.add(id);
    if (fresh.length > 0) queue.push(table);
    return fresh.length;
  };

  // Hijas: tablas que tienen una FK hacia esta.
  const children = new Map();
  for (const [table, links] of fks) {
    for (const link of links) {
      if (!children.has(link.parent)) children.set(link.parent, []);
      children.get(link.parent).push({ table, column: link.column });
    }
  }

  for (const table of seeds) {
    const ids = await fetchIds(table, 'tenant_id', tids);
    if (ids.length > 0) mark(table, ids);
  }

  let guard = 0;
  while (queue.length > 0) {
    if ((guard += 1) > 2000) throw new Error('Cierre transitivo: demasiadas iteraciones, se corta por seguridad.');
    const table = queue.shift();
    const myIds = [...(selected.get(table) ?? [])];
    if (myIds.length === 0) continue;
    const pk = primaryKeyOf(table);
    if (!pk) continue;

    // Hacia arriba: los valores de FK de mis filas son filas que tambien son mias.
    for (const link of fks.get(table) ?? []) {
      if (link.column === link.parentColumn) continue;
      const { data } = await db.from(table).select(link.column).in(pk, myIds);
      const values = [...new Set((data ?? []).map((r) => r[link.column]).filter((v) => v !== null && v !== undefined))];
      if (values.length === 0) continue;
      const parentIds = await fetchIds(link.parent, link.parentColumn, values);
      if (parentIds.length > 0) mark(link.parent, parentIds);
    }

    // Hacia abajo: filas que apuntan a las mias.
    for (const link of children.get(table) ?? []) {
      const ids = await fetchIds(link.table, link.column, myIds);
      if (ids.length > 0) mark(link.table, ids);
    }
  }

  // Todo lo alcanzado entra al plan, incluido lo que no tiene tenant_id.
  for (const [table, ids] of selected) {
    addTarget(table, primaryKeyOf(table), [...ids], 'cascada');
  }
}

const ordered = deletionOrder([...plan.keys()], parents);

const rowsByTable = [];
let totalRows = 0;
for (const table of ordered) {
  const targets = plan.get(table);
  if (!targets) continue;
  const { count, error } = await countDistinctRows(table, targets);
  const labels = targets.map((t) => `${t.column} (${t.label})`).join('; ');
  if (error) {
    if (looksLikeView(error)) isView.add(table);
    else rowsByTable.push([table, 0, `ERROR ${error}`]);
  } else if (count > 0) {
    rowsByTable.push([table, count, labels]);
  }
  totalRows += count ?? 0;
}

console.log('--- plan de borrado ---');
for (const [table, total, detail] of rowsByTable) {
  console.log(`  ${table.padEnd(30)} ${String(total).padStart(5)}  ${detail}`);
}
console.log(`  ${'TOTAL filas'.padEnd(30)} ${String(totalRows).padStart(5)}`);
console.log(`  ${'usuarios de auth'.padEnd(30)} ${String(authIds.length).padStart(5)}`);

const preserved = (memberships ?? []).filter((m) => !ownedTenantIds.has(m.tenant_id));
if (preserved.length && !INCLUDE_TENANTS) {
  console.log('\nTenants de los que es miembro y NO se borran (pasaria --include-tenant-data):');
  for (const m of preserved) console.log(`  ${tenantName.get(m.tenant_id) ?? m.tenant_id}`);
}

if (!CONFIRM) {
  console.log('\nDry-run: no se borro nada. Repetir con --confirm para ejecutar.');
  process.exit(0);
}

if (isView.size > 0) {
  console.log(`\nNota: ${[...isView].join(', ')} son vistas; se vacian solas al borrar sus tablas base.`);
}

console.log('\n--- borrando ---');
// Multi-pasada a proposito: el grafo de FKs tiene ciclos (products <->
// stock_movements, y varias tablas asi), con lo que ningun orden topologico
// los resuelve. Una tabla que falla por FK puede quedar liberada en la pasada
// siguiente, asi que se repite hasta que no haya progreso.
const pending = new Set(ordered.filter((t) => plan.has(t)));
const failed = new Map();
let deletedTotal = 0;
let pass = 0;
let progress = true;
while (pending.size > 0 && progress) {
  pass += 1;
  progress = false;
  for (const table of ordered) {
    if (!pending.has(table)) continue;
    // Una fila puede matchear varios targets: se cuenta por clave primaria.
    const seenKeys = new Set();
    const errors = [];
    for (const t of plan.get(table)) {
      const pk = primaryKeyOf(table);
      const { data, error } = await db.from(table).delete().in(t.column, t.values).select(pk);
      if (error) {
        if (looksLikeView(error)) {
          isView.add(table);
          continue;
        }
        errors.push(`${t.column}: ${error.message ?? JSON.stringify(error)}`);
        continue;
      }
      for (const row of data ?? []) seenKeys.add(JSON.stringify(row[pk]));
    }
    const tableDeleted = seenKeys.size;
    deletedTotal += tableDeleted;
    if (tableDeleted > 0) {
      progress = true;
      console.log(`  ${table.padEnd(30)} ${String(tableDeleted).padStart(5)} filas`);
    }
    if (errors.length > 0) failed.set(table, errors);
    else pending.delete(table);
  }
}
console.log(`  (pasadas de borrado: ${pass})`);
const leftovers = [];
for (const table of pending) {
  for (const err of failed.get(table) ?? ['sin detalle']) leftovers.push(`${table}.${err}`);
}

for (const email of emails) {
  const u = authUsers.get(email);
  if (!u) continue;
  const { error } = await db.auth.admin.deleteUser(u.id);
  if (error) leftovers.push(`auth.users (${email}): ${error}`);
  else console.log(`  ${'auth.users'.padEnd(30)} ${String(1).padStart(5)} usuario ${email}`);
}

console.log(`\nTotal filas borradas: ${deletedTotal}`);
if (leftovers.length) {
  console.log('\nCOSAS QUE NO SE PUDIERON BORRAR:');
  for (const l of leftovers) console.log(`  - ${l}`);
  process.exitCode = 1;
} else {
  console.log('Sin pendientes.');
}
