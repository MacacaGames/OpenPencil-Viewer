import { parentPort, workerData } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import type { CanvasKit } from 'canvaskit-wasm'
import type { SceneGraph } from '@open-pencil/scene-graph'
import { parseFigFile } from '@open-pencil/core/io/formats/fig'
import { SkiaRenderer } from '@open-pencil/core/canvas'
import { computeContentBounds } from '@open-pencil/core/io/formats/raster'
import { fontManager } from '@open-pencil/core/text'
import { checkFigSafety } from '../transport/fig-safety'
import { lockGraph } from './readonly'
import {
  MAX_VIEWPORT_BYTES,
  type ViewportRequest,
  type ViewerManifest
} from '../contracts/viewer'

let graph: SceneGraph | undefined
let renderer: SkiaRenderer | undefined
let ck: CanvasKit
const fonts: Record<string, string> = {
  'Inter|Regular': 'Inter-Regular.ttf',
  'Inter|Medium': 'Inter-Medium.ttf',
  'Inter|SemiBold': 'Inter-SemiBold.ttf',
  'Inter|Bold': 'Inter-Bold.ttf',
  'Inter|ExtraBold': 'Inter-ExtraBold.ttf',
  'Noto Naskh Arabic|Regular': 'NotoNaskhArabic-Regular.ttf'
}
globalThis.fetch = async () => {
  throw new Error('Renderer network disabled')
}
fontManager.setOnlineFontProviders({ google: false, fontsource: false })
fontManager.setHostFontLoader(async (family, style) => {
  const name = fonts[family + '|' + style]
  if (!name) return null
  const bytes = await readFile(resolve(workerData.fontRoot, name))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)
})
fontManager.fetchBundledFont = async (url) => {
  const name = Object.values(fonts).find((n) => '/' + n === url)
  if (!name) return null
  const bytes = await readFile(resolve(workerData.fontRoot, name))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)
}

async function open(bytes: ArrayBuffer): Promise<ViewerManifest> {
  checkFigSafety(new Uint8Array(bytes))
  graph = await parseFigFile(bytes, { populate: 'all' })
  const runtime = new URL('./vendor/canvaskit.cjs', import.meta.url).href
  const init = (await import(runtime)).default
  ck = await init({
    locateFile: (file: string) =>
      fileURLToPath(new URL('./vendor/' + file, import.meta.url))
  })
  const surface = ck.MakeSurface(1, 1)
  if (!surface) throw new Error('renderer-unavailable')
  renderer = new SkiaRenderer(ck, surface)
  await renderer.loadFonts()
  const document = graph
  const pages = document.getPages()
  if (!pages.length || pages.length > 10000) throw new Error('pages-limit')
  for (const page of pages) {
    await renderer.prepareForExport(graph, page.id, page.childIds)
  }
  const manifest: ViewerManifest = {
    version: 1,
    pages: pages.map((page) => {
      const bounds = computeContentBounds(document, page.childIds)
      return {
        id: page.id,
        name: page.name.slice(0, 256),
        bounds: bounds
          ? {
              x: bounds.minX,
              y: bounds.minY,
              width: Math.max(1, bounds.maxX - bounds.minX),
              height: Math.max(1, bounds.maxY - bounds.minY)
            }
          : { x: 0, y: 0, width: 1024, height: 768 }
      }
    })
  }
  lockGraph(graph)
  if (JSON.stringify(manifest).length > 2 * 1024 * 1024)
    throw new Error('manifest-limit')
  return manifest
}

function render(view: ViewportRequest): Uint8Array {
  if (!graph || !renderer) throw new Error('not-open')
  const page = graph.getPages().find((p) => p.id === view.page)
  if (!page) throw new Error('page-not-found')
  const surface = ck.MakeSurface(view.width, view.height)
  if (!surface) throw new Error('surface-unavailable')
  try {
    const canvas = surface.getCanvas()
    canvas.clear(ck.Color(245, 245, 245, 1))
    canvas.scale(view.scale, view.scale)
    canvas.translate(-view.x, -view.y)
    renderer.zoom = view.scale
    renderer.dpr = 1
    renderer.worldViewport = {
      x: view.x,
      y: view.y,
      w: view.width / view.scale,
      h: view.height / view.scale
    }
    for (const id of page.childIds) renderer.renderNode(canvas, graph, id, {})
    surface.flush()
    const image = surface.makeImageSnapshot()
    try {
      const bytes = image.encodeToBytes(ck.ImageFormat.WEBP, 85)
      if (!bytes || bytes.length > MAX_VIEWPORT_BYTES)
        throw new Error('viewport-limit')
      return bytes
    } finally {
      image.delete()
    }
  } finally {
    surface.delete()
    // Rendering caches must not retain every decoded image across navigation.
    renderer.invalidateAllPictures()
    renderer.imageCache.clear()
  }
}

parentPort?.on(
  'message',
  async (message: {
    id: number
    bytes?: ArrayBuffer
    view?: ViewportRequest
  }) => {
    try {
      if (message.bytes)
        parentPort?.postMessage({
          id: message.id,
          manifest: await open(message.bytes)
        })
      else if (message.view) {
        const image = render(message.view)
        parentPort?.postMessage({ id: message.id, image }, [image.buffer])
      } else throw new Error('request-invalid')
    } catch {
      parentPort?.postMessage({ id: message.id, error: true })
    }
  }
)
