import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  statSync,
  rmSync,
  chmodSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createPortal } from '../../apps/api/app.ts'
import { parseConfig } from '../../apps/api/config.ts'
import { NasBridge } from '../../packages/nas-bridge/index.ts'
import { fileId } from '../../packages/filesystem/index.ts'

async function fixture() {
  const base = realpathSync(
    mkdtempSync(resolve(tmpdir(), 'nas-bridge-synthetic-'))
  )
  const source = base + '/source',
    socketPath = base + '/bridge.sock',
    origin = 'http://127.0.0.1:3210'
  mkdirSync(source)
  for (const name of ['A.fig', 'B.fig', 'Shared.fig'])
    copyFileSync('tests/fixtures/basic.fig', source + '/' + name)
  const acceptanceSha256 = 'a'.repeat(64)
  const bridgeConfig = {
    socketPath,
    instanceId: 'synthetic-nas',
    providerId: 'synthetic-only',
    acceptanceSha256
  }
  let enabled = true,
    generation = 'synthetic-1',
    mode = 'normal',
    reads = 0
  const principals = () =>
    ['A', 'B'].map((key) => ({
      key,
      generation,
      username: key === 'A' ? 'alice' : 'bob',
      email: key === 'A' ? 'alice@mock.example' : 'bob@mock.example',
      enabled,
      trustedEmail: true,
      system: false,
      groups: []
    }))
  const config = parseConfig({
    version: 1,
    mode: 'read-only',
    environment: 'development',
    origin,
    host: '127.0.0.1',
    port: 3210,
    identityProvider: 'mock',
    authorizationMode: 'dsm-strict',
    allowedHostedDomains: ['mock.example'],
    statePath: base + '/state.sqlite',
    directoryPath: base + '/missing-directory.json',
    webPath: resolve('dist/web'),
    roots: [{ id: 'designs', label: 'Synthetic', path: source }],
    maxFileBytes: 536870912,
    maxDownloads: 4,
    scanIntervalMs: 10000,
    nasBridge: bridgeConfig
  })
  const portal = createPortal(config)
  await portal.scan()
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const value = JSON.parse(Buffer.concat(chunks).toString())
    const send = (body: unknown) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(body))
    }
    const now = Date.now()
    if (req.url === '/status') {
      send({
        version: 1,
        ready: mode !== 'unavailable',
        instanceId: 'synthetic-nas',
        providerId: 'synthetic-only',
        acceptanceSha256,
        evidenceKind: 'synthetic',
        observedAt: now,
        expiresAt: now + 10000,
        roots: [
          { id: 'designs', identity: portal.index.identities.get('designs') }
        ]
      })
      return
    }
    if (req.url === '/directory') {
      send({
        version: 1,
        instanceId: 'synthetic-nas',
        source: mode === 'wrong-source' ? 'admin-approved' : 'native-dsm',
        observedAt: now,
        expiresAt: mode === 'stale' ? now - 1 : now + 60000,
        principals: principals()
      })
      return
    }
    const record = portal.index.records.get(
      fileId(value.rootId, value.relative)
    )
    const permitted =
      enabled &&
      value.generation === generation &&
      record &&
      (value.relative === '' ||
        value.relative === 'Shared.fig' ||
        value.relative === value.principalKey + '.fig')
    if (req.url === '/authorize') {
      send({ version: 1, allowed: Boolean(permitted) })
      return
    }
    if (!permitted || !record) {
      res.statusCode = 503
      send({ error: 'native-bridge-unavailable' })
      return
    }
    const header = {
      version: 1,
      principalKey: value.principalKey,
      generation: value.generation,
      rootId: value.rootId,
      rootIdentity: value.rootIdentity,
      relative: value.relative,
      size: record.size,
      revision: record.revision
    }
    if (mode === 'wrong-principal') header.principalKey = 'B'
    if (mode === 'wrong-object') header.revision = 'changed'
    if (req.url === '/stat') {
      send(header)
      return
    }
    if (req.url === '/read') {
      reads++
      res.setHeader('Content-Type', 'application/octet-stream')
      res.write(JSON.stringify(header) + '\n')
      const bytes = readFileSync(source + '/' + record.relative)
      if (mode === 'truncated') res.end(bytes.subarray(0, bytes.length - 1))
      else if (mode === 'oversized')
        res.end(Buffer.concat([bytes, Buffer.from('extra')]))
      else res.end(bytes)
      return
    }
    res.statusCode = 503
    send({ error: 'native-bridge-unavailable' })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  chmodSync(socketPath, 0o660)
  const request = (path: string, init: RequestInit = {}) =>
    portal.app.request(origin + path, init)
  const login = async (account: string) => {
    const response = await request('/auth/mock', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ account })
    })
    assert.equal(response.status, 200)
    return response.headers.get('set-cookie')!.split(';')[0]
  }
  // Any accidental broker -> service-UID byte/stat fallback fails the test.
  portal.index.open = async () => {
    throw new Error('local-open-fallback-forbidden')
  }
  portal.index.stat = async () => {
    throw new Error('local-stat-fallback-forbidden')
  }
  return {
    base,
    source,
    config,
    portal,
    request,
    login,
    bridgeConfig,
    setMode: (next: string) => {
      mode = next
    },
    disable: () => {
      enabled = false
    },
    rebuild: () => {
      generation = 'synthetic-2'
    },
    reads: () => reads,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      portal.close()
      rmSync(base, { recursive: true, force: true })
    }
  }
}

