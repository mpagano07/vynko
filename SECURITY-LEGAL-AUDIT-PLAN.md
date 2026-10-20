# Plan de mejoras y fixes - Auditoría de Seguridad y Términos Legales

## Resumen
Basado en la auditoría completa realizada, este plan organiza las mejoras por prioridad (Crítica → Alta → Media → Baja) con tareas concretas, archivos a modificar y criterios de aceptación.

## 1. SEGURIDAD - Headers HTTP (Prioridad CRÍTICA/ALTA)

### SEC-01: Añadir Strict-Transport-Security (HSTS) - CRÍTICO
**Objetivo:** Forzar HTTPS y prevenir SSL stripping.

**Archivos a modificar:**
- `src/proxy.ts` - Función `withCsp`/añadir `withSecurityHeaders`

**Cambios:**
```ts
response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
```

**Acciones:**
- [ ] Añadir HSTS en todas las respuestas HTML (páginas) vía proxy
- [ ] Después de validar en producción (sin errores), solicitar inclusión en [HSTS Preload List](https://hstspreload.org/)

**Criterio aceptación:** Header presente en `https://vynko.dev/`, incluye `preload` e `includeSubDomains`.

---

### SEC-02: Protección Clickjacking (X-Frame-Options + frame-ancestors) - ALTO
**Objetivo:** Prevenir clickjacking/UI redressing.

**Archivos a modificar:**
- `src/proxy.ts`

**Cambios:**
```ts
response.headers.set('X-Frame-Options', 'DENY');
```
- Añadir `frame-ancestors 'none'` en CSP (complementario)

**Acción:** Añadir ambos headers globalmente.

**Criterio aceptación:** X-Frame-Options: DENY presente. CSP incluye `frame-ancestors 'none'`.

---

### SEC-03: X-Content-Type-Options: nosniff - MEDIO
**Objetivo:** Prevenir MIME type sniffing.

**Archivos a modificar:**
- `src/proxy.ts`

**Cambios:**
```ts
response.headers.set('X-Content-Type-Options', 'nosniff');
```

**Criterio aceptación:** Header presente en todas respuestas HTML.

---

### SEC-04: Referrer-Policy + COOP/COEP - MEDIO
**Objetivo:** Reducir fuga de información cross-origin y mejorar aislamiento.

**Archivos a modificar:**
- `src/proxy.ts`

**Cambios:**
```ts
response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
```

**Opcional (evaluar compatibilidad):**
```ts
response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp'); // COEP
response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');  // CORP
```

**Acción:** Implementar Referrer-Policy + COOP primero. Evaluar COEP/CORP en staging (puede romper embeds de terceros).

**Criterio aceptación:** Referrer-Policy y COOP presentes.

---

### SEC-05: Permissions-Policy - BAJO
**Objetivo:** Restringir features del navegador no usados.

**Archivos a modificar:**
- `src/proxy.ts`

**Cambios:**
```ts
response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)');
```

**Criterio aceptación:** Permissions-Policy configurado.

---

### SEC-06: Consolidar función de security headers - REFACTOR
**Objetivo:** Crear `withSecurityHeaders(response, nonce)` que incluya CSP + todos los headers anteriores. Reemplazar usos de `withCsp`.

**Archivos a modificar:**
- `src/proxy.ts` (refactor función + todos los returns)

**Beneficio:** Aplicación consistente en next(), redirects, errores, etc.

**Criterio aceptación:** Todos los responses HTML incluyen headers completos. Tests existentes siguen pasando.

---

## 2. SEGURIDAD - Validación de Inputs (Prioridad MEDIA)

### SEC-07: Añadir validación Zod en endpoints de billing - MEDIO
**Objetivo:** Validar payloads y prevenir inputs inesperados.

**Archivos a modificar:**
- `src/app/api/billing/create-checkout/route.ts`
- `src/app/api/billing/downgrade/route.ts` (revisar schema)

**Cambios:**
```ts
import { z } from 'zod';

const CreateCheckoutSchema = z.object({
  plan: z.enum(['starter', 'business']).nullable().optional(),
});

const parsed = CreateCheckoutSchema.safeParse(body);
if (!parsed.success) {
  return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
}
```

**Criterio aceptación:** Requests inválidos devuelven 400 con validación estructurada.

---

### SEC-08: Revisar rate limiting en endpoints auth/sensibles - MEDIO
**Objetivo:** Confirmar límites específicos en login/reset/OTP.

**Archivos a revisar:**
- `src/lib/rate-limit.ts`
- Endpoints auth (`src/app/api/auth/*`)

**Acción:** Verificar si existen límites por endpoint. Añadir si faltan (login, forgot-password, OTP). No aplicar a webhooks.

**Criterio aceptación:** Endpoints auth tienen rate limit apropiado documentado/testeado.

---

## 3. TÉRMINOS LEGALES - Actualizaciones (Prioridad ALTA)

### LEG-01: Términos y Condiciones (`/terminos`) - ALTO
**Objetivo:** Añadir información explícita sobre suscripciones auto-renovables.

**Archivos a modificar:**
- Página `/terminos` (Next.js app router: `src/app/terminos/page.tsx` o MDX)

**Puntos a añadir:**
- [ ] Suscripciones auto-renovables: renovación automática mensual/anual según plan
- [ ] Cancelación: debe realizarse **antes** de la fecha de renovación
- [ ] Acceso tras cancelación: permanece hasta fin del periodo ya pagado (no reembolso prorrateado) vs inmediato
- [ ] Modificación de precios: aviso previo razonable, derecho a cancelar antes de vigencia
- [ ] Periodos de prueba: vigencia, cuándo se cobra, cómo cancelar
- [ ] Propiedad intelectual (clarificar)
- [ ] Terminación, jurisdicción/ley aplicable
- [ ] Aceptación de términos

**Criterio aceptación:** Página actualizada, clara y sin ambigüedad sobre renovación/cancelación.

---

### LEG-02: Política de Privacidad (`/privacidad`) - ALTO
**Objetivo:** Transparencia sobre MoR, transferencias internacionales, subprocesadores.

**Archivos a modificar:**
- `src/app/privacidad/page.tsx`

**Puntos a añadir:**
- [ ] **Paddle como Merchant of Record (MoR):** Explicitar que el procesamiento de pagos, impuestos y cumplimiento fiscal lo realiza Paddle. Datos de tarjeta **no** son procesados directamente por Vynko.
- [ ] **Subprocesadores:** Listado (Supabase, Vercel, Paddle, Google AI/Gemini, Sentry - si aplica). Links a sus políticas.
- [ ] **Transferencias internacionales:** Explicar transferencias a EE.UU./terceros países, base legal (interés legítimo/ejecución contrato). Mencionar salvaguardas si aplica.
- [ ] **Base legal (GDPR):** Art. 6 (consentimiento, ejecución contrato, interés legítimo, cumplimiento legal).
- [ ] **Derechos del interesado (ARCO + RGPD):** Acceso, rectificación, supresión, oposición, limitación, portabilidad. Procedimiento + plazo de respuesta (máx. 30 días).
- [ ] **Plazos de retención:** Logs, facturación (obligaciones fiscales), cuentas inactivas/eliminadas.
- [ ] **Notificación de brechas de seguridad:** Procedimiento.

**Criterio aceptación:** Política completa con secciones nuevas, redactada de forma clara.

---

### LEG-03: Política de Reembolsos (`/reembolsos`) - ALTO
**Objetivo:** Aclarar gestión vía Paddle (MoR).

**Archivos a modificar:**
- `src/app/reembolsos/page.tsx`

**Puntos a añadir:**
- [ ] **Alcance MoR:** Reembolsos/ajustes se gestionan a través de Paddle (plataforma de cobro). Explicitar claramente.
- [ ] **Plazos y condiciones:** Periodo elegible, excepciones.
- [ ] **Renovaciones:** Solicitar reembolso **antes** de la fecha de renovación cuando corresponda. Renovaciones cobradas: revisar política por caso.
- [ ] **Proceso de solicitud:** Email/contacto + datos necesarios, tiempo estimado de respuesta.
- [ ] **Método y moneda:** Reembolso al método original (según Paddle). Impuestos tratados por Paddle.
- [ ] **Créditos vs reembolso:** Clarificar.

**Criterio aceptación:** Política alineada con flujo Paddle (100% off + refunds vía ajustes).

---

### LEG-04: Política de Cookies (`/cookies`) + Banner de Consentimiento - ALTA
**Objetivo:** Cumplimiento ePrivacy/GDPR (consentimiento granular).

**Archivos a modificar:**
- `src/app/cookies/page.tsx`
- Crear componente banner: `src/components/cookies/CookieConsent.tsx` (o `src/components/ui/cookie-consent.tsx`)
- Layout para incluir banner: `src/app/layout.tsx`

**Cambios Política Cookies:**
- [ ] Categorías: Esenciales (obligatorias), Funcionales, Analíticas, Publicitarias (si no aplica, indicarlo)
- [ ] Detalle cookies: `vynko_country`, `LAST_SEEN_COOKIE`, session cookies Supabase, Paddle cookies (si aplica), Sentry (si DSN)
- [ ] Duración por cookie
- [ ] Terceros + enlaces a políticas
- [ ] **Revocación de consentimiento:** Cómo cambiar preferencias (link en footer + mecanismo)
- [ ] Guía desactivación navegador

**Banner de consentimiento:**
- [ ] Modal/bottom bar con "Aceptar todas", "Rechazar", "Personalizar/Ajustes"
- [ ] Guardar preferencia (cookie consent) con fecha/versión
- [ ] Respeta preferencias (no cargar scripts de terceros no aceptados)
- [ ] Accesible (focus trap, ARIA)
- [ ] Persistente (localStorage/cookie)
- [ ] Botón "Cambiar preferencias" en footer

**Criterio aceptación:** Banner funcional, preferencias persistentes, política actualizada, link revocación visible.

---

## 4. SECURITY.TXT (Opcional pero recomendado) - BAJA

### SEC-09: Añadir security.txt - BAJO
**Archivo nuevo:** `public/.well-known/security.txt`

```txt
Contact: security@vynko.dev
Expires: 2027-10-20T23:59:59Z
Preferred-Languages: es, en
Policy: https://vynko.dev/privacidad
```

**Criterio aceptación:** Accesible en `https://vynko.dev/.well-known/security.txt`

---

## 5. CHECKLIST DE VALIDACIÓN POST-IMPLEMENTACIÓN

### Seguridad (Headers)
- [ ] Verificar headers con [SecurityHeaders.com](https://securityheaders.com/?q=vynko.dev) → objetivo **A/A+**
- [ ] Verificar con [Mozilla Observatory](https://observatory.mozilla.org/analyze/vynko.dev) → mejorar score
- [ ] Probar HSTS Preload eligibility tras deploy estable
- [ ] Probar CSP sin romper funcionalidad (checkout Paddle, overlay, scripts)

### Funcionalidad
- [ ] Login/logout OK
- [ ] Checkout Paddle (con VPN país no-AR) OK
- [ ] Webhooks Paddle siguen recibiendo firmas OK
- [ ] Rate limiting no bloquea uso normal

### Legal
- [ ] Revisar páginas legales en prod (responsive, ortografía)
- [ ] Banner cookies aparece 1ª visita, persiste elección
- [ ] Link "Cambiar preferencias cookies" funciona
- [ ] Rutas `/terminos`, `/privacidad`, `/cookies`, `/reembolsos` accesibles públicas

---

## 6. ORDEN DE EJECUCIÓN RECOMENDADO

1. **SEC-01–SEC-06** (Headers) - CRÍTICO/ALTO → commit separado `feat(security): add comprehensive security headers`
2. **SEC-07–SEC-08** (Validación + Rate limit) → `feat(security): input validation and rate limit review`
3. **SEC-09** (security.txt) → `docs(security): add security.txt`
4. **LEG-01–LEG-03** (Términos/Privacidad/Reembolsos) → `docs(legal): update terms, privacy, refunds for MoR/compliance`
5. **LEG-04** (Cookies + Banner) → `feat(legal): add cookie consent banner and update policy`

**Recomendación:** Hacer commits atómicos por grupo para facilitar review.