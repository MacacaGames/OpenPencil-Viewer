import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

export interface ImageHandle {
  width(): number
  height(): number
  delete(): void
}

// Own native images; graph.images continues to hold the original compressed bytes.
export class DecodedImageCache<T extends ImageHandle> extends Map<string, T> {
  private weights = new Map<string, number>()
  bytes = 0
  constructor(readonly maxBytes = 128 * 1024 * 1024) {
    super()
  }
  override get(key: string) {
    const image = super.get(key)
    if (image) {
      super.delete(key)
      super.set(key, image)
    }
    return image
  }
  override set(key: string, image: T): this {
    if (super.get(key) === image) {
      this.get(key)
      return this
    }
    this.delete(key)
    const weight = Math.ceil(image.width() * image.height() * 4 * (4 / 3))
    while (this.size && this.bytes + weight > this.maxBytes) {
      const oldest = this.keys().next().value
      if (oldest === undefined) break
      this.delete(oldest)
    }
    // A single oversized image stays alive while borrowed by the drawing caller.
    super.set(key, image)
    this.weights.set(key, weight)
    this.bytes += weight
    return this
  }
  override delete(key: string): boolean {
    const image = super.get(key)
    if (!image) return false
    super.delete(key)
    this.bytes -= this.weights.get(key) ?? 0
    this.weights.delete(key)
    image.delete()
    return true
  }
  override clear() {
    for (const key of [...this.keys()]) this.delete(key)
  }
}

const sizes = new WeakMap<SceneGraph, boolean>()
export function useViewportImageRendering(graph: SceneGraph): boolean {
  const known = sizes.get(graph)
  if (known !== undefined) return known
  let bytes = 0
  for (const data of graph.images.values()) bytes += data.byteLength
  const large = bytes > 32 * 1024 * 1024 || graph.images.size > 128
  sizes.set(graph, large)
  return large
}

export const PREVIEW_EDGES = [128, 256, 512, 1024, 2048] as const
export function previewEdge(
  node: Pick<SceneNode, 'width' | 'height'>,
  zoom: number,
  dpr = 1
) {
  const pixels = Math.max(node.width, node.height) * zoom * dpr
  return PREVIEW_EDGES.find((edge) => edge >= pixels) ?? 2048
}
export interface ImagePreview {
  bytes: Uint8Array<ArrayBuffer>
  originalWidth: number
  originalHeight: number
}
export interface ImagePreviewDecoder {
  decode(source: Uint8Array, edge: number): Promise<ImagePreview>
  destroy(): void
}
interface PreviewEntry {
  source: Uint8Array
  preview?: ImagePreview
  failed?: boolean
}

// Per-renderer lifetime: one decode at a time, bounded pending work and encoded LRU.
export class ImagePreviewCache {
  private entries = new Map<string, PreviewEntry>()
  private graph: SceneGraph | null = null
  private queue: Array<{ key: string; entry: PreviewEntry; edge: number }> = []
  private decoder: ImagePreviewDecoder | null = null
  private active = false
  private disposed = false
  private generation = 0
  bytes = 0
  constructor(
    private ready: () => void,
    readonly maxBytes = 64 * 1024 * 1024
  ) {}

  setDecoder(decoder: ImagePreviewDecoder) {
    this.decoder?.destroy()
    this.decoder = decoder
  }

  get enabled(): boolean {
    return !this.disposed && this.decoder !== null
  }

  get(
    graph: SceneGraph,
    hash: string,
    edge: number
  ): { key: string; preview: ImagePreview } | undefined {
    if (this.disposed || !this.decoder) return undefined
    if (this.graph !== graph) {
      this.generation++
      this.graph = graph
      this.entries.clear()
      this.queue = []
      this.bytes = 0
    }
    const source = graph.images.get(hash)
    if (!source) return undefined
    const key = `${hash}:preview:${edge}`
    if (!this.entries.has(key) && this.queue.length < 64) {
      const entry = { source }
      this.entries.set(key, entry)
      this.queue.push({ key, entry, edge })
      void this.drain()
    }
    // Keep the best available level visible while a sharper one is decoding.
    for (const candidate of [
      edge,
      ...[...PREVIEW_EDGES].reverse().filter((n) => n !== edge)
    ]) {
      const candidateKey = `${hash}:preview:${candidate}`
      const entry = this.entries.get(candidateKey)
      if (entry?.preview && entry.source === source) {
        this.entries.delete(candidateKey)
        this.entries.set(candidateKey, entry)
        return { key: candidateKey, preview: entry.preview }
      }
    }
    return undefined
  }

  private async drain() {
    if (this.active || this.disposed || !this.decoder) return
    this.active = true
    try {
      while (this.queue.length && !this.disposed) {
        const job = this.queue.shift()
        if (!job) break
        const generation = this.generation
        try {
          const preview = await this.decoder.decode(job.entry.source, job.edge)
          if (
            this.disposed ||
            generation !== this.generation ||
            this.entries.get(job.key) !== job.entry
          )
            continue
          job.entry.preview = preview
          this.bytes += preview.bytes.byteLength
          this.trim(job.key)
          this.ready()
        } catch {
          if (generation === this.generation && !this.disposed) {
            job.entry.failed = true
            this.trim(job.key)
          }
        }
      }
    } finally {
      this.active = false
    }
  }

  private trim(current: string) {
    for (const [key, entry] of this.entries) {
      if (this.bytes <= this.maxBytes && this.entries.size <= 256) break
      if (key === current || (!entry.preview && !entry.failed)) continue
      this.bytes -= entry.preview?.bytes.byteLength ?? 0
      this.entries.delete(key)
    }
  }

  destroy() {
    this.disposed = true
    this.generation++
    this.decoder?.destroy()
    this.decoder = null
    this.queue = []
    this.entries.clear()
    this.graph = null
    this.bytes = 0
  }
}
