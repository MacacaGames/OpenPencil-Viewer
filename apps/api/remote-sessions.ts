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

/** One exclusive display, with a new browser/profile/display/encoder per lease. */
export class RemoteSessions {
  active?: RemoteLease
  private closing?: Promise<void>
  private timer: NodeJS.Timeout
  readonly connections = new Set<() => void>()
  constructor(
    readonly worker: RemoteWorker,
    private validate: (lease: RemoteLease) => Promise<void>,
    private now = Date.now
  ) {
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
    if (this.active || this.closing) throw new AppError('remote-busy', 429)
    const startedAt = this.now()
    const lease: RemoteLease = {
      id: token(),
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
    this.active = lease // Reserve before awaiting any process or parsing.
    try {
      await this.validate(lease)
      await this.worker.start(lease)
      await this.validate(lease)
      if (this.active !== lease) throw new AppError('remote-expired', 401)
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
    const lease = this.active
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
    if (this.active !== lease) throw new AppError('remote-expired', 401)
    return lease
  }
  async internal(ticket: string) {
    const lease = this.active
    if (
      !lease ||
      !secretEqual(ticket, lease.ticket) ||
      lease.expires <= this.now()
    )
      throw new AppError('not-found', 404)
    await this.validate(lease)
    if (this.active !== lease) throw new AppError('not-found', 404)
    return lease
  }
  renew(lease: RemoteLease) {
    if (this.active !== lease) throw new AppError('remote-expired', 401)
    lease.expires = this.now() + 90000
  }
  connected(lease: RemoteLease) {
    if (this.active === lease) lease.disconnectedAt = 0
  }
  disconnected(lease: RemoteLease) {
    if (this.active === lease && this.connections.size === 0)
      lease.disconnectedAt = this.now()
  }
  async stop(
    id?: string,
    reason: RemoteStopReason = 'requested',
    error?: unknown
  ) {
    const lease = this.active
    if (id && lease?.id !== id) return
    if (!lease) return this.closing
    console.log(
      JSON.stringify({
        event: 'remote-session-stop',
        lease: lease.id,
        reason,
        errorCode:
          error === undefined ? undefined : remoteErrorCode(error, reason),
        ready: lease.ready,
        connections: this.connections.size
      })
    )
    this.active = undefined
    lease.abort.abort()
    for (const close of this.connections) close()
    this.connections.clear()
    this.closing = this.worker.stop(lease.id).then(() => {
      this.closing = undefined
    })
    await this.closing
  }
  private async check() {
    const lease = this.active
    if (!lease) return
    let reason: RemoteStopReason = 'validation-failed'
    try {
      if (lease.expires <= this.now()) {
        reason = 'lease-expired'
        throw new Error(reason)
      }
      if (lease.ready && this.worker.alive && !this.worker.alive()) {
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
    clearInterval(this.timer)
    return this.stop(undefined, 'shutdown')
  }
}
