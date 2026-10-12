# Continuidad — RPO / RTO, backup y restore

## Objetivos

| Servicio | RPO | RTO | Como se cumple |
|---|---|---|---|
| App (Next en Vercel) | 0 | **15 min** | Deployments inmutables: rollback = redeploy del anterior (`docs/runbook.md`) |
| Datos (Supabase) | **24 h** | **60 min** | Backup diario 03:30 UTC con verificacion + restore probado (esta guia) |

- **RPO** = cuanto podemos perder si todo se rompe. 24 h: el ultimo dump bueno
  es el del dia anterior a las 03:30 UTC; todo lo escrito despues y antes del
  siguiente dump se pierde en el peor caso.
- **RTO** = cuanto tarda el servicio en volver. 60 min: el restore sobre una
  base scratch + smoke test + cutover, con el drill practicado.

### Supuestos (hay que confirmarlos, no estan en el repo)

1. **PITR de Supabase**: si el plan del proyecto tiene point-in-time recovery,
   el RPO real baja a minutos y el dump de CI pasa a ser la red de seguridad,
   no el limite. Revisar Dashboard → Database → Backups y **anotar el resultado
   en esta tabla**. Sin PITR, RPO = 24 h.
2. **Retencion de dumps**: los dumps cifrados se publican como GitHub Release
   por corrida (retencion indefinida). **No** se sube ninguna copia en claro a
   artifacts: el repo es publico y los `.sql` contienen PII de clientes. Si
   algun dia hace falta almacenamiento realmente offsite, migrar el Release a
   un bucket con lifecycle propio.
3. **Clave de cifrado `age`**: la clave **privada** vive fuera del repo y del
   CI (la usa quien restaura). El secreto `AGE_RECIPIENT` en GitHub es solo la
   clave publica. **Sin la privada no hay restore**: respaldarla aparte (gestor
   de password / papel).
4. **Scheduled workflows**: GitHub desactiva los workflows con `schedule` tras
   60 dias sin actividad en repos **publicos** (este lo es). Se cubre con
   `.github/workflows/keepalive.yml`, que una vez por mes re-habilita los
   workflows programados via API (eso resetea el contador sin crear commits, asi
   que no depende de branch protection). Si todavia asi se desactiva, revisar la
   pestaña Actions y reactivarlo a mano.

### Estado actual

- [x] Backup programado diario (roles + schema + data) con manifiesto + SHA256 (`.github/workflows/backup.yml`)
- [x] Cifrado con `age` y publicacion como GitHub Release (retencion indefinida)
- [x] Keepalive mensual (re-habilita workflows via API) para el auto-disable en repos publicos (`.github/workflows/keepalive.yml`)
- [x] Verificacion estructural de los dumps (CREATE TABLE / COPY / INSERT INTO)
- [x] Verificacion de restore contra base scratch cuando hay `DEV_DB_URL`
- [ ] Primer drill de restore registrado (seccion Drill)
- [ ] PITR confirmado en el dashboard y anotado arriba

## Backup

### Automatico (el que sostiene el RPO)

Workflow **"Backup de produccion"**: diario 03:30 UTC + `workflow_dispatch`
manual. Requiere el secret `PROD_DB_URL` (sin el, se saltea y no rompe CI) y
opcionalmente:

- `DEV_DB_URL` para habilitar el chequeo de restore en una base scratch.
- `AGE_RECIPIENT` (clave publica de `age`) para cifrar y publicar el Release.
  Sin este secreto el backup corre igual, pero sin cifrado ni Release.

El script genera tres dumps (metodo oficial de Supabase para un restore
completo) mas un manifiesto:

| Archivo | Contenido |
|---|---|
| `*.roles.sql` | Roles custom (`--role-only`; **no** incluye passwords) |
| `*.schema.sql` | DDL del schema `public` |
| `*.data.sql` | Datos de todas las tablas (`--data-only --use-copy`), incluye `auth.users` |
| `*.manifest.json` | SHA256 + tamano por archivo y conteo de filas por tabla |

