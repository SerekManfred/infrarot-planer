import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests der Offline-Logik (ohne Browser): gleicher Alias auf den Rechenkern wie im Build
export default defineConfig({
  resolve: {
    alias: { '@infrarot/rechenkern': fileURLToPath(new URL('../rechenkern/src/index.ts', import.meta.url)) },
  },
  test: { include: ['test/**/*.test.ts'] },
});
