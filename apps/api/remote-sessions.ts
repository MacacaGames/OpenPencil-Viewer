import { randomBytes, timingSafeEqual } from 'node:crypto'
import { AppError, type FileRecord } from '../../packages/contracts/index.ts'

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
}
export interface RemoteWorker {
  start(lease: RemoteLease): Promise<void>
  stop(id: string): Promise<void>
  streamUrl: string
  corePath: string
  alive?(): boolean
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
  async create(owner: string, cookie: string, file: FileRecord) {
    if (this.active || this.closing) throw new AppError('remote-busy', 429)
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
      disconnectedAt: 0
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
      return lease
    } catch (error) {
      await this.stop(lease.id)
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
  async stop(id?: string) {
    const lease = this.active
    if (id && lease?.id !== id) return
    if (!lease) return this.closing
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
    try {
      if (lease.expires <= this.now()) throw new Error('expired')
      if (lease.ready && this.worker.alive && !this.worker.alive())
        throw new Error('worker-exited')
      if (
        lease.ready &&
        lease.disconnectedAt &&
        this.now() - lease.disconnectedAt > 15000
      )
        throw new Error('stream-disconnected')
      await this.validate(lease)
    } catch {
      await this.stop(lease.id)
    }
  }
  close() {
    clearInterval(this.timer)
    return this.stop()
  }
}
