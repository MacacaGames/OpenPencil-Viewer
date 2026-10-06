import test from 'node:test'
import assert from 'node:assert/strict'
import { RemoteSessions } from '../../apps/api/remote-sessions.ts'
import type { FileRecord } from '../../packages/contracts/index.ts'

const file: FileRecord = {
  id: 'A',
  rootId: 'designs',
  relative: 'A.fig',
  name: 'A.fig',
  parentId: '',
  kind: 'file',
  size: 1,
  revision: '1'
}
const display = {
  cssWidth: 1280,
  cssHeight: 720,
  width: 1280,
  height: 720,
  density: 1,
  dpi: 96,
  uiScale: 1.25
}
const worker = () => ({
  streamUrl: 'http://127.0.0.1:8086',
  corePath: '/unused',
  start: async () => undefined,
  stop: async () => undefined
})
const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

test('Account quota spans login owners, counts startup/parking/cleanup, and permits existing-tab reuse', async () => {
  let start!: () => void, finish!: () => void
  const manager = new RemoteSessions(
    (slot) =>
      slot === 0
        ? {
            ...worker(),
            start: () =>
              new Promise<void>((resolve) => {
                start = resolve
              }),
            stop: () =>
              new Promise<void>((resolve) => {
                finish = resolve
              })
          }
        : worker(),
    async () => undefined,
    Date.now,
    32,
    3000,
    { maxSessionsPerAccount: 2, blankPrewarmIdleMs: 60000 }
  )
  try {
    const pending = manager.warmTab(
      'login-1',
      'cookie',
      display,
      'tab-1',
      1,
      'account-A'
    )
    await settle()
    const loaded = await manager.openTab(
      'login-2',
      'cookie',
      file,
      display,
      'tab-2',
      1,
      'account-A'
    )
    await assert.rejects(
      manager.warmTab('login-3', 'cookie', display, 'tab-3', 1, 'account-A'),
      /remote-account-limit/
    )
    const other = await manager.warmTab(
      'login-B',
      'cookie',
      display,
      'tab-B',
      1,
      'account-B'
    )
    assert.deepEqual(manager.capacityFor('account-A'), {
      used: 3,
      limit: 32,
      account: { used: 2, limit: 2 }
    })
    start()
    const blank = await pending
    await manager.warmTab('login-2', 'cookie', display, 'tab-2', 2, 'account-A')
    assert.equal(
      await manager.openTab(
        'login-2',
        'cookie',
        file,
        display,
        'tab-2',
        3,
        'account-A'
      ),
      loaded
    )
    assert.equal(manager.has(other), true)
    const stopping = manager.stop(blank.id)
    await assert.rejects(
      manager.create(
        'login-3',
        'cookie',
        file,
        display,
        'tab-3',
        2,
        'account-A'
      ),
      /remote-account-limit/
    )
    assert.equal(manager.capacityFor('account-A').account.used, 2)
    finish()
    await stopping
    assert.equal(manager.capacityFor('account-A').account.used, 1)
  } finally {
    await manager.close()
  }
})

test('Only demand at capacity reclaims the oldest idle blank; heartbeat does not postpone reclamation', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  let now = 100
  const manager = new RemoteSessions(
    worker,
    async () => undefined,
    () => now,
    2
  )
  try {
    const oldest = await manager.warmTab(
      'login-A',
      'cookie',
      display,
      'tab-A',
      1,
      'A'
    )
    now += 1000
    const recent = await manager.warmTab(
      'login-B',
      'cookie',
      display,
      'tab-B',
      1,
      'B'
    )
    now = 60099
    await assert.rejects(
      manager.warmTab('login-C', 'cookie', display, 'tab-C', 1, 'C'),
      /remote-busy/
    )
    assert.equal(manager.has(oldest), true)
    now = 60100
    manager.renew(oldest)
    t.mock.timers.tick(1000)
    await settle()
    assert.equal(manager.has(oldest), true) // Idle alone is not an eviction trigger.
    const newcomer = await manager.openTab(
      'login-C',
      'cookie',
      file,
      display,
      'tab-C',
      2,
      'C'
    )
    assert.equal(manager.has(oldest), false)
    assert.equal(manager.has(recent), true)
    assert.equal(newcomer.slot, oldest.slot)
    assert.deepEqual(manager.capacity, { used: 2, limit: 2 })
    await assert.rejects(
      manager.access(oldest.id, 'login-A', oldest.credential, false),
      /remote-expired/
    )
  } finally {
    await manager.close()
  }
})

