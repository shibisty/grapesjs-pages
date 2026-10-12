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
  },
});
