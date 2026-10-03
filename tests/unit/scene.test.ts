import test from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, strToU8 } from 'fflate'
import {
  encodeScene,
  decodeScene
} from '../../packages/transport/scene-wire.ts'
import { SceneCache } from '../../apps/api/scene.ts'

test('scene transport preserves binary resources, maps and sets without original archive', () => {
  const value = {
    version: 1,
    graph: {
      images: [new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])],
      overrides: new Map([['key', new Set(['node'])]])
    }
  }
  assert.deepEqual(decodeScene(encodeScene(value)), value)
  assert.throws(() =>
    decodeScene(zipSync({ 'scene.json': strToU8('{"version":2}') }))
  )
  assert.throws(() => decodeScene(zipSync({ '../scene.json': strToU8('{}') })))
  assert.throws(() =>
    decodeScene(
      zipSync({ 'scene.json': strToU8('{"version":1,"__proto__":{}}') })
    )
  )
})

test('scene cache evicts by byte budget and revision, never keeps oversized results', () => {
  const cache = new SceneCache(4)
  cache.put('file:old', new Uint8Array([1, 2]))
  cache.put('other:rev', new Uint8Array([3, 4]))
  assert.ok(cache.get('file:old'))
  cache.put('file:new', new Uint8Array([5, 6]))
  assert.equal(cache.get('other:rev'), undefined)
  assert.ok(cache.get('file:new'))
  cache.put('oversized', new Uint8Array(5))
  assert.equal(cache.get('oversized'), undefined)
})