test('A full account can reclaim its own idle blank, but cannot evict another account to evade quota', async () => {
  let now = 100
  const manager = new RemoteSessions(
    worker,
    async () => undefined,
    () => now,
    8,
    3000,
    { maxSessionsPerAccount: 1, blankPrewarmIdleMs: 60000 }
  )
  try {
    const blank = await manager.warmTab(
      'old-login',
      'cookie',
      display,
      'old-tab',
      1,
      'A'
    )
    const others = await manager.warmTab(
      'other-login',
      'cookie',
      display,
      'other-tab',
      1,
      'B'
    )
    now += 60000
    const replacement = await manager.openTab(
      'new-login',
      'cookie',
      file,
      display,
      'new-tab',
      1,
      'A'
    )
    assert.equal(manager.has(blank), false)
    assert.equal(manager.has(others), true)
    await manager.warmTab('new-login', 'cookie', display, 'new-tab', 2, 'A')
    now += 60000
    manager.renew(replacement)
    await assert.rejects(
      manager.warmTab('third-login', 'cookie', display, 'third-tab', 1, 'A'),
      /remote-account-limit/
    )
    assert.equal(manager.has(replacement), true) // Parked loaded graph is never reclaimed.
    assert.equal(manager.has(others), true)
  } finally {
    await manager.close()
  }
})

test('Reclamation waits for cleanup, serializes competitors, and honors tab closure while waiting', async () => {
  let now = 100,
    finish!: () => void,
    stopping = false
  const manager = new RemoteSessions(
    () => ({
      ...worker(),
      stop: () => {
        if (stopping) return Promise.resolve()
        stopping = true
        return new Promise<void>((resolve) => {
          finish = resolve
        })
      }
    }),
    async () => undefined,
    () => now,
    1
  )
  try {
    const victim = await manager.warmTab(
      'old',
      'cookie',
      display,
      'old-tab',
      1,
      'old'
    )
    now += 60000
    const canceled = manager.openTab(
      'new',
      'cookie',
      file,
      display,
      'new-tab',
      1,
      'new'
    )
    const canceledCheck = assert.rejects(canceled, /remote-superseded/)
    await settle()
    assert.deepEqual(manager.capacity, { used: 1, limit: 1 })
    assert.equal(manager.has(victim), false)
    const competitor = manager.openTab(
      'other',
      'cookie',
      file,
      display,
      'other-tab',
      1,
      'other'
    )
    await manager.stopTab('new', 'new-tab', 1)
    finish()
    await canceledCheck
    const admitted = await competitor
    assert.equal(admitted.slot, victim.slot)
    assert.deepEqual(manager.capacity, { used: 1, limit: 1 })
    await assert.rejects(
      manager.openTab('new', 'cookie', file, display, 'new-tab', 2, 'new'),
      /remote-busy/
    )
  } finally {
    await manager.close()
  }
})

test('Starting and newly active blank workers cannot be reclaimed; a failed stop retains its slot', async () => {
  let now = 100,
    start!: () => void
  const manager = new RemoteSessions(
    () => ({
      ...worker(),
      start: () =>
        new Promise<void>((resolve) => {
          start = resolve
        })
    }),
    async () => undefined,
    () => now,
    1
  )
  try {
    const warming = manager.warmTab('old', 'cookie', display, 'old-tab', 1)
    await settle()
    now += 60000
    await assert.rejects(
      manager.warmTab('new', 'cookie', display, 'new-tab', 1),
      /remote-busy/
    )
    start()
    const blank = await warming
    now += 60000
    await manager.warmTab('old', 'cookie', display, 'old-tab', 2)
    await assert.rejects(
      manager.warmTab('new', 'cookie', display, 'new-tab', 2),
      /remote-busy/
    )
    assert.equal(manager.has(blank), true)
  } finally {
    await manager.close()
  }
  const failed = new RemoteSessions(
    () => ({
      ...worker(),
      stop: async () => {
        throw new Error('cleanup failed')
      }
    }),
    async () => undefined,
    () => now,
    1
  )
  await failed.warmTab('old', 'cookie', display, 'old-tab', 1)
  now += 60000
  await assert.rejects(
    failed.warmTab('new', 'cookie', display, 'new-tab', 1),
    /cleanup failed/
  )
  assert.deepEqual(failed.capacity, { used: 1, limit: 1 })
  await assert.rejects(failed.create('another', 'cookie', file), /remote-busy/)
  await assert.rejects(failed.close(), /cleanup failed/)
})
