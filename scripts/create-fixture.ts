import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { root, run, bun } from './common.ts'
const target = root + '/.work/editor/create-fixture.ts'
writeFileSync(
  target,
  readFileSync(root + '/tests/adapter/create-fixture.ts', 'utf8').replace(
    '../../tests/fixtures/basic.fig',
    root + '/tests/fixtures/basic.fig'
  )
)
try {
  run(bun, ['run', 'create-fixture.ts'], root + '/.work/editor')
} finally {
  unlinkSync(target)
}
