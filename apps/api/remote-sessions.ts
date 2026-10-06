import { randomBytes, timingSafeEqual } from 'node:crypto'
import { AppError, type FileRecord } from '../../packages/contracts/index.ts'
import type { RemoteDisplay } from '../../packages/contracts/remote-display.ts'

const token = () => randomBytes(32).toString('base64url')
export const remoteCookieName = (secure: boolean, id: string) =>
  `${secure ? '__Host-' : ''}portal-stream-${id}`
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
  loading?: boolean
  abort: AbortController
  disconnectedAt: number
  connectedOnce?: boolean
  tab?: string
  request?: number
  generation: number
  encoderMode?: string
  display?: RemoteDisplay
}
export interface RemoteWorker {
  start(lease: RemoteLease): Promise<void>
  stop(id: string): Promise<void>
  reload?(lease: RemoteLease): Promise<void>
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
  | 'tab-closed'

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
  private tabs = new Map<
    string,
    {
      owner: string
      latest: number
      closed: number
      touched: number
      queue: Promise<void>
    }
  >()
  private timer: NodeJS.Timeout
  constructor(
    private createWorker: (slot: number) => RemoteWorker,
    private validate: (lease: RemoteLease) => Promise<void>,
    private now = Date.now,
    private maxSessions = 4,
    private disconnectGraceMs = 3000
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
    display?: RemoteDisplay,
    tab?: string,
    request?: number
  ) {
    const reserved = [...this.entries.values()]
    if (
      this.closed ||
      reserved.length >= this.maxSessions ||
      reserved.some(({ lease }) => lease.owner === owner && lease.tab === tab)
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
      display,
      tab,
      request,
      generation: 1
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
  private tabState(owner: string, tab: string) {
    const key = owner + ':' + tab
    for (const [key, state] of this.tabs)
      if (
        this.now() - state.touched > 3600000 &&
        ![...this.entries.values()].some(
          ({ lease }) => lease.owner + ':' + lease.tab === key
        )
      )
        this.tabs.delete(key)
    let state = this.tabs.get(key)
    if (!state) {
      if (this.tabs.size >= 4096) throw new AppError('remote-busy', 429)
      state = {
        owner,
        latest: 0,
        closed: 0,
        touched: this.now(),
        queue: Promise.resolve()
      }
      this.tabs.set(key, state)
    }
    state.touched = this.now()
    return state
  }
  /** One reservation per browser tab. A late close can only cancel its own open. */
  openTab(
    owner: string,
    cookie: string,
    file: FileRecord,
    display: RemoteDisplay,
    tab: string,
    request: number
  ) {
    const state = this.tabState(owner, tab)
    if (request <= state.latest || request <= state.closed)
      throw new AppError('remote-superseded', 409)
    state.latest = request
    const opening = state.queue.then(async () => {
      if (request < state.latest || request <= state.closed || this.closed)
        throw new AppError('remote-superseded', 409)
      let entry = [...this.entries.values()].find(
        ({ lease }) => lease.owner === owner && lease.tab === tab
      )
      if (entry?.closing) {
        await entry.closing
        entry = undefined
      }
      // Navigation may overlap cleanup of another page's retiring slot.
      if (!entry && this.entries.size >= this.maxSessions) {
        await Promise.all(
          [...this.entries.values()]
            .filter((entry) => entry.closing)
            .map((entry) => entry.closing)
        )
      }
      if (request < state.latest || request <= state.closed || this.closed)
        throw new AppError('remote-superseded', 409)
      if (!entry) return this.create(owner, cookie, file, display, tab, request)
      const { lease, worker } = entry
      lease.request = request
      lease.file = file
      lease.display = display
      lease.generation++
      // The stream stays usable while the existing Chromium changes documents.
      lease.loading = true
      lease.expires = this.now() + 180000
      try {
        await this.validate(lease)
        await worker.reload?.(lease)
        await this.validate(lease)
        if (!this.has(lease) || request <= state.closed)
          throw new AppError('remote-superseded', 409)
        lease.loading = false
        if (!entry.connections.size) lease.disconnectedAt = this.now()
        lease.expires = this.now() + 90000
        return lease
      } catch (error) {
        await this.stop(lease.id, 'startup-failed', error)
        throw error
      }
    })
    state.queue = opening.then(
      () => undefined,
      () => undefined
    )
    return opening
  }
  async stopTab(owner: string, tab: string, request: number) {
    const state = this.tabState(owner, tab)
    state.closed = Math.max(state.closed, request)
    await Promise.all(
      [...this.entries.values()]
        .filter(
          ({ lease }) =>
            lease.owner === owner &&
            lease.tab === tab &&
            (lease.request ?? 0) <= request
        )
        .map(({ lease }) => this.stop(lease.id, 'tab-closed'))
    )
  }
  async stopOwned(id: string, owner: string, credential: string | undefined) {
    const entry = this.entries.get(id)
    if (!entry) return
    if (
      entry.lease.owner !== owner ||
      !secretEqual(credential, entry.lease.credential)
    )
      throw new AppError('remote-expired', 401)
    await this.stop(id)
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
    if (this.has(lease)) {
      lease.disconnectedAt = 0
      lease.connectedOnce = true
    }
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
        !lease.loading &&
        lease.disconnectedAt &&
        this.now() - lease.disconnectedAt >
          (lease.connectedOnce ? this.disconnectGraceMs : 15000)
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
