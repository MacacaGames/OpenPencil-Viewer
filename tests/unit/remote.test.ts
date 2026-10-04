import test from 'node:test'
import assert from 'node:assert/strict'
import {
  remoteInput,
  createRemoteInput
} from '../../apps/api/remote-protocol.ts'
import { assertRemoteMount } from '../../apps/api/remote-mount.ts'
import { parseConfig } from '../../apps/api/config.ts'
import { readFileSync } from 'node:fs'
import {
  RemoteSessions,
  remoteErrorCode,
  type RemoteLease
} from '../../apps/api/remote-sessions.ts'
import { AppError } from '../../packages/contracts/index.ts'
const limits = {
  runtimePath: '/state/remote',
  appPort: 8085 as const,
  streamPort: 8086 as const,
  maxWidth: 1920,
  maxHeight: 1080,
  maxPixels: 2073600,
  maxDpi: 192
}
test('Remote profile path cannot overlap public assets or readonly document roots', () => {
  const raw = JSON.parse(
    readFileSync('deploy/selkies/config.example.json', 'utf8')
  )
  raw.googleClientId = 'synthetic'
  raw.googleClientSecret = 'synthetic'
  assert.doesNotThrow(() => parseConfig(raw))
  for (const path of [
    '/data/designs/profiles',
    '/app/dist/web',
    '/app/dist',
    '/state//remote'
  ]) {
    assert.throws(
      () =>
        parseConfig({ ...raw, remote: { ...raw.remote, runtimePath: path } }),
      /isolated/
    )
  }
})
test('Remote protocol rejects export/control messages and caps physical resolution/DPI', () => {
  for (const message of [
    'cmd,id',
    'cw,secret',
    'REQUEST_CLIPBOARD',
    'kd,108',
    'kd,65481',
    'co,end,123',
    'r,1920x1080,display2',
    'SETTINGS,[]'
  ])
    assert.equal(remoteInput(message, limits), undefined)
  assert.equal(remoteInput('kd,32', limits), 'kd,32')
  assert.equal(
    remoteInput('r,7680x4320,primary', limits),
    'r,1920x1080,primary'
  )
  const settings = JSON.parse(
    remoteInput(
      'SETTINGS,{"initialClientWidth":7680,"initialClientHeight":4320,"scaling_dpi":288,"use_cpu":false,"encoder":"jpeg","file_transfers":"download"}',
      limits
    )!.slice(9)
  )
  assert.deepEqual(
    [
      settings.initialClientWidth,
      settings.initialClientHeight,
      settings.scaling_dpi
    ],
    [1920, 1080, 192]
  )
  assert.equal(settings.encoder, 'h264enc')
  assert.equal(settings.use_cpu, undefined)
  assert.equal(settings.file_transfers, undefined)
  const invalid = JSON.parse(
    remoteInput(
      'SETTINGS,{"scaling_dpi":"NaN","displayScale":"Infinity"}',
      limits
    )!.slice(9)
  )
  assert.equal(invalid.scaling_dpi, 96)
  assert.equal(invalid.displayScale, 1)
})
test('Remote mount proof accepts operator-selected RO/RW and rejects empty/local/wrong NAS mounts', () => {
  const root = [{ id: 'designs', label: 'test', path: '/data/designs' }]
  const entry =
    '30 29 0:50 / /data/designs ro,relatime - cifs //nas/Designs rw,vers=3.1.1\n'
  assert.doesNotThrow(() => assertRemoteMount(root, '//nas/Designs', entry))
  assert.doesNotThrow(() =>
    assertRemoteMount(
      root,
      '//nas/Designs',
      entry.replace('ro,relatime', 'rw,relatime')
    )
  )
  assert.doesNotThrow(() =>
    assertRemoteMount(
      root,
      ':/approved-export',
      '342 328 0:138 / /data/designs rw,relatime - nfs4 :/approved-export rw,vers=4.0,addr=10.0.1.1\n'
    )
  )
  for (const table of [
    entry.replace('cifs', 'ext4'),
    entry.replace('/data/designs', '/data/designs-other'),
    entry.replace('ro,relatime', 'relatime'),
    entry.replace('//nas/Designs', '//other/Designs'),
    ''
  ])
    assert.throws(() => assertRemoteMount(root, '//nas/Designs', table))
  assert.throws(() => assertRemoteMount(root, undefined, entry))
  assert.throws(() =>
    assertRemoteMount(
      root,
      '//nas/Designs',
      entry +
        entry
          .replace('30 29', '31 30')
          .replace('//nas/Designs', '//other/Designs')
    )
  )
})
test('NAS durable proof survives device/mount-number changes but detects server/export/subtree changes', () => {
  const root = [{ id: 'designs', label: 'test', path: '/data/designs' }]
  const entry =
    '342 328 0:138 / /data/designs rw,relatime - nfs4 :/volume1/Gd rw,vers=4.0,addr=10.0.1.1\n'
  const before = assertRemoteMount(root, ':/volume1/Gd', entry)
  const after = assertRemoteMount(
    root,
    ':/volume1/Gd',
    entry
      .replace('342 328 0:138', '400 399 0:200')
      .replace('rw,relatime', 'ro,relatime')
  )
  assert.equal(before.identity, after.identity)
  assert.notEqual(before.mountId, after.mountId)
  for (const changed of [
    entry.replace('10.0.1.1', '10.0.1.3'),
    entry.replace(' / /data', ' /subtree /data')
  ])
    assert.notEqual(
      assertRemoteMount(root, ':/volume1/Gd', changed).identity,
      before.identity
    )
  assert.throws(() =>
    assertRemoteMount(root, ':/volume1/Gd', entry.replace(',addr=10.0.1.1', ''))
  )
  assert.throws(() => assertRemoteMount(root, ':/volume1/Other', entry))
})
test('Session edits are explicitly Selkies-only; production DSM and raster cannot unlock', () => {
  const raw = JSON.parse(
    readFileSync('deploy/selkies/config.example.json', 'utf8')
  )
  raw.googleClientId = raw.googleClientSecret = 'synthetic'
  assert.equal(parseConfig(raw).mode, 'session-edit')
  assert.throws(
    () => parseConfig({ ...raw, viewerMode: 'raster', remote: undefined }),
    /session-edit/
  )
  assert.throws(
    () => parseConfig({ ...raw, authorizationMode: 'dsm-strict' }),
    /selkies requires/
  )
})
test('Editing socket accepts text, delete and undo while rejecting browser/desktop escape chords', () => {
  const input = createRemoteInput(limits, true)
  for (const key of [97, 122, 65288, 65535, 0x01004e2d]) {
    assert.equal(input('kd,' + key), 'kd,' + key)
    assert.equal(input('ku,' + key), 'ku,' + key)
  }
  assert.equal(input('kd,65507'), 'kd,65507')
  for (const key of [108, 111, 112, 115, 116, 119])
    assert.equal(input('kd,' + key), undefined)
  assert.equal(input('kd,122'), 'kd,122')
  assert.equal(input('ku,122'), 'ku,122')
  assert.equal(input('kd,65505'), 'kd,65505')
  assert.equal(input('kd,99'), undefined)
  assert.equal(input('kd,65481'), undefined)
  assert.equal(input('kh,65507,111'), 'kh,65507')
  assert.equal(input('kr'), 'kr')
  assert.equal(input('cw,secret'), undefined)
  assert.equal(createRemoteInput(limits, false)('kd,97'), undefined)
})
test('Exclusive lease reserves before startup, never shares controls, aborts and waits for cleanup', async () => {
  let started: RemoteLease | undefined,
    stopped = 0,
    release: () => void = () => undefined,
    now = 100
  const worker = {
    streamUrl: 'http://127.0.0.1:8086',
    corePath: '/unused',
    start: async (lease: RemoteLease) => {
      started = lease
      await new Promise<void>((r) => {
        release = r
      })
    },
    stop: async () => {
      stopped++
    }
  }
  const manager = new RemoteSessions(
    worker,
    async () => undefined,
    () => now
  )
  try {
    const file = {
      id: 'test',
      rootId: 'designs',
      relative: 'A.fig',
      name: 'A.fig',
      parentId: '',
      kind: 'file' as const,
      size: 1,
      revision: '1'
    }
    const pending = manager.create('alice', 'cookie-A', file)
    await new Promise((r) => setImmediate(r))
    await assert.rejects(manager.create('bob', 'cookie-B', file), /remote-busy/)
    assert.equal(started?.ready, false)
    release()
    const lease = await pending
    await assert.rejects(
      manager.access(lease.id, 'bob', lease.credential),
      /remote-expired/
    )
    await assert.rejects(
      manager.access(lease.id, 'alice', 'wrong'),
      /remote-expired/
    )
    assert.equal(
      (await manager.access(lease.id, 'alice', lease.credential)).id,
      lease.id
    )
    now += 90001
    await assert.rejects(
      manager.access(lease.id, 'alice', lease.credential),
      /remote-expired/
    )
    await manager.stop()
    assert.equal(lease.abort.signal.aborted, true)
    assert.equal(stopped, 1)
  } finally {
    await manager.close()
  }
})

