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
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
