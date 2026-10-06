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

test('32 independent reservations are admitted; starting and retiring workers count until cleanup finishes', async () => {
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
    { maxSessionsPerAccount: 32, blankPrewarmIdleMs: 60000 }
  )
  try {
    const first = manager.warmTab('owner', 'cookie', display, 'tab-0', 1)
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(manager.capacity, { used: 1, limit: 32 })
    start()
    const lease = await first
    await Promise.all(
      Array.from({ length: 31 }, (_, i) =>
        manager.warmTab('owner', 'cookie', display, `tab-${i + 1}`, 1)
      )
    )
    assert.deepEqual(
      manager.leases.map((lease) => lease.slot).sort((a, b) => a - b),
      Array.from({ length: 32 }, (_, i) => i)
    )
    await assert.rejects(
      manager.warmTab('other-owner', 'cookie', display, 'overflow', 1),
      /remote-busy/
    )
    const stopping = manager.stop(lease.id)
    assert.deepEqual(manager.capacity, { used: 32, limit: 32 })
    finish()
    await stopping
    assert.deepEqual(manager.capacity, { used: 31, limit: 32 })
  } finally {
    await manager.close()
  }
})

test('Blank warmup and mode parking reuse one worker; unchanged source resumes its in-memory graph at capacity', async () => {
  let starts = 0,
    reloads = 0
  const manager = new RemoteSessions(
    () => ({
      ...worker(),
      start: async () => {
        starts++
      },
      reload: async () => {
        reloads++
      }
    }),
    async () => undefined,
    Date.now,
    1
  )
  try {
    const blank = await manager.warmTab('owner', 'cookie', display, 'tab', 1)
    assert.equal(blank.file, undefined)
    assert.equal(blank.parked, true)
    await assert.rejects(
      manager.access(blank.id, 'owner', blank.credential),
      /remote-expired/
    )
    assert.equal(
      await manager.access(blank.id, 'owner', blank.credential, false),
      blank
    )
    const opened = await manager.openTab(
      'owner',
      'cookie',
      file,
      display,
      'tab',
      2
    )
    assert.equal(opened, blank)
    assert.equal(opened.generation, 2)
    manager.connected(opened)
    let closed = 0
    const close = () => {
      closed++
      manager.connectionsFor(opened)?.delete(close)
      manager.disconnected(opened)
    }
    manager.connectionsFor(opened)?.add(close)
    const parked = await manager.warmTab('owner', 'cookie', display, 'tab', 3)
    assert.equal(closed, 1)
    assert.equal(parked.file, file)
    assert.equal(parked.parked, true)
    const resumed = await manager.openTab(
      'owner',
      'cookie',
      { ...file },
      display,
      'tab',
      4
    )
    assert.equal(resumed, opened)
    assert.equal(resumed.generation, 2)
    assert.equal(resumed.parked, false)
    assert.deepEqual([starts, reloads], [1, 1])
    await manager.openTab(
      'owner',
      'cookie',
      { ...file, revision: '2' },
      display,
      'tab',
      5
    )
    assert.equal(resumed.generation, 3)
    assert.equal(reloads, 2)
  } finally {
    await manager.close()
  }
})

test('Parked sessions survive stream grace with HTTP heartbeats; expired heartbeats and dead workers are reclaimed', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  let now = 100,
    alive = true
  const manager = new RemoteSessions(
    () => ({ ...worker(), alive: () => alive }),
    async () => undefined,
    () => now,
    1
  )
  const check = async () => {
    t.mock.timers.tick(1000)
    await new Promise((resolve) => setImmediate(resolve))
  }
  try {
    const lease = await manager.warmTab('owner', 'cookie', display, 'tab', 1)
    now += 30000
    await check()
    assert.equal(manager.has(lease), true)
    manager.renew(lease)
    now += 89999
    await check()
    assert.equal(manager.has(lease), true)
    now += 2
    await check()
    assert.deepEqual(manager.capacity, { used: 0, limit: 1 })
    const fresh = await manager.warmTab('owner', 'cookie', display, 'tab', 2)
    alive = false
    await check()
    assert.equal(manager.has(fresh), false)
  } finally {
    await manager.close()
  }
})

test('Closing during blank warmup cancels queued document opening without leaking a slot', async () => {
  let start!: () => void
  const manager = new RemoteSessions(
    () => ({
      ...worker(),
      start: () =>
        new Promise<void>((resolve) => {
          start = resolve
        })
    }),
    async () => undefined,
    Date.now,
    1
  )
  try {
    const warm = manager.warmTab('owner', 'cookie', display, 'tab', 1)
    const warmError = assert.rejects(warm, /remote-expired/)
    await new Promise((resolve) => setImmediate(resolve))
    const open = manager.openTab('owner', 'cookie', file, display, 'tab', 2)
    const openError = assert.rejects(open, /remote-superseded/)
    await manager.stopTab('owner', 'tab', 2)
    start()
    await Promise.all([warmError, openError])
    assert.deepEqual(manager.capacity, { used: 0, limit: 1 })
  } finally {
    await manager.close()
  }
})

test('Resuming a parked stream gives a connection grace, then normal disconnect cleanup resumes', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  let now = 100
  const manager = new RemoteSessions(
    worker,
    async () => undefined,
    () => now,
    1
  )
  const check = async () => {
    t.mock.timers.tick(1000)
    await new Promise((resolve) => setImmediate(resolve))
  }
  try {
    const lease = await manager.openTab(
      'owner',
      'cookie',
      file,
      display,
      'tab',
      1
    )
    manager.connected(lease)
    await manager.warmTab('owner', 'cookie', display, 'tab', 2)
    now += 30000
    await manager.openTab('owner', 'cookie', file, display, 'tab', 3)
    now += 14999
    await check()
    assert.equal(manager.has(lease), true)
    now += 2
    await check()
    assert.equal(manager.has(lease), false)
  } finally {
    await manager.close()
  }
})
