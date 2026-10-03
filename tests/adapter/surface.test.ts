import { test, expect, mock } from 'bun:test'
import type { CanvasKit } from 'canvaskit-wasm'
import type { Editor } from '@open-pencil/core/editor'

let surfaces = 0,
  resizes = 0,
  draws = 0,
  destroys = 0
const fontCallbacks: Array<() => void> = []
class Renderer {
  imagePreviews = { setDecoder: () => undefined }
  renderFromEditorState() {
    draws++
  }
  loadFonts(callback: () => void) {
    fontCallbacks.push(callback)
    return Promise.resolve()
  }
  replaceSurface() {}
  destroy() {
    destroys++
  }
}
mock.module('@open-pencil/core/canvas', () => ({ SkiaRenderer: Renderer }))
mock.module(
  '../../.work/editor/packages/vue/src/canvas/surface/gl-surface',
  () => ({
    sizeCanvas: (canvas: HTMLCanvasElement) => {
      resizes++
      canvas.width = canvas.clientWidth
      canvas.height = canvas.clientHeight
    },
    makeGLSurface: () => {
      surfaces++
      return { surface: {}, glContext: { delete() {} }, presentation: 'srgb' }
    }
  })
)
test('surface lifecycle skips unchanged and hidden sizes; all font callbacks schedule frames', async () => {
  const { createCanvasSurfaceManager } =
    await import('../../.work/editor/packages/vue/src/canvas/surface/lifecycle')
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
  const canvas = {
    clientWidth: 300,
    clientHeight: 200,
    width: 0,
    height: 0,
    dataset: {},
    getContext: () => null
  }
  const editor = {
    graph: { documentColorSpace: 'srgb' },
    state: { renderVersion: 0, sceneVersion: 0, selectedIds: new Set() },
    onEditorEvent: () => () => undefined,
    setCanvasKit: () => undefined,
    removeCanvasRenderer: () => undefined,
    isInteractiveEditing: () => false
  } as unknown as Editor
  const manager = createCanvasSurfaceManager({
    editor,
    canvasRef: { value: canvas as unknown as HTMLCanvasElement },
    options: undefined,
    getCanvasKit: () => ({}) as CanvasKit,
    isDestroyed: () => false,
    shouldShowRulers: () => false
  })
  try {
    manager.createSurface(canvas as unknown as HTMLCanvasElement, {
      reloadFonts: true
    })
    await Promise.resolve()
    expect(surfaces).toBe(1)
    expect(resizes).toBe(1)
    manager.resizeCanvas(canvas as unknown as HTMLCanvasElement)
    expect(surfaces).toBe(1)
    canvas.clientWidth = 0
    manager.resizeCanvas(canvas as unknown as HTMLCanvasElement)
    manager.createSurface(canvas as unknown as HTMLCanvasElement)
    expect(surfaces).toBe(1)
    expect(destroys).toBe(0)
    canvas.clientWidth = 400
    manager.resizeCanvas(canvas as unknown as HTMLCanvasElement)
    expect(surfaces).toBe(2)
    expect(draws).toBe(1)
    const callback = fontCallbacks[0]
    for (let n = 0; n < 10; n++) callback()
    expect(draws).toBe(1)
    expect(frames.size).toBe(1)
    const callbacks = [...frames.values()]
    frames.clear()
    for (const frame of callbacks) frame(0)
    expect(draws).toBe(2)
    manager.destroy()
    callback()
    expect(frames.size).toBe(0)
  } finally {
    globalThis.requestAnimationFrame = oldRAF
    globalThis.cancelAnimationFrame = oldCancel
  }
})
