import { readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs'
import { root, run, bun, editorRoot } from './common.ts'
for (const name of readdirSync(root + '/tests/adapter')
  .filter((name) => name.endsWith('.test.ts'))
  .sort()) {
  const target = editorRoot + '/portal-' + name
  const test = readFileSync(root + '/tests/adapter/' + name, 'utf8')
    .replaceAll(
      "'@open-pencil/core/editor'",
      "'./packages/core/src/editor/create'"
    )
    .replaceAll('../../.work/editor/', './')
  writeFileSync(target, test)
  try {
    // Separate processes keep native runtime mocks from leaking into graph tests.
    run(bun, ['test', './portal-' + name], editorRoot)
  } finally {
    unlinkSync(target)
  }
}