test('native bridge synthetic flow: fresh directory, A/B filtering, HEAD and broker-only content', async () => {
  const s = await fixture()
  try {
    const before = ['A.fig', 'B.fig', 'Shared.fig'].map(
      (name) =>
        [
          name,
          readFileSync(s.source + '/' + name),
          statSync(s.source + '/' + name).mtimeMs
        ] as const
    )
    assert.equal((await s.request('/health/ready')).status, 200)
    for (const account of ['A', 'B']) {
      const cookie = await s.login(account),
        headers = { Cookie: cookie }
      const list = await (await s.request('/api/files', { headers })).json()
      assert.deepEqual(
        list.items.map((item: { name: string }) => item.name),
        [account + '.fig', 'Shared.fig']
      )
      const own = '/api/files/' + fileId('designs', account + '.fig')
      assert.equal((await s.request(own, { headers })).status, 200)
      assert.equal(
        (await s.request(own + '/content', { method: 'HEAD', headers })).status,
        200
      )
      const response = await s.request(own + '/content', { headers })
      assert.equal(response.status, 200)
      assert.deepEqual(
        Buffer.from(await response.arrayBuffer()),
        readFileSync(s.source + '/' + account + '.fig')
      )
      const other = account === 'A' ? 'B' : 'A'
      for (const suffix of ['', '/content', '/thumbnail'])
        assert.equal(
          (
            await s.request(
              '/api/files/' + fileId('designs', other + '.fig') + suffix,
              { headers }
            )
          ).status,
          404
        )
    }
    assert.equal(s.reads(), 2)
    for (const [name, bytes, mtime] of before) {
      assert.deepEqual(readFileSync(s.source + '/' + name), bytes)
      assert.equal(statSync(s.source + '/' + name).mtimeMs, mtime)
    }
  } finally {
    await s.close()
  }
})

test('bridge identity source/staleness/disable/rebuild/unavailability revoke and never fall back', async () => {
  for (const mode of [
    'wrong-source',
    'stale',
    'unavailable',
    'disabled',
    'rebuilt'
  ]) {
    const s = await fixture()
    try {
      const cookie = await s.login('A')
      if (mode === 'disabled') s.disable()
      else if (mode === 'rebuilt') s.rebuild()
      else s.setMode(mode)
      const response = await s.request('/api/files', {
        headers: { Cookie: cookie }
      })
      assert.equal(
        response.status,
        mode === 'disabled' || mode === 'rebuilt' ? 403 : 503
      )
      assert.equal(
        (await s.request('/api/me', { headers: { Cookie: cookie } })).status,
        401
      )
      assert.equal(s.reads(), 0)
    } finally {
      await s.close()
    }
  }
})

test('bridge rejects unbound headers, truncated/growing streams and synthetic production evidence', async () => {
  const s = await fixture()
  try {
    const cookie = await s.login('A'),
      id = fileId('designs', 'A.fig')
    for (const mode of ['wrong-principal', 'wrong-object']) {
      s.setMode(mode)
      assert.equal(
        (
          await s.request('/api/files/' + id + '/content', {
            headers: { Cookie: cookie }
          })
        ).status,
        409
      )
    }
    for (const mode of ['truncated', 'oversized']) {
      s.setMode(mode)
      const response = await s.request('/api/files/' + id + '/content', {
        headers: { Cookie: cookie }
      })
      if (response.status === 200) await assert.rejects(response.arrayBuffer())
      else assert.equal(response.status, 503)
    }
    s.setMode('normal')
    const deniedSynthetic = new NasBridge(
      s.bridgeConfig,
      'development',
      ['designs'],
      s.portal.index.identities,
      s.config.maxFileBytes
    )
    const production = new NasBridge(
      s.bridgeConfig,
      'production',
      ['designs'],
      s.portal.index.identities,
      s.config.maxFileBytes,
      true
    )
    assert.equal(await deniedSynthetic.ready(), false)
    assert.equal(await production.ready(), false)
    const mismatch = new NasBridge(
      { ...s.bridgeConfig, acceptanceSha256: 'b'.repeat(64) },
      'development',
      ['designs'],
      s.portal.index.identities,
      s.config.maxFileBytes,
      true
    )
    assert.equal(await mismatch.ready(), false)
    const controller = new AbortController()
    controller.abort()
    const client = (
      s.portal
        .authz as import('../../packages/authorization/index.ts').DsmStrictAuthorization
    ).bridge!
    await assert.rejects(
      client.open(
        {
          key: 'A',
          generation: 'synthetic-1',
          username: 'alice',
          email: 'alice@mock.example',
          enabled: true,
          trustedEmail: true,
          system: false,
          groups: []
        },
        s.portal.index.records.get(id)!,
        controller.signal
      ),
      /request-cancelled/
    )
  } finally {
    await s.close()
  }
})
