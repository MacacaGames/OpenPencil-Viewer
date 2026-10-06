import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseConfig } from '../../apps/api/config.ts'
import {
  RemoteSessions,
  type RemoteLease
} from '../../apps/api/remote-sessions.ts'
import { remoteDisplay } from '../../packages/contracts/remote-display.ts'
const raw = JSON.parse(
  readFileSync('deploy/selkies/config.example.json', 'utf8')
)
const limits = parseConfig({
  ...raw,
  googleClientId: 'synthetic',
  googleClientSecret: 'synthetic'
}).remote!

test('A tab switches documents at full capacity without restarting its worker; stale closes cannot stop the new document', async () => {
  let starts = 0,
    reloads = 0,
    stops = 0
  const manager = new RemoteSessions(
    () => ({
      streamUrl: 'http://127.0.0.1:8086',
      corePath: '/unused',
      start: async () => {
        starts++
      },
      reload: async () => {
        reloads++
      },
      stop: async () => {
        stops++
      }
    }),
    async () => undefined,
    Date.now,
    1
  )
  const file = {
    id: 'A',
    rootId: 'designs',
    relative: 'A.fig',
    name: 'A.fig',
    parentId: '',
    kind: 'file' as const,
    size: 1,
    revision: '1'
  }
  const display = remoteDisplay(
    { width: 1280, height: 720, dpr: 1, uiScale: 1.25 },
    limits
  )
  try {
    const a = await manager.openTab('owner', 'cookie', file, display, 'tab', 1)
    const b = await manager.openTab(
      'owner',
      'cookie',
      { ...file, id: 'B', name: 'B.fig' },
      display,
      'tab',
      2
    )
    assert.equal(a, b)
    assert.equal(b.file?.id, 'B')
    assert.equal(b.generation, 2)
    assert.deepEqual([starts, reloads, stops], [1, 1, 0])
    assert.equal(manager.leases.length, 1)
    await manager.stopTab('owner', 'tab', 1)
    assert.equal(manager.has(b), true)
    await manager.stopTab('owner', 'tab', 2)
    assert.equal(manager.leases.length, 0)
    assert.throws(
      () => manager.openTab('owner', 'cookie', file, display, 'tab', 2),
      /remote-superseded/
    )
    const fresh = await manager.openTab(
      'owner',
      'cookie',
      file,
      display,
      'tab',
      3
    )
    assert.notEqual(fresh.id, b.id)
    assert.equal(fresh.slot, 0)
  } finally {
    await manager.close()
  }
})

test('Two tabs of one login have independent leases, and closing one leaves the other active', async () => {
  const manager = new RemoteSessions(
    (slot) => ({
      streamUrl: `http://127.0.0.1:${8086 + slot}`,
      corePath: '/unused',
      start: async () => undefined,
      stop: async () => undefined
    }),
    async () => undefined,
    Date.now,
    2
  )
  const file = {
    id: 'A',
    rootId: 'designs',
    relative: 'A.fig',
    name: 'A.fig',
    parentId: '',
    kind: 'file' as const,
    size: 1,
    revision: '1'
  }
  const display = remoteDisplay(
    { width: 1280, height: 720, dpr: 1, uiScale: 1.25 },
    limits
  )
  try {
    const [a, b] = await Promise.all(
      ['tab-A', 'tab-B'].map((tab) =>
        manager.openTab('owner', 'cookie', file, display, tab, 1)
      )
    )
    assert.notEqual(a.id, b.id)
    assert.notEqual(a.slot, b.slot)
    await manager.stopTab('foreign-owner', 'tab-A', 1)
    assert.equal(manager.leases.length, 2)
    await manager.stopTab('owner', 'tab-A', 1)
    assert.deepEqual(
      manager.leases.map((lease) => lease.id),
      [b.id]
    )
    assert.equal(await manager.access(b.id, 'owner', b.credential), b)
    await manager.stopOwner('owner')
    assert.equal(manager.leases.length, 0)
  } finally {
    await manager.close()
  }
})

