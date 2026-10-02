import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { zipSync, deflateSync } from 'fflate'
import { checkFigSafety } from '../../packages/transport/fig-safety.ts'
test('legal fixture passes bounded archive + nested Kiwi preflight', async () => {
  checkFigSafety(await readFile('tests/fixtures/basic.fig'))
})
test('archive bomb, truncated kiwi, malformed nested payload fail closed', () => {
  assert.throws(() =>
    checkFigSafety(
      zipSync({ 'canvas.fig': new Uint8Array(2 * 1024 * 1024) }),
      1024
    )
  )
  assert.throws(() => checkFigSafety(new TextEncoder().encode('fig-kiwi')))
  const schema = deflateSync(new Uint8Array(10))
  const data = deflateSync(new Uint8Array(2 * 1024 * 1024))
  const bytes = new Uint8Array(20 + schema.length + data.length)
  bytes.set(new TextEncoder().encode('fig-kiwi'))
  const view = new DataView(bytes.buffer)
  view.setUint32(12, schema.length, true)
  bytes.set(schema, 16)
  view.setUint32(16 + schema.length, data.length, true)
  bytes.set(data, 20 + schema.length)
  assert.throws(() => checkFigSafety(bytes, 1024))
})
