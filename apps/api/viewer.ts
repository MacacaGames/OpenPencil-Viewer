import { Worker } from 'node:worker_threads'
import { resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { AppError } from '../../packages/contracts/index.ts'
import {
  MAX_VIEWPORT_BYTES,
  type ViewerManifest,
  type ViewportRequest
} from '../../packages/contracts/viewer.ts'
import { SceneCache } from './scene.ts'

interface Reply {
  id: number
  error?: boolean
  manifest?: ViewerManifest
  image?: Uint8Array
}
export class ViewerRenderer {
  private worker?: Worker
  private key = ''
  private manifest?: ViewerManifest
  private timer?: ReturnType<typeof setTimeout>
  private busy = false
  private sequence = 0
  private images = new SceneCache()
  constructor(private fontRoot: string) {}
  close() {
    if (this.timer) clearTimeout(this.timer)
    void this.worker?.terminate()
    this.worker = undefined
    this.manifest = undefined
    this.key = ''
  }
  private idle() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.close(), 300000)
    this.timer.unref()
  }
  private message(
    payload: { bytes?: ArrayBuffer; view?: ViewportRequest },
    signal: AbortSignal
  ): Promise<Reply> {
    const worker = this.worker
    if (!worker) throw new AppError('viewer-unavailable', 503)
    const id = ++this.sequence
    return new Promise((resolveReply, reject) => {
      const finish = (error?: Error, value?: Reply) => {
        worker.off('message', message)
        worker.off('error', failed)
        worker.off('exit', failed)
        signal.removeEventListener('abort', abort)
        if (error) reject(error)
        else if (value) resolveReply(value)
      }
      const message = (reply: Reply) => {
        if (reply.id !== id) return
        finish(
          reply.error ? new AppError('viewer-render-failed', 422) : undefined,
          reply
        )
      }
      const failed = () => finish(new AppError('viewer-unavailable', 503))
      const abort = () => finish(new AppError('viewer-cancelled', 499))
      worker.on('message', message)
      worker.once('error', failed)
      worker.once('exit', failed)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      else
        worker.postMessage(
          { ...payload, id },
          payload.bytes ? [payload.bytes] : []
        )
    })
  }
  async run(
    key: string,
    source: () => Promise<Readable>,
    size: number,
    signal: AbortSignal,
    view?: ViewportRequest
  ) {
    signal.throwIfAborted()
    const imageKey = key + ':' + JSON.stringify(view)
    const cached = view ? this.images.get(imageKey) : undefined
    if (cached) return { image: cached, cached: true }
    if (this.busy) throw new AppError('viewer-busy', 429)
    this.busy = true
    if (this.timer) clearTimeout(this.timer)
    try {
      if (!this.worker || this.key !== key || !this.manifest) {
        this.close()
        const stream = await source()
        const bytes = new Uint8Array(size)
        let offset = 0
        try {
          for await (const part of stream) {
            signal.throwIfAborted()
            if (offset + part.length > size)
              throw new AppError('source-changed', 409)
            bytes.set(part, offset)
            offset += part.length
          }
          if (offset !== size) throw new AppError('source-changed', 409)
        } finally {
          stream.destroy()
        }
        signal.throwIfAborted()
        this.worker = new Worker(
          resolve(this.fontRoot, '../api/viewer-renderer.js'),
          {
            execArgv: [],
            workerData: { fontRoot: resolve(this.fontRoot) },
            resourceLimits: { maxOldGenerationSizeMb: 512, stackSizeMb: 4 }
          }
        )
        const worker = this.worker
        worker.on('error', () => {
          if (this.worker === worker) this.close()
        })
        worker.on('exit', () => {
          if (this.worker === worker) this.close()
        })
        this.worker.unref()
        const result = await this.message({ bytes: bytes.buffer }, signal)
        if (
          !result.manifest ||
          result.manifest.version !== 1 ||
          !Array.isArray(result.manifest.pages)
        )
          throw new AppError('viewer-render-failed', 422)
        this.manifest = result.manifest
        this.key = key
      }
      if (!view) return { manifest: this.manifest, cached: false }
      if (!this.manifest.pages.some((p) => p.id === view.page))
        throw new AppError('not-found', 404)
      const result = await this.message({ view }, signal)
      if (
        !(result.image instanceof Uint8Array) ||
        result.image.length > MAX_VIEWPORT_BYTES
      )
        throw new AppError('viewer-render-failed', 422)
      signal.throwIfAborted()
      this.images.put(imageKey, result.image)
      return { image: result.image, cached: false }
    } catch (error) {
      this.close()
      throw error
    } finally {
      this.busy = false
      this.idle()
    }
  }
}
