import { test, expect, mock } from 'bun:test'
import { SceneGraph } from '@open-pencil/scene-graph'
import type { CanvasKit } from 'canvaskit-wasm'
import {
  ImagePreviewCache,
  previewEdge,
  useViewportImageRendering,
  type ImagePreview
} from '../../.work/editor/packages/core/src/canvas/images/previews'
import { createImageCache } from '../../.work/editor/packages/core/src/canvas/images/cache'
import { createCanvasRenderLoop } from '../../.work/editor/packages/vue/src/canvas/surface/render-loop'
import { createEditor } from '@open-pencil/core/editor'
import { renderSceneToCanvas } from '../../.work/editor/packages/core/src/canvas/renderer/pipeline'
import type { SkiaRenderer } from '@open-pencil/core/canvas'
import type { Canvas } from 'canvaskit-wasm'

let calls = 0
let complete: (kit: CanvasKit) => void = () => undefined
mock.module('canvaskit-wasm', () => ({
  default: () => {
    calls++
    if (calls === 1) return Promise.reject(new Error('initial failure'))
    return new Promise<CanvasKit>((resolve) => {
      complete = resolve
    })
  }
}))
test('CanvasKit concurrent initialization shares one heap and failed initialization retries', async () => {
  const { getCanvasKit } =
    await import('../../.work/editor/packages/core/src/canvaskit')
  await expect(getCanvasKit()).rejects.toThrow('initial failure')
  const a = getCanvasKit(),
    b = getCanvasKit()
  expect(calls).toBe(2)
  const kit = { marker: 'one heap' } as unknown as CanvasKit
  complete(kit)
  expect(await a).toBe(kit)
  expect(await b).toBe(kit)
  expect(await getCanvasKit()).toBe(kit)
  expect(calls).toBe(2)
})

