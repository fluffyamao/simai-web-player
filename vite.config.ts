import { resolve } from 'node:path'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// The B_full WAV files are not in the repository; the demo serves a local copy when there is one.
const sampleRoot = resolve(import.meta.dirname, 'assets/hit-sounds/B_full')
const sampleFiles = existsSync(sampleRoot) ? readdirSync(sampleRoot).filter((name) => name.endsWith('.wav')) : []

export default defineConfig({
  plugins: [{
    name: 'local-hit-sounds',
    configureServer(server) {
      server.middlewares.use('/hit-sounds/B_full', (req, res, next) => {
        const name = (req.url ?? '').split('?')[0]!.replace(/^\//, '')
        if (!sampleFiles.includes(name)) return next()
        res.setHeader('Content-Type', 'audio/wav')
        res.end(readFileSync(resolve(sampleRoot, name)))
      })
    },
  }],
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