test('Closing a tab before or during startup cancels the reservation, even if the original response is lost', async () => {
  let starts = 0,
    stops = 0,
    started: RemoteLease | undefined
  const manager = new RemoteSessions(
    () => ({
      streamUrl: 'http://127.0.0.1:8086',
      corePath: '/unused',
      start: async (lease) => {
        starts++
        started = lease
        await new Promise<void>((_resolve, reject) =>
          lease.abort.signal.addEventListener(
            'abort',
            () => reject(new Error('canceled')),
            { once: true }
          )
        )
      },
      stop: async () => {
        stops++
      }
    }),
    async () => undefined,
    Date.now,
    1
  )
  const file = {
    id: 'A',
    rootId: 'designs',
    relative: 'A.fig',
    name: 'A.fig',
    parentId: '',
    kind: 'file' as const,
    size: 1,
    revision: '1'
  }
  const display = remoteDisplay(
    { width: 1280, height: 720, dpr: 1, uiScale: 1.25 },
    limits
  )
  try {
    await manager.stopTab('owner', 'tab', 1)
    assert.throws(
      () => manager.openTab('owner', 'cookie', file, display, 'tab', 1),
      /remote-superseded/
    )
    assert.equal(starts, 0)
    const opening = manager.openTab('owner', 'cookie', file, display, 'tab', 2)
    const rejected = assert.rejects(opening, /canceled/)
    await new Promise((resolve) => setImmediate(resolve))
    assert.ok(started)
    await manager.stopTab('owner', 'tab', 2)
    await rejected
    assert.equal(started.abort.signal.aborted, true)
    assert.equal(stops, 1)
    assert.equal(manager.leases.length, 0)
  } finally {
    await manager.close()
  }
})

test('A connected client is reclaimed after the disconnect grace; reconnect cancels reclamation', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  let now = 100,
    stops = 0
  const manager = new RemoteSessions(
    () => ({
      streamUrl: 'http://127.0.0.1:8086',
      corePath: '/unused',
      start: async () => undefined,
      stop: async () => {
        stops++
      }
    }),
    async () => undefined,
    () => now,
    1,
    3000
  )
  const file = {
    id: 'A',
    rootId: 'designs',
    relative: 'A.fig',
    name: 'A.fig',
    parentId: '',
    kind: 'file' as const,
    size: 1,
    revision: '1'
  }
  const poll = async () => {
    t.mock.timers.tick(1000)
    await new Promise((resolve) => setImmediate(resolve))
  }
  try {
    const lease = await manager.create('owner', 'cookie', file)
    manager.connected(lease)
    manager.disconnected(lease)
    now += 2999
    await poll()
    assert.equal(manager.has(lease), true)
    manager.connected(lease)
    now += 10000
    await poll()
    assert.equal(manager.has(lease), true)
    manager.disconnected(lease)
    now += 3001
    await poll()
    assert.equal(manager.leases.length, 0)
    assert.equal(stops, 1)
  } finally {
    await manager.close()
  }
})

test('Document switching keeps stream authorization valid while awaiting the new native presentation', async () => {
  let release!: () => void
  const manager = new RemoteSessions(
    () => ({
      streamUrl: 'http://127.0.0.1:8086',
      corePath: '/unused',
      start: async () => undefined,
      stop: async () => undefined,
      reload: async () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    }),
    async () => undefined,
    Date.now,
    1
  )
  const file = {
    id: 'A',
    rootId: 'designs',
    relative: 'A.fig',
    name: 'A.fig',
    parentId: '',
    kind: 'file' as const,
    size: 1,
    revision: '1'
  }
  const display = remoteDisplay(
    { width: 1280, height: 720, dpr: 1, uiScale: 1.25 },
    limits
  )
  try {
    const lease = await manager.openTab(
      'owner',
      'cookie',
      file,
      display,
      'tab',
      1
    )
    const switching = manager.openTab(
      'owner',
      'cookie',
      { ...file, id: 'B' },
      display,
      'tab',
      2
    )
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(
      (await manager.access(lease.id, 'owner', lease.credential)).id,
      lease.id
    )
    assert.equal(manager.leases.length, 1)
    release()
    assert.equal((await switching).file?.id, 'B')
  } finally {
    await manager.close()
  }
})