function image(width = 4, height = 4) {
  let deleted = 0
  return {
    width: () => width,
    height: () => height,
    delete: () => {
      deleted++
    },
    deleted: () => deleted
  }
}
test('native image LRU accounts for mipmaps and releases owned handles once', () => {
  const cache = createImageCache<ReturnType<typeof image>>(172)
  const a = image(),
    b = image(),
    c = image(),
    d = image(20, 20)
  cache.set('a', a)
  cache.set('b', b)
  expect(cache.weight).toBe(172)
  cache.get('a')
  cache.set('c', c)
  expect(b.deleted()).toBe(1)
  expect(a.deleted()).toBe(0)
  expect(cache.set('oversized', d)).toBe(false)
  expect(d.deleted()).toBe(0)
  cache.clear()
  cache.clear()
  expect(a.deleted()).toBe(1)
  expect(c.deleted()).toBe(1)
  expect(cache.weight).toBe(0)
})

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const preview = (bytes = 5): ImagePreview => ({
  bytes: new Uint8Array(bytes),
  originalWidth: 1024,
  originalHeight: 512
})
test('preview decode is serialized, deduplicated, preserves source bytes and keeps old levels visible', async () => {
  const graph = new SceneGraph(),
    source = new Uint8Array([1, 2, 3])
  graph.images.set('a', source)
  const pending: Array<(value: ImagePreview) => void> = []
  let ready = 0,
    stopped = 0,
    calls = 0
  const cache = new ImagePreviewCache(() => {
    ready++
  }, 10)
  expect(cache.enabled).toBe(false)
  cache.setDecoder({
    decode: async (bytes) => {
      expect(bytes).toBe(source)
      calls++
      return new Promise((resolve) => {
        pending.push(resolve)
      })
    },
    destroy: () => {
      stopped++
    }
  })
  expect(cache.enabled).toBe(true)
  cache.get(graph, 'a', 128)
  cache.get(graph, 'a', 128)
  cache.get(graph, 'a', 256)
  expect(calls).toBe(1)
  pending.shift()?.(preview())
  await tick()
  expect(calls).toBe(2)
  expect(cache.get(graph, 'a', 256)?.key).toBe('a:preview:128')
  pending.shift()?.(preview(7))
  await tick()
  expect(cache.bytes).toBe(7)
  expect(cache.get(graph, 'a', 256)?.key).toBe('a:preview:256')
  expect([...source]).toEqual([1, 2, 3])
  expect(ready).toBe(2)
  cache.get(graph, 'a', 512)
  cache.destroy()
  expect(cache.enabled).toBe(false)
  pending.shift()?.(preview())
  await tick()
  expect(ready).toBe(2)
  expect(stopped).toBe(1)
  expect(cache.bytes).toBe(0)
  expect(cache.get(graph, 'a', 128)).toBeUndefined()
})
test('preview failure does not create a retry storm; document replacement discards stale completion', async () => {
  const a = new SceneGraph(),
    b = new SceneGraph()
  a.images.set('same', new Uint8Array([1]))
  b.images.set('same', new Uint8Array([2]))
  let calls = 0,
    ready = 0
  let complete: (value: ImagePreview) => void = () => undefined
  const cache = new ImagePreviewCache(() => {
    ready++
  })
  cache.setDecoder({
    decode: async () => {
      calls++
      if (calls === 1) throw new Error('bad image')
      return new Promise((resolve) => {
        complete = resolve
      })
    },
    destroy: () => undefined
  })
  cache.get(a, 'same', 128)
  await tick()
  cache.get(a, 'same', 128)
  expect(calls).toBe(1)
  cache.get(a, 'same', 256)
  cache.get(b, 'same', 128)
  complete(preview())
  await tick()
  expect(ready).toBe(0)
  complete(preview())
  await tick()
  expect(ready).toBe(1)
  expect(cache.get(b, 'same', 128)?.preview.bytes.length).toBe(5)
  cache.destroy()
})
test('large readonly documents select viewport previews and scale tiers include DPR', () => {
  const small = new SceneGraph(),
    large = new SceneGraph()
  for (let n = 0; n < 129; n++) large.images.set(String(n), new Uint8Array(1))
  expect(useViewportImageRendering(small)).toBe(false)
  expect(useViewportImageRendering(large)).toBe(true)
  expect(previewEdge({ width: 200, height: 100 }, 1, 2)).toBe(512)
  expect(previewEdge({ width: 10000, height: 100 }, 1)).toBe(2048)
})
test('full-resolution rendering disables previews and restores viewport/mode even on failure', () => {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.createNode('RECTANGLE', page.id)
  const viewport = { x: 1, y: 2, w: 3, h: 4 }
  const renderer = {
    viewportImageRendering: true,
    worldViewport: viewport,
    renderNode() {
      expect(this.viewportImageRendering).toBe(false)
      throw new Error('drawing failed')
    }
  }
  expect(() =>
    renderSceneToCanvas(
      renderer as unknown as SkiaRenderer,
      {} as Canvas,
      graph,
      page.id
    )
  ).toThrow('drawing failed')
  expect(renderer.viewportImageRendering).toBe(true)
  expect(renderer.worldViewport).toBe(viewport)
})
test('font notifications coalesce and never reenter rendering; disposal cancels late notifications', () => {
  const frames = new Map<number, FrameRequestCallback>()
  let id = 0
  const oldRAF = globalThis.requestAnimationFrame,
    oldCancel = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = (callback) => {
    frames.set(++id, callback)
    return id
  }
  globalThis.cancelAnimationFrame = (key) => {
    frames.delete(key)
  }
  const editor = createEditor({
    graph: new SceneGraph(),
    skipInitialGraphSetup: true,
    loadFont: async () => null
  })
  let draws = 0,
    depth = 0,
    maxDepth = 0
  const loop = createCanvasRenderLoop(editor, () => {
    draws++
    depth++
    maxDepth = Math.max(maxDepth, depth)
    if (draws === 1) for (let n = 0; n < 10; n++) loop.markDirty()
    loop.markRendered()
    depth--
  })
  function flush() {
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) callback(0)
  }
  try {
    for (let n = 0; n < 10; n++) loop.markDirty()
    expect(frames.size).toBe(1)
    flush()
    expect(draws).toBe(1)
    expect(frames.size).toBe(1)
    flush()
    expect(draws).toBe(2)
    expect(maxDepth).toBe(1)
    loop.markDirty()
    loop.pause()
    loop.markDirty()
    expect(frames.size).toBe(0)
  } finally {
    loop.pause()
    editor.dispose()
    globalThis.requestAnimationFrame = oldRAF
    globalThis.cancelAnimationFrame = oldCancel
  }
})
