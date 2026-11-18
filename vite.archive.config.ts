import { defineConfig } from 'vite';
import { resolve } from 'path';

/** `dist/archive.js`: the archive format alone (Node and browsers, ES module). */
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/archive/index.ts'),
      fileName: () => 'archive.js',
      formats: ['es'],
    },
    sourcemap: true,
  },
});
