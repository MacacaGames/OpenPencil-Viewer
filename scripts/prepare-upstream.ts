import { mkdirSync, readFileSync, cpSync, readdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { root, run, bun } from './common.ts'
import { verifyUpstream } from './verify-upstream.ts'
verifyUpstream()
const target = root + '/.work/editor'
mkdirSync(target, { recursive: true })
// Preserve only the package cache. A source removed by a future pinned commit
// must not remain discoverable by Vue/Vite in the disposable build tree.
for (const entry of readdirSync(target)) {
  if (entry !== 'node_modules')
    rmSync(target + '/' + entry, { recursive: true, force: true })
}
const archive = spawnSync(
  'git',
  [
    '-c',
    'filter.lfs.process=',
    '-c',
    'filter.lfs.smudge=',
    '-c',
    'filter.lfs.required=false',
    'archive',
    'HEAD'
  ],
  { cwd: root + '/upstream/open-pencil', maxBuffer: 128 * 1024 * 1024 }
)
if (archive.status !== 0) throw new Error('archive failed')
const extracted = spawnSync('tar', ['-x', '-C', target], {
  input: archive.stdout
})
if (extracted.status !== 0) throw new Error('extract failed')
for (const name of readFileSync(root + '/patches/open-pencil/series', 'utf8')
  .split('\n')
  .filter(Boolean)) {
  run(
    'git',
    [
      '--git-dir=/dev/null',
      'apply',
      '--check',
      root + '/patches/open-pencil/' + name
    ],
    target
  )
  run(
    'git',
    ['--git-dir=/dev/null', 'apply', root + '/patches/open-pencil/' + name],
    target
  )
}
for (const name of ['contracts', 'transport', 'upstream-adapter'])
  cpSync(root + '/packages/' + name, target + '/portal/' + name, {
    recursive: true
  })
cpSync(
  root + '/packages/upstream-adapter/PortalWorkspace.vue',
  target + '/src/views/PortalWorkspace.vue'
)
run(bun, ['install', '--frozen-lockfile'], target)
