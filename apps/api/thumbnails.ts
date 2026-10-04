import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile, unlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError } from '../../packages/contracts/index.ts'

interface Entry {
  path?: string
  size: number
  expires: number
}
/** Per-process, account-shared cache in a private temporary directory; no source files. */
export class ThumbnailCache {
  private root?: Promise<string>
  private entries = new Map<string, Entry>()
  private pending = new Map<string, Promise<Uint8Array | null>>()
  private bytes = 0
  private active = 0
  private closed = false
  private storing: Promise<void> = Promise.resolve()
  constructor(
    private maxBytes = 128 * 1024 * 1024,
    private maxEntries = 512,
    private now = Date.now
  ) {}
  private async remove(key: string, entry: Entry) {
    if (this.entries.get(key) !== entry) return
    this.entries.delete(key)
    this.bytes -= entry.size
    if (entry.path) await unlink(entry.path).catch(() => undefined)
  }
  async get(key: string, generate: () => Promise<Uint8Array | null>) {
    if (this.closed) throw new AppError('thumbnail-unavailable', 503)
    key = createHash('sha256').update(key).digest('hex')
    const previous = this.entries.get(key)
    if (previous) {
      if (previous.expires > this.now()) {
        this.entries.delete(key)
        this.entries.set(key, previous)
        if (!previous.path) return null
        const image = await readFile(previous.path).catch(() => null)
        if (image && image.length === previous.size) return image
      }
      await this.remove(key, previous)
    }
    const pending = this.pending.get(key)
    if (pending) return pending
    if (this.pending.size >= 32) throw new AppError('thumbnail-busy', 429)
    const task = this.generate(key, generate).finally(() =>
      this.pending.delete(key)
    )
    this.pending.set(key, task)
    return task
  }
  private async generate(
    key: string,
    generate: () => Promise<Uint8Array | null>
  ) {
    // Bound disk/range reads and ZIP work; lazy images limit queued UI requests.
    while (this.active >= 2 && !this.closed)
      await new Promise((r) => setTimeout(r, 25))
    if (this.closed) throw new AppError('thumbnail-unavailable', 503)
    this.active++
    try {
      const image = await generate()
      if (this.closed) throw new AppError('thumbnail-unavailable', 503)
      if (image && image.byteLength > 2 * 1024 * 1024) return null
      const entry: Entry = {
        size: image?.byteLength ?? 0,
        expires: this.now() + (image ? 30 * 60000 : 5 * 60000)
      }
      if (image && image.byteLength > this.maxBytes) return image
      // Serialize eviction/write so simultaneous previews cannot exceed the disk budget.
      const store = this.storing.then(async () => {
        if (this.closed) throw new AppError('thumbnail-unavailable', 503)
        while (
          this.bytes + entry.size > this.maxBytes ||
          this.entries.size >= this.maxEntries
        ) {
          const oldest = this.entries.entries().next().value
          if (oldest) await this.remove(...oldest)
        }
        if (image) {
          this.root ??= mkdtemp(join(tmpdir(), 'openpencil-thumbnails-'))
          entry.path = join(await this.root, key + '-' + randomUUID() + '.png')
          await writeFile(entry.path, image, { mode: 0o600, flag: 'wx' })
        }
        this.entries.set(key, entry)
        this.bytes += entry.size
      })
      this.storing = store.catch(() => undefined)
      await store
      return image
    } finally {
      this.active--
    }
  }
  async close() {
    this.closed = true
    await Promise.allSettled(this.pending.values())
    this.entries.clear()
    this.bytes = 0
    if (this.root) await rm(await this.root, { recursive: true, force: true })
  }
}
