// Serve in a disposable upstream checkout with Vite. No app/session/persistence
// code is initialized. Use ?fixture=/public-file.fig (same-origin only).
import { getCanvasKit } from '@open-pencil/core'
import { SkiaRenderer } from '@open-pencil/core/canvas'
import { parseFigFile } from '@open-pencil/core/io/formats/fig'

const report = (event: string, data: Record<string, unknown> = {}) =>
  console.log(
    'PUBLIC_REPRO ' +
      JSON.stringify({ event, timeMs: performance.now(), ...data })
  )
const fixture =
  new URLSearchParams(location.search).get('fixture') ?? '/fixture.fig'
const url = new URL(fixture, location.href)
if (url.origin !== location.origin)
  throw new Error('Only local fixture URLs are supported')
const ready = async () => {
  report('fetch:start')
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Fixture fetch failed: ${response.status}`)
  const buffer = await response.arrayBuffer()
  report('parse:start', { figBytes: buffer.byteLength })
  const graph = await parseFigFile(buffer, { populate: 'all' })
  report('parse:complete', {
    pages: graph.getPages().length,
    nodes: [...graph.getAllNodes()].length,
    encodedImages: graph.images.size,
    encodedImageBytes: [...graph.images.values()].reduce(
      (n, bytes) => n + bytes.length,
      0
    )
  })
  const ck = await getCanvasKit({ locateFile: (file) => '/' + file })
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!
  const surface = ck.MakeWebGLCanvasSurface(canvas)
  if (!surface) throw new Error('WebGL CanvasKit surface unavailable')
  const gl = canvas.getContext('webgl2')
  const debug = gl?.getExtension('WEBGL_debug_renderer_info')
  report('surface:ready', {
    backend: 'WebGL',
    glRenderer: debug
      ? gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : 'unavailable',
    browser: navigator.userAgent
  })
  const renderer = new SkiaRenderer(ck, surface, gl)
  renderer.viewportWidth = canvas.width
  renderer.viewportHeight = canvas.height
  renderer.dpr = 1
  renderer.showRulers = false
  const heapBytes = () => (Reflect.get(ck, 'HEAPU8') as Uint8Array).byteLength
  const cacheStats = () => {
    let rgba = 0
    for (const image of renderer.imageCache.values())
      rgba += image.width() * image.height() * 4
    return {
      cachedImages: renderer.imageCache.size,
      cachedRgbaWithMipmapsEstimate: Math.ceil(rgba * (4 / 3)),
      wasmHeapCapacityBytes: heapBytes()
    }
  }
  // Observe cache insertions without changing cache ownership, values or limits.
  const get = renderer.imageCache.get.bind(renderer.imageCache)
  renderer.imageCache.get = (key) => {
    const image = get(key)
    if (!image) report('decode:start', { imageHash: key, ...cacheStats() })
    return image
  }
  const set = renderer.imageCache.set.bind(renderer.imageCache)
  renderer.imageCache.set = (key, image) => {
    const result = set(key, image)
    if (renderer.imageCache.size % 10 === 0)
      report('cache:progress', cacheStats())
    return result
  }
  try {
    for (const [index, page] of graph.getPages().entries()) {
      const children = graph.getChildren(page.id)
      const width = Math.max(...children.map((n) => n.x + n.width))
      const height = Math.max(...children.map((n) => n.y + n.height))
      renderer.pageId = page.id
      renderer.zoom = Math.min(
        (canvas.width - 64) / width,
        (canvas.height - 64) / height
      )
      renderer.panX = 32
      renderer.panY = 32
      report('render:start', {
        page: index + 1,
        imageNodes: children.length,
        ...cacheStats()
      })
      renderer.render(graph, new Set(), {}, index + 1, 'scene')
      report('render:complete', { page: index + 1, ...cacheStats() })
      await new Promise<void>((done) => requestAnimationFrame(() => done()))
    }
    report('complete', cacheStats())
    Object.assign(window, { publicReproOutcome: 'complete' })
  } finally {
    renderer.destroy()
    report('renderer:disposed', { cachedImages: renderer.imageCache.size })
  }
}
ready().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  report('failure', {
    message,
    stack: error instanceof Error ? error.stack : undefined
  })
  Object.assign(window, {
    publicReproOutcome: 'failure',
    publicReproError: message
  })
})
