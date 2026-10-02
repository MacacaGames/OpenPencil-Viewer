import { request } from 'node:http'
import { lstatSync } from 'node:fs'
import { Readable } from 'node:stream'
import * as v from 'valibot'
import {
  AppError,
  type FileRecord,
  type Principal
} from '../contracts/index.ts'
import {
  parseDirectory,
  validateDirectoryFreshness
} from '../nas-identity/index.ts'

export interface BridgeConfig {
  socketPath: string
  instanceId: string
  providerId: string
  acceptanceSha256: string
}
const text = v.pipe(v.string(), v.minLength(1), v.maxLength(256))
const statusSchema = v.strictObject({
  version: v.literal(1),
  ready: v.boolean(),
  instanceId: text,
  providerId: text,
  acceptanceSha256: v.nullable(v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/))),
  evidenceKind: v.nullable(v.picklist(['live-nas', 'synthetic'])),
  observedAt: v.pipe(v.number(), v.integer()),
  expiresAt: v.pipe(v.number(), v.integer()),
  roots: v.array(
    v.strictObject({
      id: text,
      identity: v.pipe(v.string(), v.regex(/^\d+:\d+$/))
    })
  )
})
const decisionSchema = v.strictObject({
  version: v.literal(1),
  allowed: v.boolean()
})
const streamSchema = v.strictObject({
  version: v.literal(1),
  principalKey: text,
  generation: text,
  rootId: text,
  rootIdentity: v.pipe(v.string(), v.regex(/^\d+:\d+$/)),
  relative: v.pipe(v.string(), v.maxLength(4096)),
  size: v.pipe(v.number(), v.integer(), v.minValue(0)),
  revision: text
})