test('Remote lifecycle distinguishes missing stream, expiry, worker failure and source rejection without logging secrets', async (t) => {
  const logs: string[] = []
  t.mock.method(console, 'log', (value: unknown) => logs.push(String(value)))
  t.mock.timers.enable({ apis: ['setInterval'] })
  let now = 100,
    alive = true,
    rejected: Error | undefined,
    startupError: Error | undefined,
    stopped = 0
  const worker = {
    streamUrl: 'http://127.0.0.1:8086',
    corePath: '/unused',
    start: async () => {
      if (startupError) throw startupError
    },
    stop: async () => {
      stopped++
    },
    alive: () => alive
  }
  const manager = new RemoteSessions(
    worker,
    async () => {
      if (rejected) throw rejected
    },
    () => now
  )
  const file = {
    id: 'file',
    rootId: 'designs',
    relative: 'private-source.fig',
    name: 'private-source.fig',
    parentId: '',
    kind: 'file' as const,
    size: 1,
    revision: '1'
  }
  const poll = async () => {
    t.mock.timers.tick(1000)
    await new Promise((resolve) => setImmediate(resolve))
  }
  const reports = () => logs.map((line) => JSON.parse(line))
  try {
    const lease = await manager.create('private-owner', 'private-cookie', file)
    // No display client after readiness is different from a document failure.
    now += 15001
    await poll()
    assert.equal(manager.active, undefined)
    assert.equal(reports().at(-1).reason, 'stream-disconnected')
    assert.equal(reports().at(-1).ready, true)
    assert.equal(reports().at(-1).connections, 0)

    await manager.create('private-owner', 'private-cookie', file)
    now += 90001
    await poll()
    assert.equal(reports().at(-1).reason, 'lease-expired')

    await manager.create('private-owner', 'private-cookie', file)
    alive = false
    await poll()
    assert.equal(reports().at(-1).reason, 'worker-exited')
    alive = true

    await manager.create('private-owner', 'private-cookie', file)
    rejected = new AppError('source-changed', 409)
    await poll()
    assert.equal(reports().at(-1).reason, 'validation-failed')
    assert.equal(reports().at(-1).errorCode, 'source-changed')
    rejected = undefined

    startupError = new Error('private-cookie /secret/file.fig')
    await assert.rejects(
      manager.create('private-owner', 'private-cookie', file)
    )
    assert.equal(reports().at(-1).reason, 'startup-failed')
    assert.equal(reports().at(-1).ready, false)
    assert.equal(reports().at(-1).errorCode, 'startup-failed')
    startupError = undefined

    await manager.create('private-owner', 'private-cookie', file)
    await manager.stop(undefined, 'logout')
    assert.equal(reports().at(-1).reason, 'logout')
    assert.equal(stopped, 6)
    for (const secret of [
      lease.cookie,
      lease.ticket,
      lease.credential,
      file.name,
      'private-owner',
      '/secret/file.fig'
    ])
      assert.equal(logs.join('\n').includes(secret), false)
    assert.equal(
      remoteErrorCode(new AppError('/secret/file.fig'), 'unknown'),
      'unknown'
    )
  } finally {
    await manager.close()
  }
})
