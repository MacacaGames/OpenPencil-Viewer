import { build } from 'esbuild'
import { mkdirSync, copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const directory = resolve('.work/remote-container-fixture')
mkdirSync(directory, { recursive: true })
await build({
  entryPoints: ['tests/container/remote-server.ts'],
  outfile: resolve(directory, 'container-harness.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external'
})
copyFileSync('tests/fixtures/basic.fig', resolve(directory, 'basic.fig'))
copyFileSync(
  'tests/container/remote.Dockerfile',
  resolve(directory, 'Dockerfile')
)
const result = spawnSync(
  'docker',
  [
    'build',
    '--build-arg',
    'PORTAL_IMAGE=' +
      (process.env.PORTAL_TEST_IMAGE ?? 'openpencil-viewer:0.1.0'),
    '-t',
    process.env.PORTAL_SYNTHETIC_IMAGE ??
      'openpencil-viewer:selkies-synthetic-test',
    directory
  ],
  { stdio: 'inherit' }
)
if (result.status !== 0) throw new Error('Synthetic container build failed')
