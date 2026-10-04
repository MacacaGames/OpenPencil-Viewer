import { mkdirSync, cpSync, rmSync, existsSync } from 'node:fs'
import { build } from 'esbuild'
import { root, run, bun, editorRoot, outputRoot } from './common.ts'
if (!process.argv.includes('--api-only')) {
  run(process.execPath, ['--import', 'tsx', 'scripts/prepare-upstream.ts'])
  run(bun, ['run', 'build:packages'], editorRoot)
  run(bun, ['run', 'vite', 'build'], editorRoot)
  mkdirSync(outputRoot, { recursive: true })
  rmSync(outputRoot + '/web', { recursive: true, force: true })
  cpSync(editorRoot + '/dist', outputRoot + '/web', { recursive: true })
  cpSync(
    root + '/upstream/open-pencil/LICENSE',
    outputRoot + '/LICENSE.open-pencil'
  )
} else if (!existsSync(outputRoot + '/web/index.html')) {
  throw new Error('Build the native web assets before --api-only')
}
rmSync(outputRoot + '/api', { recursive: true, force: true })
await build({
  entryPoints: [
    root + '/apps/api/server.ts',
    root + '/apps/api/check-config.ts'
  ],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outdir: outputRoot + '/api',
  packages: 'external'
})
await build({
  entryPoints: [root + '/packages/upstream-adapter/remote-memory.ts'],
  bundle: true,
  platform: 'browser',
  target: 'chrome111',
  format: 'iife',
  outfile: outputRoot + '/api/remote-memory.js'
})
await build({
  entryPoints: [root + '/packages/upstream-adapter/server-parser.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: outputRoot + '/api/scene-parser.js',
  alias: {
    '@open-pencil/core/io/formats/fig':
      editorRoot + '/packages/core/dist/io/formats/fig/index.js',
    '@open-pencil/core/scene-transfer':
      editorRoot + '/packages/core/dist/kiwi/fig/parse/transfer.js'
  },
  nodePaths: [editorRoot + '/node_modules']
})
await build({
  entryPoints: [root + '/packages/upstream-adapter/server-renderer.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: outputRoot + '/api/viewer-renderer.js',
  alias: {
    '@open-pencil/core/io/formats/fig':
      editorRoot + '/packages/core/dist/io/formats/fig/index.js',
    '@open-pencil/core/io/formats/raster':
      editorRoot + '/packages/core/dist/io/formats/raster/index.js',
    '@open-pencil/core/canvas':
      editorRoot + '/packages/core/dist/canvas/index.js',
    '@open-pencil/core/text': editorRoot + '/packages/core/dist/text/index.js',
    'css-tree':
      editorRoot +
      '/node_modules/.bun/css-tree@3.2.1/node_modules/css-tree/dist/csstree.esm.js'
  },
  external: ['canvaskit-wasm/full'],
  nodePaths: [editorRoot + '/node_modules']
})
mkdirSync(outputRoot + '/api/vendor', { recursive: true })
cpSync(
  editorRoot + '/node_modules/canvaskit-wasm/bin/full/canvaskit.js',
  outputRoot + '/api/vendor/canvaskit.cjs'
)
cpSync(
  editorRoot + '/node_modules/canvaskit-wasm/bin/full/canvaskit.wasm',
  outputRoot + '/api/vendor/canvaskit.wasm'
)

cpSync(
  editorRoot + '/node_modules/canvaskit-wasm/LICENSE',
  outputRoot + '/api/vendor/LICENSE.canvaskit'
)
