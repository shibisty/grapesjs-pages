import { defineConfig } from 'vitest/config';

/**
 * Test config, separate from vite.config.ts (that one is tuned for the lib
 * build into dist/). jsdom + fake-indexeddb, real grapesjs.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    globals: false,
    restoreMocks: true,
    css: false,
    // A real GrapesJS in jsdom: the archive and remote tests open several editors and pages,
    // which takes longer than vitest's 5 s default on slower machines (Windows, ~80 s per run).
    testTimeout: 30_000,
  },
});
