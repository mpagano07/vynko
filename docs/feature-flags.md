# Feature flags

Flags de **release**: encender o apagar una funcionalidad sin deploy, y
aplicarla de a poco (1% → 10% → 100%).

No confundir con lo que ya existe:

| Mecanismo | Alcance | Para qué |
|---|---|---|
| `feature_flags` (este doc) | global, por deploy | release gradual y kill switch |
| `tenants.settings` (`src/lib/tenant-config.ts`) | por empresa | módulos/ajustes del tenant |
| `profiles.is_admin` | por usuario | autorización (no es un toggle) |

## Uso en código

```ts
import { isFeatureEnabled, getFeatureFlags } from '@/lib/feature-flags';

if (await isFeatureEnabled('new_checkout', { userId: auth.userId, tenantId: auth.tenantId })) {
  // rama nueva
}

// varios flags con UNA sola lectura (cachea 60 s)
const flags = await getFeatureFlags(['new_checkout', 'ai_forecast'], { userId: auth.userId });
```

- **Default apagado**: un flag sin fila o sin env no enciende nada.
- **Rollout estable**: el bucket se calcula con FNV-1a sobre `flag|userId`, así
  el mismo usuario siempre ve lo mismo (si no hay usuario, se usa `tenantId`;
  si no hay ninguno, `anonymous`).
- **Kill switch**: `enabled=false` apaga aunque `rollout_percent=100`.

## Cómo se enciende

1. **Panel/API (producción)**: `PUT /api/admin/feature-flags` (solo admin,
   fail closed):
   ```json
   { "flag_key": "new_checkout", "enabled": true, "rollout_percent": 10 }
   ```
   `GET /api/admin/feature-flags` lista lo que hay. El cambio se ve en ~60 s
   (TTL del cache en memoria de cada instancia).
2. **Variable de entorno (corte de emergencia)**: `FEATURE_<CLAVE>=on|off|0..100`
   en Vercel. Tiene prioridad sobre la base y sirve para forzar algo sin tocar
   datos:
   - `FEATURE_NEW_CHECKOUT=off` → apagado para todos, pase lo que pase;
   - `FEATURE_NEW_CHECKOUT=100` → encendido para todos;
   - `FEATURE_NEW_CHECKOUT=25` → 25% de rollout.
   El nombre es la clave en mayúsculas (`new_checkout` → `FEATURE_NEW_CHECKOUT`).
3. **Migración (por defecto de una feature nueva)**:
   ```sql
   insert into public.feature_flags (flag_key, enabled, rollout_percent, description)
   values ('new_checkout', false, 0, 'Checkout con pasos separados');
   ```

## Detalles de implementación

- Tabla: `migrations/055_feature_flags.sql` (RLS deny-all: solo service role,
  igual que `rate_limit_buckets`).
- Servicio: `src/lib/feature-flags.ts` (cache 60 s por instancia + dedupe de
  lectura en vuelo; si la base falla se conserva el último snapshot, nunca se
  asume "todo encendido").
- API: `src/app/api/admin/feature-flags/route.ts` (admin fail closed + CSRF).
- Tests: `src/lib/feature-flags.test.ts`.
