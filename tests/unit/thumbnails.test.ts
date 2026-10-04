import test from 'node:test'
import assert from 'node:assert/strict'
import { ThumbnailCache } from '../../apps/api/thumbnails.ts'
import { remoteDisplay } from '../../packages/contracts/remote-display.ts'
const limits = {
  maxWidth: 1920,
  maxHeight: 1080,
  maxPixels: 2073600,
  maxDpi: 192
}
test('remote display fits live CSS viewport/DPR within pixel budget and validates UI scale', () => {
  const normal = remoteDisplay(
    { width: 1200, height: 800, dpr: 1, uiScale: 1.25 },
    limits
  )
  assert.deepEqual(
    [normal.width, normal.height, normal.density],
    [1200, 800, 1]
  )
  const retina = remoteDisplay(
    { width: 1200, height: 800, dpr: 2, uiScale: 1.5 },
    limits
  )
  assert.deepEqual([retina.width, retina.height], [1620, 1080])
  assert.equal(retina.density, 1.35)
  assert.ok(retina.width * retina.height <= limits.maxPixels)
  for (const patch of [
    { width: Infinity },
    { height: 0 },
    { dpr: 100 },
    { uiScale: 20 },
    { width: '1200' }
  ])
    assert.throws(() =>
      remoteDisplay(
        { width: 1200, height: 800, dpr: 2, uiScale: 1.25, ...patch },
        limits
      )
    )
})
test('temporary thumbnails share inflight/results, expire/evict and bound concurrent extraction', async () => {
  let now = 0,
    calls = 0,
    active = 0,
    peak = 0
  const cache = new ThumbnailCache(16, 2, () => now)
  const generate = async () => {
    calls++
    active++
    peak = Math.max(peak, active)
    await new Promise((r) => setTimeout(r, 5))
    active--
    return new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
  }
  try {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => cache.get('same-revision', generate))
    )
    assert.equal(calls, 1)
    assert.ok(results.every((x) => x?.length === 8))
    await cache.get('same-revision', generate)
    assert.equal(calls, 1)
    await cache.get('new-revision', generate)
    await cache.get('third', generate)
    await cache.get('same-revision', generate)
    assert.equal(calls, 4)
    now += 30 * 60000 + 1
    await cache.get('same-revision', generate)
    assert.equal(calls, 5)
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => cache.get('parallel-' + i, generate))
    )
    assert.equal(peak, 2)
    let missing = 0
    await cache.get('missing', async () => {
      missing++
      return null
    })
    await cache.get('missing', async () => {
      missing++
      return null
    })
    assert.equal(missing, 1)
    now += 5 * 60000 + 1
    await cache.get('missing', async () => {
      missing++
      return null
    })
    assert.equal(missing, 2)
  } finally {
    await cache.close()
  }
  await assert.rejects(() => cache.get('after-close', generate))
})
