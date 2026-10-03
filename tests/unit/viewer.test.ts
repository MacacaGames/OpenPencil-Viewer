import test from 'node:test'
import assert from 'node:assert/strict'
import { parseViewport } from '../../packages/contracts/viewer.ts'
test('viewer requests bound output pixels, zoom, coordinates and keys', () => {
  const valid = {
    page: 'page',
    x: '0',
    y: '-1',
    scale: '2',
    width: '1024',
    height: '768'
  }
  assert.equal(parseViewport(valid).width, 1024)
  const rejected: Record<string, string>[] = [
    { width: '100000' },
    { width: '1536', height: '1536' },
    { scale: '0' },
    { scale: 'NaN' },
    { x: 'Infinity' },
    { path: '/etc/passwd' }
  ]
  for (const patch of rejected)
    assert.throws(() => parseViewport({ ...valid, ...patch }))
})
