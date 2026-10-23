import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // `npm run dev` serves the demo page; put local test charts in demo/samples/<name>/
  root: 'demo',
  publicDir: 'samples',
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'simai-web-player',
    },
  },
  test: {
    root: import.meta.dirname,
    include: ['test/**/*.test.ts'],
  },
})
