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
2. **Retencion de artifacts**: los dumps de CI viven 30 dias en GitHub
   (artifacts del repo). Si se necesita mas historial, subirlos a un bucket con
   lifecycle propio.
3. **Scheduled workflows**: GitHub desactiva los workflows con `schedule` tras
   60 dias sin actividad en el repo. Revisar la pestaña Actions cada tanto; si
   quedo desactivado, reactivarlo desde la UI.

### Estado actual

- [x] Backup programado diario con manifiesto + SHA256 (`.github/workflows/backup.yml`)
- [x] Verificacion estructural del dump (CREATE TABLE / INSERT INTO)
- [x] Verificacion de restore contra base scratch cuando hay `DEV_DB_URL`
- [ ] Primer drill de restore registrado (seccion Drill)
- [ ] PITR confirmado en el dashboard y anotado arriba
- [ ] Retencion de dumps mas alla de 30 dias

## Backup

### Automatico (el que sostiene el RPO)

Workflow **"Backup de produccion"**: diario 03:30 UTC + `workflow_dispatch`
manual. Requiere el secret `PROD_DB_URL` (sin el, se saltea y no rompe CI) y
opcionalmente `DEV_DB_URL` para habilitar el chequeo de restore. El resultado
queda como artifact (`vynko-backup-<run>`, 30 dias) con el `.sql` y el
`.manifest.json`.

### A mano

```powershell
# Requiere: CLI de Supabase (npm i -g supabase) y .env.db en la raiz
# (a partir de scripts/.env.db.example)
.\scripts\backup-db.ps1                       # dump + manifiesto + verificacion
.\scripts\backup-db.ps1 -RestoreUrl <url-db-vacia>   # ademas prueba el restore
```

Salida en `scripts/dumps/` (ignorado por git): `vynko-backup-<ts>.sql` +
`vynko-backup-<ts>.manifest.json` (conteos por tabla y SHA256).

## Restore (RTO 60 min)

1. **Elegir dump**: el mas reciente sano. Verificar contra el manifiesto:
   `Get-FileHash scripts\dumps\vynko-backup-<ts>.sql -Algorithm SHA256` tiene que
   dar el `sha256` del `.manifest.json`.
2. **Elegir destino**: base scratch para probar; la de prod solo en incidente
   real y con las cuentas ajenas revisadas.
3. **Aplicar**:
   ```powershell
   supabase db query --db-url <URL_DESTINO> -f scripts\dumps\vynko-backup-<ts>.sql
   ```
4. **Migraciones posteriores**: el dump refleja el schema del momento. Aplicar
   los `migrations/NNN_*.sql` con numeracion mayor al timestamp del dump
   (`supabase db query --db-url <URL> -f migrations\NNN_*.sql` o el SQL editor).
5. **Verificar**: conteos contra el manifiesto; en prod, `GET /api/health?check=db`
   → 200, login, y una venta de prueba ( stock y numeracion de documentos).
6. **Reanudar** escrituras y **registrar** el evento abajo.

Los webhooks de MercadoPago pendientes se reintentan solos (MP reintenta ~24 h);
las ventas que se caigan durante la ventana las cubre el reintento del cliente.

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