// A protected Unix socket carries fixed read-only operations. No host paths,
// usernames, caller-supplied UID/GID, credentials or shell commands cross it.
export class NasBridge {
  constructor(
    readonly config: BridgeConfig,
    readonly environment: 'development' | 'production',
    readonly rootIds: string[],
    readonly identities: Map<string, string>,
    readonly maxFileBytes: number,
    readonly allowSynthetic = false
  ) {}
  private socket() {
    try {
      const info = lstatSync(this.config.socketPath)
      if (!info.isSocket() || (info.mode & 0o002) !== 0)
        throw new Error('socket')
      if (
        this.environment === 'production' &&
        (info.uid !== 0 || ((info.mode & 0o020) !== 0 && info.gid !== 10001))
      )
        throw new Error('owner')
      if (this.environment === 'production') {
        let parent = this.config.socketPath.slice(
          0,
          this.config.socketPath.lastIndexOf('/')
        )
        while (parent) {
          const directory = lstatSync(parent)
          if (
            !directory.isDirectory() ||
            directory.isSymbolicLink() ||
            directory.uid !== 0 ||
            directory.mode & 0o022
          )
            throw new Error('parent')
          parent = parent.slice(0, parent.lastIndexOf('/'))
        }
      }
    } catch {
      throw new AppError('native-bridge-unavailable', 503)
    }
  }
  private async connect(
    operation: string,
    value: unknown,
    signal?: AbortSignal
  ) {
    this.socket()
    if (signal?.aborted) throw new AppError('request-cancelled', 499)
    const bytes = Buffer.from(
      JSON.stringify({ version: 1, ...(value as object) })
    )
    if (bytes.length > 16384)
      throw new AppError('native-bridge-unavailable', 503)
    return new Promise<import('node:http').IncomingMessage>(
      (resolve, reject) => {
        const req = request({
          socketPath: this.config.socketPath,
          path: '/' + operation,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': bytes.length
          }
        })
        let response: import('node:http').IncomingMessage | undefined
        const abort = () => {
          req.destroy()
          response?.destroy()
        }
        signal?.addEventListener('abort', abort, { once: true })
        const timeout = setTimeout(abort, 5000)
        const cleanup = () => {
          clearTimeout(timeout)
          signal?.removeEventListener('abort', abort)
        }
        req.once('error', () => {
          cleanup()
          reject(new AppError('native-bridge-unavailable', 503))
        })
        req.once('response', (received) => {
          response = received
          clearTimeout(timeout)
          received.setTimeout(15000, () => received.destroy())
          const total = setTimeout(abort, operation === 'read' ? 30000 : 5000)
          received.once('close', () => {
            clearTimeout(total)
            cleanup()
          })
          if (
            received.statusCode !== 200 ||
            received.headers['content-encoding'] ||
            received.headers['content-type'] !==
              (operation === 'read'
                ? 'application/octet-stream'
                : 'application/json')
          ) {
            received.destroy()
            reject(new AppError('native-bridge-unavailable', 503))
          } else resolve(received)
        })
        req.end(bytes)
      }
    )
  }
  private async json(operation: string, value: unknown, limit = 4096) {
    const response = await this.connect(operation, value)
    try {
      const chunks: Buffer[] = []
      let length = 0
      for await (const part of response) {
        const chunk = Buffer.from(part)
        length += chunk.length
        if (length > limit) throw new Error('limit')
        chunks.push(chunk)
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    } catch {
      response.destroy()
      throw new AppError('native-bridge-unavailable', 503)
    }
  }
  async ready() {
    try {
      const status = v.parse(statusSchema, await this.json('status', {}))
      const now = Date.now()
      return (
        status.ready &&
        status.instanceId === this.config.instanceId &&
        status.providerId === this.config.providerId &&
        status.acceptanceSha256 === this.config.acceptanceSha256 &&
        (status.evidenceKind === 'live-nas' ||
          (this.environment === 'development' &&
            this.allowSynthetic &&
            status.evidenceKind === 'synthetic')) &&
        status.observedAt <= now + 30000 &&
        status.observedAt >= now - 300000 &&
        status.expiresAt > now &&
        status.expiresAt <= status.observedAt + 300000 &&
        status.roots.length === this.rootIds.length &&
        new Set(status.roots.map((r) => r.id)).size === status.roots.length &&
        this.rootIds.every((id) =>
          status.roots.some(
            (r) => r.id === id && r.identity === this.identities.get(id)
          )
        )
      )
    } catch {
      return false
    }
  }
  async directory() {
    try {
      // Mapping cannot use an unvalidated native source or fall back to a file.
      if (!(await this.ready())) throw new Error('gate')
      const snapshot = parseDirectory(
        await this.json('directory', {}, 4 * 1024 * 1024)
      )
      validateDirectoryFreshness(snapshot)
      if (
        snapshot.source !== 'native-dsm' ||
        snapshot.instanceId !== this.config.instanceId
      )
        throw new Error('source')
      return snapshot
    } catch {
      throw new AppError('directory-unavailable', 503)
    }
  }
  private target(principal: Principal, record: FileRecord) {
    const rootIdentity = this.identities.get(record.rootId)
    if (
      !principal.enabled ||
      principal.system ||
      !principal.trustedEmail ||
      !rootIdentity ||
      !this.rootIds.includes(record.rootId)
    )
      throw new AppError('native-bridge-unavailable', 503)
    return {
      instanceId: this.config.instanceId,
      principalKey: principal.key,
      generation: principal.generation,
      rootId: record.rootId,
      rootIdentity,
      relative: record.relative,
      kind: record.kind,
      size: record.size,
      revision: record.revision,
      maxFileBytes: this.maxFileBytes
    }
  }
  async canRead(principal: Principal, record: FileRecord) {
    if (!(await this.ready())) throw new AppError('source-unavailable', 503)
    try {
      return v.parse(
        decisionSchema,
        await this.json('authorize', this.target(principal, record))
      ).allowed
    } catch {
      throw new AppError('native-bridge-unavailable', 503)
    }
  }
  private checkedHeader(
    header: unknown,
    principal: Principal,
    record: FileRecord
  ) {
    const info = v.parse(streamSchema, header)
    if (
      info.principalKey !== principal.key ||
      info.generation !== principal.generation ||
      info.rootId !== record.rootId ||
      info.rootIdentity !== this.identities.get(record.rootId) ||
      info.relative !== record.relative ||
      info.size !== record.size ||
      info.size > this.maxFileBytes ||
      info.revision !== record.revision
    )
      throw new AppError('source-changed', 409)
    return info
  }
  async stat(principal: Principal, record: FileRecord) {
    if (!(await this.ready())) throw new AppError('source-unavailable', 503)
    try {
      this.checkedHeader(
        await this.json('stat', this.target(principal, record)),
        principal,
        record
      )
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('native-bridge-unavailable', 503)
    }
  }
  async open(principal: Principal, record: FileRecord, signal: AbortSignal) {
    if (!(await this.ready())) throw new AppError('source-unavailable', 503)
    const response = await this.connect(
      'read',
      this.target(principal, record),
      signal
    )
    const iterator = response[Symbol.asyncIterator]()
    let header = Buffer.alloc(0),
      first = Buffer.alloc(0)
    try {
      while (true) {
        const next = await iterator.next()
        if (next.done) throw new Error('header')
        const chunk = Buffer.from(next.value),
          newline = chunk.indexOf(10)
        if (newline >= 0) {
          header = Buffer.concat([header, chunk.subarray(0, newline)])
          first = chunk.subarray(newline + 1)
          break
        }
        header = Buffer.concat([header, chunk])
        if (header.length > 8192) throw new Error('header')
      }
      if (header.length > 8192) throw new Error('header')
      this.checkedHeader(JSON.parse(header.toString('utf8')), principal, record)
      if (first.length > record.size) throw new Error('size')
    } catch (error) {
      response.destroy()
      if (error instanceof AppError) throw error
      throw new AppError('native-bridge-unavailable', 503)
    }
    async function* body() {
      let received = 0,
        pending = first
      try {
        while (true) {
          const next = await iterator.next()
          if (next.done) break
          const chunk = Buffer.from(next.value)
          received += pending.length
          if (received + chunk.length > record.size)
            throw new Error('source-changed')
          if (pending.length) yield pending
          pending = chunk
        }
        if (received + pending.length !== record.size)
          throw new Error('source-changed')
        if (pending.length) yield pending
      } finally {
        response.destroy()
      }
    }
    const stream = Readable.from(body())
    stream.once('close', () => response.destroy())
    return stream
  }
}
