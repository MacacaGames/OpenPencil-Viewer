import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { basename, dirname, resolve } from 'node:path'
import type { FileRecord, RootConfig } from '../contracts/index.ts'
import { AppError } from '../contracts/index.ts'
const script = resolve('tools/filesystem/reader.py')
export function fileId(rootId: string, relative: string) {
  return createHash('sha256')
    .update(rootId + '\0' + relative)
    .digest('hex')
    .slice(0, 32)
}
export function validRelative(relative: string) {
  return (
    relative !== '' &&
    !relative.startsWith('/') &&
    !/[\\%\0]/.test(relative) &&
    relative.split('/').every((p) => p && p !== '.' && p !== '..')
  )
}
export type SourceProof = { identity: string; mountId: number | null }
export type IndexedRoot = {
  id: string
  path: string
  identity: string
  sourceIdentity?: string
}
export class FileIndex {
  records = new Map<string, FileRecord>()
  identities = new Map<string, string>()
  sourceIdentities = new Map<string, string>()
  private mountIds = new Map<string, number | null>()
  online = new Map<string, boolean>()
  errors = new Map<string, string>()
  scanning = false
  constructor(
    public roots: RootConfig[],
    public maxFileBytes: number,
    private verifySource?: (root: RootConfig) => SourceProof
  ) {}
  restore(snapshot: { records: FileRecord[]; roots: IndexedRoot[] }) {
    for (const observed of snapshot.roots) {
      const root = this.roots.find((r) => r.id === observed.id)
      if (!root) continue
      // Restored metadata stays offline. Explicit shared NAS mode rebuilds it
      // only after proving the configured mount, preserving failed-scan caches.
      if (root.path !== observed.path || !/^\d+:\d+$/.test(observed.identity))
        throw new Error('root baseline requires administrator review')
      if (this.verifySource && observed.sourceIdentity) {
        if (!/^[a-f0-9]{64}:\d+$/.test(observed.sourceIdentity))
          throw new Error('invalid persisted source identity')
        this.sourceIdentities.set(root.id, observed.sourceIdentity)
      }
      this.identities.set(root.id, observed.identity)
      this.online.set(root.id, false)
    }
    for (const record of snapshot.records) {
      if (!this.identities.has(record.rootId)) continue
      if (
        record.id !== fileId(record.rootId, record.relative) ||
        (record.relative !== '' && !validRelative(record.relative)) ||
        !['file', 'folder'].includes(record.kind) ||
        !Number.isSafeInteger(record.size) ||
        record.size < 0 ||
        typeof record.revision !== 'string'
      )
        throw new Error('invalid persisted metadata')
      this.records.set(record.id, record)
    }
  }
  async scan() {
    if (this.scanning) return
    this.scanning = true
    try {
      for (const root of this.roots) {
        try {
          const proof = this.verifySource?.(root)
          const raw = await jsonOperation(['scan', root.path])
          if (
            typeof raw.identity !== 'string' ||
            !/^\d+:\d+$/.test(raw.identity) ||
            !Array.isArray(raw.entries)
          )
            throw new Error('schema')
          const prior = this.identities.get(root.id)
          const sourceIdentity = proof
            ? proof.identity + ':' + raw.identity.split(':')[1]
            : undefined
          if (proof) {
            const after = this.verifySource!(root)
            if (
              raw.mountId !== proof.mountId ||
              after.mountId !== proof.mountId ||
              after.identity !== proof.identity
            )
              throw new AppError('source-mount-changed', 503)
            const baseline = this.sourceIdentities.get(root.id)
            if (baseline && baseline !== sourceIdentity)
              throw new AppError('source-identity-changed', 503)
          } else if (prior && prior !== raw.identity)
            throw new AppError('root-identity-changed', 503)
          const next = new Map<string, FileRecord>()
          next.set(fileId(root.id, ''), {
            id: fileId(root.id, ''),
            rootId: root.id,
            relative: '',
            name: root.label,
            parentId: '',
            kind: 'folder',
            size: 0,
            revision: raw.identity
          })
          for (const value of raw.entries) {
            if (!value || typeof value !== 'object') throw new Error('schema')
            const entry = value as Record<string, unknown>
            if (
              typeof entry.relative !== 'string' ||
              !validRelative(entry.relative) ||
              (entry.kind !== 'file' && entry.kind !== 'folder') ||
              typeof entry.size !== 'number' ||
              typeof entry.revision !== 'string'
            )
              throw new Error('schema')
            if (entry.kind === 'file' && entry.size > this.maxFileBytes)
              continue
            const parent = dirname(entry.relative)
            const record: FileRecord = {
              id: fileId(root.id, entry.relative),
              rootId: root.id,
              relative: entry.relative,
              name: basename(entry.relative),
              parentId: fileId(root.id, parent === '.' ? '' : parent),
              kind: entry.kind,
              size: entry.size,
              revision: entry.revision
            }
            next.set(record.id, record)
          }
          for (const [id, record] of this.records)
            if (record.rootId === root.id) this.records.delete(id)
          for (const [id, record] of next) this.records.set(id, record)
          this.identities.set(root.id, raw.identity)
          if (proof && sourceIdentity) {
            this.sourceIdentities.set(root.id, sourceIdentity)
            this.mountIds.set(root.id, proof.mountId)
          }
          this.online.set(root.id, true)
          this.errors.delete(root.id)
        } catch (error) {
          this.online.set(root.id, false)
          this.errors.set(
            root.id,
            error instanceof AppError ? error.code : 'source-scan-failed'
          )
        } // Retain index on scan failure.
      }
    } finally {
      this.scanning = false
    }
  }
  args(record: FileRecord, operation: 'read' | 'stat') {
    const root = this.roots.find((r) => r.id === record.rootId),
      identity = this.identities.get(record.rootId)
    if (
      !root ||
      !identity ||
      !this.online.get(record.rootId) ||
      record.kind !== 'file' ||
      !validRelative(record.relative)
    )
      throw new AppError('source-offline', 503)
    this.checkSource(root)
    return [
      operation,
      root.path,
      record.relative,
      identity,
      record.revision,
      String(this.maxFileBytes)
    ]
  }
  private checkSource(root: RootConfig) {
    if (!this.verifySource) return
    try {
      const proof = this.verifySource(root)
      if (
        this.sourceIdentities.get(root.id) !==
          proof.identity + ':' + this.identities.get(root.id)?.split(':')[1] ||
        this.mountIds.get(root.id) !== proof.mountId
      )
        throw new AppError('source-mount-changed', 503)
    } catch (error) {
      this.online.set(root.id, false)
      this.errors.set(
        root.id,
        error instanceof AppError ? error.code : 'source-mount-unavailable'
      )
      throw new AppError('source-offline', 503)
    }
  }
  async stat(record: FileRecord) {
    const result = await jsonOperation(this.args(record, 'stat'))
    this.checkSource(this.roots.find((r) => r.id === record.rootId)!)
    return result
  }
  async open(record: FileRecord, signal: AbortSignal) {
    signal.throwIfAborted()
    const child = spawn(
      process.env.PYTHON_BIN ?? 'python3',
      [script, ...this.args(record, 'read')],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
    const abort = () => child.kill('SIGTERM')
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    const exit = new Promise<void>((resolve, reject) => {
      child.once('error', () => reject(new AppError('source-offline', 503)))
      child.once('close', (code) =>
        code === 0 ? resolve() : reject(new AppError('source-changed', 409))
      )
    })
    void exit.catch(() => undefined)
    const iterator = child.stdout[Symbol.asyncIterator]()
    let header = Buffer.alloc(0),
      first = Buffer.alloc(0)
    try {
      while (true) {
        const part = await iterator.next()
        if (part.done) throw new AppError('source-changed', 409)
        const chunk = Buffer.from(part.value)
        const newline = chunk.indexOf(10)
        if (newline >= 0) {
          header = Buffer.concat([header, chunk.subarray(0, newline)])
          first = chunk.subarray(newline + 1)
          break
        }
        header = Buffer.concat([header, chunk])
        if (header.length > 1024) throw new Error('header')
      }
      const info = JSON.parse(header.toString()) as {
        size: number
        revision: string
      }
      if (info.size !== record.size || info.revision !== record.revision)
        throw new AppError('source-changed', 409)
      const root = this.roots.find((r) => r.id === record.rootId)!
      this.checkSource(root)
      const checkSource = () => this.checkSource(root)
      const cleanup = () => {
        signal.removeEventListener('abort', abort)
        abort()
        child.stdout.destroy()
      }
      async function* body() {
        try {
          if (first.length) yield first
          while (true) {
            const part = await iterator.next()
            if (part.done) break
            yield part.value
          }
          await exit
          checkSource()
        } finally {
          cleanup()
        }
      }
      const stream = Readable.from(body())
      stream.once('close', cleanup)
      child.once('close', () => signal.removeEventListener('abort', abort))
      return stream
    } catch (error) {
      signal.removeEventListener('abort', abort)
      abort()
      throw error
    }
  }
}
async function jsonOperation(args: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.PYTHON_BIN ?? 'python3',
      [script, ...args],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
    const chunks: Buffer[] = []
    let bytes = 0
    const timer = setTimeout(() => child.kill('SIGTERM'), 30000)
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > 32 * 1024 * 1024) child.kill('SIGTERM')
      else chunks.push(chunk)
    })
    child.once('error', () => {
      clearTimeout(timer)
      reject(new AppError('source-offline', 503))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      try {
        if (code !== 0 || bytes > 32 * 1024 * 1024) throw new Error('operation')
        resolve(
          JSON.parse(Buffer.concat(chunks).toString()) as Record<
            string,
            unknown
          >
        )
      } catch {
        reject(new AppError('source-offline', 503))
      }
    })
  })
}
