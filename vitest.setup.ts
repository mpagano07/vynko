import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// La suite tiene que poder afirmar que un limite bloquea (429), asi que el store
// distribuido no puede depender de la funcion `rate_limit_hit`: en CI y en local
// la migracion puede no estar aplicada, el RPC falla, el limiter deja pasar por
// fail-open y los tests de rate limiting quedan sin verificar sin avisar.
//
// El camino de Postgres no se pierde: lo cubren `rate-limit.test.ts` con el RPC
// simulado y `verify-rls.mjs` contra la base real.
//
// Se usa `stubEnv` y no una asignacion directa a `process.env` para que un test
// pueda limpiarlo con `unstubAllEnvs()`; si se asigna a pelo, el stub no lo ve y
// el default del store queda fijado a memoria en todos los casos.
beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_STORE', 'memory');
});

afterEach(() => {
  cleanup();
});
