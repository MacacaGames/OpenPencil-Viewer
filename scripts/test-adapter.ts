import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { root, run, bun } from './common.ts'
const target = root + '/.work/editor/portal-readonly.test.ts'
const test = readFileSync(root + '/tests/adapter/readonly.test.ts', 'utf8')
  .replace("'@open-pencil/core/editor'", "'./packages/core/src/editor/create'")
  .replaceAll('../../.work/editor/', './')
writeFileSync(target, test)
try {
  run(bun, ['test', './portal-readonly.test.ts'], root + '/.work/editor')
} finally {
  unlinkSync(target)
}
