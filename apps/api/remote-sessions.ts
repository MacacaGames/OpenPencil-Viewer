import { randomBytes, timingSafeEqual } from 'node:crypto'
import { AppError, type FileRecord } from '../../packages/contracts/index.ts'
import type { RemoteDisplay } from '../../packages/contracts/remote-display.ts'

const token = () => randomBytes(32).toString('base64url')
export function secretEqual(a: string | undefined, b: string) {
  if (!a || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}
export interface RemoteLease {
  id: string
  slot: number
  credential: string
  ticket: string
  owner: string
  cookie: string
  file: FileRecord
  expires: number
  ready: boolean
  abort: AbortController
  disconnectedAt: number
  encoderMode?: string
  display?: RemoteDisplay
}
export interface RemoteWorker {
  start(lease: RemoteLease): Promise<void>
  stop(id: string): Promise<void>
  streamUrl: string
  corePath: string
  alive?(): boolean
}
export type RemoteStopReason =
  | 'requested'
  | 'logout'
  | 'shutdown'
  | 'startup-failed'
  | 'lease-expired'
  | 'worker-exited'
  | 'stream-disconnected'
  | 'validation-failed'
  | 'forced-vaapi-unverified'
  | 'forced-vaapi-fallback'

/** Log internal error codes only; exception messages may contain credentials/paths. */
export function remoteErrorCode(error: unknown, fallback: string) {
  return error instanceof AppError && /^[a-z][a-z0-9-]{0,63}$/.test(error.code)
    ? error.code
    : fallback
}

/** Bounded independent displays; slots remain reserved until cleanup completes. */
export class RemoteSessions {
  private entries = new Map<
    string,
    {
      lease: RemoteLease
      worker: RemoteWorker
      connections: Set<() => void>
      closing?: Promise<void>
    }
  >()
  private closed = false
  private timer: NodeJS.Timeout
  constructor(
    private createWorker: (slot: number) => RemoteWorker,
    private validate: (lease: RemoteLease) => Promise<void>,
    private now = Date.now,
    private maxSessions = 4
  ) {
    if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 8)
      throw new Error('invalid remote capacity')
    this.timer = setInterval(
      () =>
        void this.check().catch(() =>
          console.error('remote-cleanup-failed; new leases remain blocked')
        ),
      1000
    )
    this.timer.unref()
  }
  async create(
    owner: string,
    cookie: string,
    file: FileRecord,
    display?: RemoteDisplay
  ) {
    const reserved = [...this.entries.values()]
    if (
      this.closed ||
      reserved.length >= this.maxSessions ||
      reserved.some(({ lease }) => lease.owner === owner)
    )
      throw new AppError('remote-busy', 429)
    const slot = Array.from(
      { length: this.maxSessions },
      (_, index) => index
    ).find((index) => !reserved.some(({ lease }) => lease.slot === index))!
    const worker = this.createWorker(slot)
    const startedAt = this.now()
    const lease: RemoteLease = {
      id: token(),
      slot,
      credential: token(),
      ticket: token(),
      owner,
      cookie,
      file,
      expires: this.now() + 180000,
      ready: false,
      abort: new AbortController(),
      disconnectedAt: 0,
      display
    }
    this.entries.set(lease.id, { lease, worker, connections: new Set() }) // Reserve before awaiting startup.
    try {
      await this.validate(lease)
      await worker.start(lease)
      await this.validate(lease)
      if (!this.has(lease)) throw new AppError('remote-expired', 401)
      lease.ready = true
      lease.expires = this.now() + 90000
      lease.disconnectedAt = this.now()
      console.log(
        JSON.stringify({
          event: 'remote-session-ready',
          lease: lease.id,
          elapsedMs: this.now() - startedAt,
          connectionGraceMs: 15000
        })
      )
      return lease
    } catch (error) {
      await this.stop(lease.id, 'startup-failed', error)
      throw error
    }
  }
  async access(
    id: string,
    owner: string,
    credential: string | undefined,
    ready = true
  ) {
    const lease = this.entries.get(id)?.lease
    if (
      !lease ||
      lease.id !== id ||
      lease.owner !== owner ||
      !secretEqual(credential, lease.credential) ||
      lease.expires <= this.now() ||
      (ready && !lease.ready)
    )
      throw new AppError('remote-expired', 401)
    await this.validate(lease)
    if (!this.has(lease)) throw new AppError('remote-expired', 401)
    return lease
  }
  async internal(ticket: string) {
    const lease = this.leases.find((lease) => secretEqual(ticket, lease.ticket))
    if (
      !lease ||
      !secretEqual(ticket, lease.ticket) ||
      lease.expires <= this.now()
    )
      throw new AppError('not-found', 404)
    await this.validate(lease)
    if (!this.has(lease)) throw new AppError('not-found', 404)
    return lease
  }
  renew(lease: RemoteLease) {
    if (!this.has(lease)) throw new AppError('remote-expired', 401)
    lease.expires = this.now() + 90000
  }
  get leases() {
    return [...this.entries.values()]
      .filter((entry) => !entry.closing && !entry.lease.abort.signal.aborted)
      .map((entry) => entry.lease)
  }
  has(lease: RemoteLease) {
    const entry = this.entries.get(lease.id)
    return (
      entry?.lease === lease && !entry.closing && !lease.abort.signal.aborted
    )
  }
  workerFor(lease: RemoteLease) {
    if (!this.has(lease)) throw new AppError('remote-expired', 401)
    return this.entries.get(lease.id)!.worker
  }
  connectionsFor(lease: RemoteLease) {
    return this.entries.get(lease.id)?.connections
  }
  connected(lease: RemoteLease) {
    if (this.has(lease)) lease.disconnectedAt = 0
  }
  disconnected(lease: RemoteLease) {
    if (this.has(lease) && this.connectionsFor(lease)?.size === 0)
      lease.disconnectedAt = this.now()
  }
  async stopOwner(owner: string, reason: RemoteStopReason = 'logout') {
    await Promise.all(
      [...this.entries.values()]
        .filter(({ lease }) => lease.owner === owner)
        .map(({ lease }) => this.stop(lease.id, reason))
    )
  }
  async stop(
    id?: string,
    reason: RemoteStopReason = 'requested',
    error?: unknown
  ): Promise<void> {
    if (!id) {
      await Promise.all(
        [...this.entries.keys()].map((key) => this.stop(key, reason, error))
      )
      return
    }
    const entry = this.entries.get(id)
    if (!entry) return
    if (entry.closing) return entry.closing
    const { lease, worker, connections } = entry
    console.log(
      JSON.stringify({
        event: 'remote-session-stop',
        lease: lease.id,
        reason,
        errorCode:
          error === undefined ? undefined : remoteErrorCode(error, reason),
        ready: lease.ready,
        connections: connections.size
      })
    )
    lease.abort.abort()
    for (const close of connections) close()
    connections.clear()
    // Failed cleanup retains the slot; never reuse a display with leftover children.
    entry.closing = worker.stop(lease.id).then(() => {
      this.entries.delete(id)
    })
    await entry.closing
  }
  private async check() {
    await Promise.all(this.leases.map((lease) => this.checkLease(lease)))
  }
  private async checkLease(lease: RemoteLease) {
    let reason: RemoteStopReason = 'validation-failed'
    try {
      if (lease.expires <= this.now()) {
        reason = 'lease-expired'
        throw new Error(reason)
      }
      if (
        lease.ready &&
        this.workerFor(lease).alive &&
        !this.workerFor(lease).alive!()
      ) {
        reason = 'worker-exited'
        throw new Error(reason)
      }
      if (
        lease.ready &&
        lease.disconnectedAt &&
        this.now() - lease.disconnectedAt > 15000
      ) {
        reason = 'stream-disconnected'
        throw new Error(reason)
      }
      await this.validate(lease)
    } catch (error) {
      await this.stop(lease.id, reason, error)
    }
  }
  close() {
    this.closed = true
    clearInterval(this.timer)
    return this.stop(undefined, 'shutdown')
  }
}
