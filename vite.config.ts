import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      // UMD global: window.grapesjsPages = { default: pluginFn, IndexedDbPageStore, ... }
      name: 'grapesjsPages',
      fileName: (format) => (format === 'umd' ? 'grapesjs-pages.umd.cjs' : 'grapesjs-pages.js'),
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      // GrapesJS itself is never bundled: the plugin runs against
      // whatever grapesjs instance the host page already loaded.
      external: ['grapesjs'],
      output: {
        exports: 'named',
        globals: { grapesjs: 'grapesjs' },
      },
    },
    sourcemap: true,
  },
});