Los tres `.sql` + el manifiesto se empaquetan en `vynko-backup-<ts>.tar.gz`,
se cifran a `vynko-backup-<ts>.tar.gz.age` y se adjuntan a un GitHub Release
(`backup-<ts>`) junto a un `.sha256`.

### A mano

```powershell
# Requiere: CLI de Supabase (npm i -g supabase) y .env.db en la raiz
# (a partir de scripts/.env.db.example). El restore test necesita ademas psql.
.\scripts\backup-db.ps1                       # dumps + manifiesto + verificacion
.\scripts\backup-db.ps1 -RestoreUrl <url-db-vacia>   # ademas prueba el restore
```

Salida en `scripts/dumps/` (ignorado por git): los tres `vynko-backup-<ts>.*.sql`
+ `vynko-backup-<ts>.manifest.json`.

## Restore (RTO 60 min)

1. **Descargar y descifrar** el Release `backup-<ts>` elegido:
   ```bash
   age --decrypt -i <clave-privada>.txt -o vynko-backup-<ts>.tar.gz vynko-backup-<ts>.tar.gz.age
   tar -xzf vynko-backup-<ts>.tar.gz
   ```
   Verificar el `.sha256` adjunto y, para cada archivo, que coincida con el
   `sha256` del `manifest.json`.
2. **Elegir destino**: base scratch para probar; la de prod solo en incidente
   real y con las cuentas ajenas revisadas.
3. **Aplicar** los tres dumps en orden (el resumen de conteos va al final):
   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file vynko-backup-<ts>.roles.sql \
     --file vynko-backup-<ts>.schema.sql \
     --command 'SET session_replication_role = replica' \
     --file vynko-backup-<ts>.data.sql \
     --dbname <URL_DESTINO>
   ```
   - `roles.sql` puede re-crear roles que ya existen en un proyecto Supabase
     nuevo; si falla por rol existente, aplicar el resto sin ese archivo.
   - Los roles custom con `LOGIN` NO traen password: resetearla a mano
     (`alter role <rol> with password '...'`).
4. **Migraciones posteriores**: el dump refleja el schema del momento. Aplicar
   los `migrations/NNN_*.sql` con numeracion mayor al timestamp del dump
   (`supabase db query --db-url <URL> -f migrations\NNN_*.sql` o el SQL editor).
5. **Verificar**: conteos contra el manifiesto; en prod, `GET /api/health?check=db`
   → 200, login, y una venta de prueba ( stock y numeracion de documentos).
6. **Reanudar** escrituras y **registrar** el evento abajo.

Los webhooks de MercadoPago pendientes se reintentan solos (MP reintenta ~24 h);
las ventas que se caigan durante la ventana las cubre el reintento del cliente.

### Fuera de alcance

- **Objetos de Storage**: el dump solo guarda la *metadata* de `storage.objects`.
  Los archivos en si (avatares, adjuntos) NO se respaldan con este workflow;
  viven en el bucket de Supabase. Si se vuelven criticos, agregar un espejo del
  bucket (por ejemplo `rclone sync` al mismo Release o a otro destino).
- **Secretos de Auth** (JWT secret, SMTP, providers OAuth): no estan en la base;
  reconfigurarlos en el proyecto nuevo desde Supabase Dashboard.

## Drill (trimestral)

1. `.\scripts\backup-db.ps1 -RestoreUrl <scratch-vacia>`: tiene que terminar en
   "Restore verificado: conteos origen == destino".
2. Smoke test contra el scratch: login + crear producto + venta.
3. Anotar la duracion real del paso 1+2; si supera el RTO de 60 min, bajarlo o
   arreglar el proceso (no dejar el numero inventado).
4. Registrar en la tabla de abajo.

## Registro

| Fecha | Tipo (backup/drill) | Dump usado | Duración | Resultado | Responsable |
|---|---|---|---|---|---|
| — | — | — | — | pendiente | — |
