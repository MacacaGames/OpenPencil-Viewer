import test from 'node:test'
import assert from 'node:assert/strict'
import { readDownload } from '../../packages/transport/download.ts'
test('download progress, bounded announced size, short stream and cancel', async () => {
  const response = (bytes: Uint8Array, size: number) =>
    new Response(bytes, { headers: { 'Content-Length': String(size) } })
  const progress: number[] = []
  assert.deepEqual(
    new Uint8Array(
      await readDownload(
        response(new Uint8Array([1, 2, 3]), 3),
        3,
        10,
        new AbortController().signal,
        (n) => progress.push(n)
      )
    ),
    new Uint8Array([1, 2, 3])
  )
  assert.deepEqual(progress, [3])
  await assert.rejects(() =>
    readDownload(
      response(new Uint8Array([1, 2]), 3),
      3,
      10,
      new AbortController().signal,
      () => undefined
    )
  )
  await assert.rejects(() =>
    readDownload(
      response(new Uint8Array([1, 2, 3, 4]), 3),
      3,
      10,
      new AbortController().signal,
      () => undefined
    )
  )
  const cancel = new AbortController()
  cancel.abort()
  await assert.rejects(() =>
    readDownload(
      response(new Uint8Array([1]), 1),
      1,
      10,
      cancel.signal,
      () => undefined
    )
  )
  await assert.rejects(() =>
    readDownload(
      response(new Uint8Array([1]), 1),
      1,
      0,
      new AbortController().signal,
      () => undefined
    )
  )
})
