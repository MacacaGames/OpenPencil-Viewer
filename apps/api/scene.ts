import { Worker } from 'node:worker_threads'
import { resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { AppError } from '../../packages/contracts/index.ts'
import { MAX_SCENE_BYTES } from '../../packages/transport/scene-wire.ts'

export async function parseScene(
  source: Readable,
  size: number,
  signal: AbortSignal,
  metrics?: (values: { nasReadMs: number; parseMs: number }) => void
) {
  const begin = performance.now()
  signal.throwIfAborted()
  const bytes = new Uint8Array(size)
  let offset = 0
  try {
    for await (const chunk of source) {
      signal.throwIfAborted()
      if (offset + chunk.length > size)
        throw new AppError('source-changed', 409)
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    if (offset !== size) throw new AppError('source-changed', 409)
  } finally {
    source.destroy()
  }
  signal.throwIfAborted()
  const readAt = performance.now()
  const worker = new Worker(resolve('dist/api/scene-parser.js'), {
    execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: 512, stackSizeMb: 4 }
  })
  try {
    const result = await new Promise<Uint8Array>((resolveResult, reject) => {
      const abort = () => reject(new AppError('scene-cancelled', 499))
      signal.addEventListener('abort', abort, { once: true })
      worker.once('message', (message: { packed?: Uint8Array }) => {
        signal.removeEventListener('abort', abort)
        if (
          !(message.packed instanceof Uint8Array) ||
          message.packed.length > MAX_SCENE_BYTES
        )
          reject(new AppError('scene-parse-failed', 422))
        else resolveResult(message.packed)
      })
      worker.once('error', () => {
        signal.removeEventListener('abort', abort)
        reject(new AppError('scene-parse-failed', 422))
      })
      worker.once('exit', () => {
        signal.removeEventListener('abort', abort)
        reject(new AppError('scene-parse-failed', 422))
      })
      if (signal.aborted) abort()
      else worker.postMessage(bytes.buffer, [bytes.buffer])
    })
    metrics?.({
      nasReadMs: readAt - begin,
      parseMs: performance.now() - readAt
    })
    return result
  } finally {
    await worker.terminate()
  }
}

export class SceneCache {
  private entries = new Map<string, Uint8Array>()
  private bytes = 0
  constructor(private max = 64 * 1024 * 1024) {}
  get(key: string) {
    const value = this.entries.get(key)
    if (value) {
      this.entries.delete(key)
      this.entries.set(key, value)
    }
    return value
  }
  put(key: string, value: Uint8Array) {
    if (value.length > this.max) return
    const prior = this.entries.get(key)
    if (prior) {
      this.bytes -= prior.length
      this.entries.delete(key)
    }
    while (this.bytes + value.length > this.max) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.bytes -= this.entries.get(oldest)?.length ?? 0
      this.entries.delete(oldest)
    }
    this.entries.set(key, value)
    this.bytes += value.length
  }
}
