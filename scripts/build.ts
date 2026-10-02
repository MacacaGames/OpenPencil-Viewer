import { mkdirSync, cpSync, rmSync, existsSync } from 'node:fs'
import { build } from 'esbuild'
import { root, run, bun } from './common.ts'
if (!process.argv.includes('--api-only')) {
  run(process.execPath, ['--import', 'tsx', 'scripts/prepare-upstream.ts'])
  run(bun, ['run', 'build:packages'], root + '/.work/editor')
  run(bun, ['run', 'vite', 'build'], root + '/.work/editor')
  mkdirSync(root + '/dist', { recursive: true })
  rmSync(root + '/dist/web', { recursive: true, force: true })
  cpSync(root + '/.work/editor/dist', root + '/dist/web', { recursive: true })
  cpSync(
    root + '/upstream/open-pencil/LICENSE',
    root + '/dist/LICENSE.open-pencil'
  )
} else if (!existsSync(root + '/dist/web/index.html')) {
  throw new Error('Build the native web assets before --api-only')
}
rmSync(root + '/dist/api', { recursive: true, force: true })
await build({
  entryPoints: [
    root + '/apps/api/server.ts',
    root + '/apps/api/check-config.ts'
  ],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outdir: root + '/dist/api',
  packages: 'external'
})
