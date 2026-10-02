import { readFileSync } from 'node:fs'
import { output, root } from './common.ts'
export function verifyUpstream() {
  const lock = JSON.parse(
    readFileSync(root + '/upstream.lock.json', 'utf8')
  ) as { sha: string; repository: string }
  if (
    output('git', ['rev-parse', 'HEAD'], root + '/upstream/open-pencil') !==
      lock.sha ||
    output('git', ['status', '--porcelain'], root + '/upstream/open-pencil')
  )
    throw new Error('upstream dirty or SHA mismatch')
  if (
    output('git', [
      'config',
      '-f',
      '.gitmodules',
      'submodule.upstream/open-pencil.url'
    ]) !== lock.repository
  )
    throw new Error('official upstream URL required')
  if (
    output(
      'git',
      ['remote', 'get-url', 'origin'],
      root + '/upstream/open-pencil'
    ) !== lock.repository
  )
    throw new Error('official upstream origin required')
  console.log('upstream pristine, SHA ' + lock.sha)
}
if (process.argv[1]?.endsWith('/verify-upstream.ts')) verifyUpstream()
