import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Todos los specs comparten la misma base y mutan datos (crear/editar/
  // eliminar productos, ajustar stock), por lo que deben correr en serie
  // para ser deterministas. Con varios workers se pisan entre sí.
  workers: 1,
  // Timeout por test: los specs mutan datos reales (crear productos, registrar
  // ventas) y en serie bajo carga el servidor de dev puede tardar, sobre todo
  // en el cierre del modal de creación. 60s evita flakes por timeout.
  timeout: 60_000,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
  globalTeardown: './e2e/global-teardown.ts',
  webServer: {
    // E2E=1 desactiva el rate limiting SOLO fuera de produccion (ver
    // src/lib/rate-limit.ts). Sin esto el suite agota el limite de 20 intentos
    // por IP cada 15 minutos, devuelve 429 y los tests de login fallan de
    // forma intermitente segun cuantas corridas haya hecho el developer.
    //
    // Va en `env` y no en el comando porque `E2E=1 npm run dev` es sintaxis
    // POSIX y en Windows (cmd.exe) rompe el arranque del server.
    command: 'npm run dev',
    url: 'http://localhost:3000',
    env: { E2E: '1' },
    // False a proposito: si se reutilizara un `npm run dev` del developer
    // (arrancado sin E2E=1), el suite correria contra un server con el rate
    // limit activo y volverian los 429. Fallar de forma clara es mejor que
    // fallar de forma intermitente y confusa.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
