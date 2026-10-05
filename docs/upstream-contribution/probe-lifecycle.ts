// Diagnostic harness: each invocation must run in its own Bun process.
// Dependencies and renderer handles are mocked; this proves lifecycle contracts,
// not browser pixels, real GPU memory use, or a hardware-specific crash.
import { mock } from 'bun:test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const source = resolve(process.argv[2])
const modulePath = (name: string) => pathToFileURL(resolve(source, name)).href
let kitCalls = 0
const pending: Array<() => void> = []
mock.module('canvaskit-wasm', () => ({
  default: () => {
    const call = ++kitCalls
    if (call === 1)
      return Promise.reject(new Error('synthetic initial failure'))
    return new Promise((resolve) => pending.push(() => resolve({ heap: call })))
  }
}))
const { getCanvasKit } = await import(
  modulePath('packages/core/src/canvaskit.ts')
)
await getCanvasKit().catch(() => undefined)
const a = getCanvasKit(),
  b = getCanvasKit()
const concurrentInitializations = kitCalls - 1
for (const complete of pending) complete()
const sameHeap = (await a) === (await b)

const frames = new Map<number, () => void>()
let frameId = 0
globalThis.requestAnimationFrame = (callback) => {
  frames.set(++frameId, () => callback(0))
  return frameId
}
globalThis.cancelAnimationFrame = (id) => {
  frames.delete(id)
}
const editor = {
  graph: { documentColorSpace: 'srgb' },
  state: { renderVersion: 0, sceneVersion: 0, selectedIds: new Set() },
  onEditorEvent: () => () => undefined,
  setCanvasKit: () => undefined,
  removeCanvasRenderer: () => undefined,
  isInteractiveEditing: () => false
}
const { createCanvasRenderLoop } = await import(
  modulePath('packages/vue/src/canvas/surface/render-loop.ts')
)
const loop = createCanvasRenderLoop(editor, () => undefined)
loop.pause()
loop.markDirty()
const framesAfterPause = frames.size
frames.clear()

let surfaces = 0,
  depth = 0,
  maxDepth = 0,
  triggerFont = false
const callbacks: Array<() => void> = []
class Renderer {
  imagePreviews = { setDecoder: () => undefined }
  renderFromEditorState() {
    depth++
    maxDepth = Math.max(maxDepth, depth)
    if (triggerFont) {
      triggerFont = false
      callbacks[0]?.()
    }
    depth--
  }
  loadFonts(callback: () => void) {
    callbacks.push(callback)
    return Promise.resolve()
  }
  replaceSurface() {}
  destroy() {}
}
mock.module('@open-pencil/core/canvas', () => ({ SkiaRenderer: Renderer }))
mock.module(
  modulePath('packages/vue/src/canvas/surface/gl-surface.ts'),
  () => ({
    sizeCanvas: (canvas: {
      clientWidth: number
      clientHeight: number
      width: number
      height: number
    }) => {
      canvas.width = canvas.clientWidth
      canvas.height = canvas.clientHeight
    },
    makeGLSurface: () => {
      surfaces++
      return { surface: {}, glContext: { delete() {} }, presentation: 'srgb' }
    }
  })
)
const { createCanvasSurfaceManager } = await import(
  modulePath('packages/vue/src/canvas/surface/lifecycle.ts')
)
const canvas = {
  clientWidth: 300,
  clientHeight: 200,
  width: 0,
  height: 0,
  dataset: {},
  getContext: () => null
}
const manager = createCanvasSurfaceManager({
  editor,
  canvasRef: { value: canvas },
  getCanvasKit: () => ({}),
  isDestroyed: () => false,
  shouldShowRulers: () => false
})
manager.createSurface(canvas, { reloadFonts: true })
await Promise.resolve()
const beforeNoop = surfaces
manager.resizeCanvas(canvas)
const surfacesForSameSize = surfaces - beforeNoop
canvas.clientWidth = 0
const beforeZero = surfaces
manager.resizeCanvas(canvas)
const surfacesForZeroSize = surfaces - beforeZero
canvas.clientWidth = 300
triggerFont = true
manager.renderNow()
for (const frame of [...frames.values()]) frame()
manager.destroy()
console.log(
  JSON.stringify(
    {
      concurrentInitializations,
      sameHeap,
      retrySucceeded: true,
      framesAfterPause,
      surfacesForSameSize,
      surfacesForZeroSize,
      maximumFontCallbackRenderDepth: maxDepth
    },
    null,
    2
  )
)
