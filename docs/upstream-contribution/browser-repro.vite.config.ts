// Copy into scratch/ in a disposable upstream checkout. Serve only locally.
import { createReadStream } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { createOpenPencilAliases } from '../vite/aliases'

const root = resolve(import.meta.dirname, '..')
const fixtureDir = process.env.OPENPENCIL_REPRO_DIR
if (!fixtureDir)
  throw new Error('Set OPENPENCIL_REPRO_DIR to the public bundle directory')
const files: Record<string, string> = {
  '/fixture.fig': resolve(fixtureDir, 'image-heavy-400mib.fig'),
  '/control.fig': resolve(fixtureDir, 'controls/repaint-fit-tile.fig'),
  '/decode-control.fig': resolve(
    fixtureDir,
    'controls/decode-neighborhood.fig'
  ),
  '/canvaskit.wasm': resolve(
    root,
    'node_modules/canvaskit-wasm/bin/canvaskit.wasm'
  )
}
export default defineConfig({
  root: import.meta.dirname,
  resolve: { alias: createOpenPencilAliases(root) },
  server: {
    host: '127.0.0.1',
    port: 14320,
    strictPort: true,
    fs: { allow: [root] }
  },
  plugins: [
    {
      name: 'public-reproduction-files',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const file = files[(request.url ?? '').split('?')[0]]
          if (!file) return next()
          response.setHeader(
            'Content-Type',
            file.endsWith('.wasm')
              ? 'application/wasm'
              : 'application/octet-stream'
          )
          const stream = createReadStream(file)
          stream.on('error', () => {
            response.statusCode = 404
            response.end()
          })
          stream.pipe(response)
        })
      }
    }
  ]
})
