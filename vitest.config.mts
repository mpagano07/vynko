import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      // Piso medido sobre la suite actual (71.68 / 64.33 / 70.79 / 73.17).
      // Un poco por debajo a proposito: el objetivo es detectar caidas grandes,
      // no obligar a tocar el umbral cada vez que se agrega una rama.
      thresholds: {
        statements: 70,
        branches: 63,
        functions: 69,
        lines: 71,
      },
    },
  },
})
