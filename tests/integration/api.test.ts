import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  statSync,
  symlinkSync,
  renameSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createPortal } from '../../apps/api/app.ts'
import { parseConfig } from '../../apps/api/config.ts'
import {
  MockAuthorization,
  DsmStrictAuthorization
} from '../../packages/authorization/index.ts'
import { fileId } from '../../packages/filesystem/index.ts'
const origin = 'http://127.0.0.1:3210'
async function setup() {
  const dir = realpathSync(mkdtempSync(resolve(tmpdir(), 'lan-portal-'))),
    source = dir + '/source'
  mkdirSync(source)
  for (const name of ['A.fig', 'B.fig', 'Shared.fig'])
    copyFileSync('tests/fixtures/basic.fig', source + '/' + name)
  const now = Date.now(),
    principals = ['A', 'B'].map((key) => ({
      key,
      generation: '1',
      username: key === 'A' ? 'alice' : 'bob',
      email: key === 'A' ? 'alice@mock.example' : 'bob@mock.example',
      enabled: true,
      trustedEmail: true,
      system: false,
      groups: []
    }))
  const snapshot = {
    version: 1,
    instanceId: 'nas',
    source: 'mock',
    observedAt: now,
    expiresAt: now + 60000,
    principals
  }
  writeFileSync(dir + '/directory.json', JSON.stringify(snapshot))
  const config = parseConfig({
    version: 1,
    mode: 'read-only',
    environment: 'development',
    origin,
    host: '127.0.0.1',
    port: 3210,
    identityProvider: 'mock',
    authorizationMode: 'mock',
    allowedHostedDomains: ['mock.example'],
    statePath: dir + '/state.sqlite',
    directoryPath: dir + '/directory.json',
    webPath: resolve('dist/web'),
    roots: [{ id: 'test', label: 'Fixture NAS', path: source }],
    maxFileBytes: 536870912,
    maxDownloads: 4,
    scanIntervalMs: 10000
  })
  const portal = createPortal(config)
  await portal.scan()
  const request = (path: string, init: RequestInit = {}) =>
    portal.app.request(origin + path, init)
  const login = async (account: string) => {
    const response = await request('/auth/mock', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ account })
    })
    assert.equal(response.status, 200)
    return response.headers.get('set-cookie')?.split(';')[0] ?? ''
  }
  const close = () => {
    portal.close()
    rmSync(dir, { recursive: true, force: true })
  }
  return { dir, source, config, portal, request, login, close, snapshot }
}
test('A/B list → native bytes, guessed IDs/HEAD/search/thumbnail denied, hashes untouched', async () => {
  const s = await setup()
  try {
    const before = ['A.fig', 'B.fig', 'Shared.fig'].map((name) => ({
      name,
      hash: createHash('sha256')
        .update(readFileSync(s.source + '/' + name))
        .digest('hex'),
      mtime: statSync(s.source + '/' + name).mtimeMs
    }))
    const A = await s.login('A'),
      B = await s.login('B')
    for (const [cookie, own, other] of [
      [A, 'A.fig', 'B.fig'],
      [B, 'B.fig', 'A.fig']
    ]) {
      const list = await (
        await s.request('/api/files', { headers: { Cookie: cookie } })
      ).json()
      assert.deepEqual(
        list.items.map((f: { name: string }) => f.name),
        [own, 'Shared.fig']
      )
      assert.equal(list.total, 2)
      const secret = fileId('test', other)
      for (const path of [
        '/api/files/' + secret,
        '/api/files/' + secret + '/content',
        '/api/files/' + secret + '/thumbnail'
      ]) {
        const response = await s.request(path, { headers: { Cookie: cookie } })
        assert.equal(response.status, 404)
        assert.ok(!(await response.text()).includes(other))
        const head = await s.request(path, {
          method: 'HEAD',
          headers: { Cookie: cookie }
        })
        assert.equal(head.status, 404)
      }
      const search = await (
        await s.request('/api/search?q=' + other, {
          headers: { Cookie: cookie }
        })
      ).json()
      assert.equal(search.total, 0)
      assert.deepEqual(search.items, [])
      const content = await s.request(
        '/api/files/' + fileId('test', own) + '/content',
        { headers: { Cookie: cookie } }
      )
      assert.equal(content.status, 200)
      assert.deepEqual(
        Buffer.from(await content.arrayBuffer()),
        readFileSync(s.source + '/' + own)
      )
      for (const method of ['PUT', 'PATCH', 'DELETE', 'POST'])
        assert.equal(
          (
            await s.request('/api/files/' + fileId('test', own) + '/content', {
              method,
              headers: { Cookie: cookie }
            })
          ).status,
          404
        )
    }
    for (const item of before) {
      assert.equal(
        createHash('sha256')
          .update(readFileSync(s.source + '/' + item.name))
          .digest('hex'),
        item.hash
      )
      assert.equal(statSync(s.source + '/' + item.name).mtimeMs, item.mtime)
    }
  } finally {
    s.close()
  }
})
test('revoke, disabled/lifecycle change/stale directory fail closed and logout needs Origin + CSRF', async () => {
  const s = await setup()
  try {
    const cookie = await s.login('A')
    const me = await (
      await s.request('/api/me', { headers: { Cookie: cookie } })
    ).json()
    assert.equal(
      (
        await s.request('/auth/logout', {
          method: 'POST',
          headers: { Cookie: cookie, Origin: origin }
        })
      ).status,
      403
    )
    assert.equal(
      (
        await s.request('/auth/logout', {
          method: 'POST',
          headers: {
            Cookie: cookie,
            Origin: 'https://evil.example',
            'X-CSRF-Token': me.csrf
          }
        })
      ).status,
      403
    )
    s.snapshot.principals[0].generation = 'rebuilt'
    writeFileSync(s.dir + '/directory.json', JSON.stringify(s.snapshot))
    assert.equal(
      (await s.request('/api/files', { headers: { Cookie: cookie } })).status,
      403
    )
    assert.equal(
      (await s.request('/api/me', { headers: { Cookie: cookie } })).status,
      401
    )
  } finally {
    s.close()
  }
})
test('source offline keeps index; source replacements/symlinks cannot serve bytes; uniform readiness failure', async () => {
  const s = await setup()
  try {
    const cookie = await s.login('A'),
      id = fileId('test', 'A.fig')
    renameSync(s.source + '/A.fig', s.source + '/original')
    symlinkSync(s.source + '/original', s.source + '/A.fig')
    assert.notEqual(
      (
        await s.request('/api/files/' + id + '/content', {
          headers: { Cookie: cookie }
        })
      ).status,
      200
    )
    renameSync(s.source, s.source + '-offline')
    await s.portal.scan()
    assert.ok(s.portal.index.records.has(id))
    assert.equal(s.portal.index.online.get('test'), false)
    for (const guess of [id, '0'.repeat(32)])
      assert.equal(
        (
          await s.request('/api/files/' + guess, {
            headers: { Cookie: cookie }
          })
        ).status,
        503
      )
    assert.equal((await s.request('/health/ready')).status, 503)
    mkdirSync(s.source)
    await s.portal.scan()
    assert.equal(s.portal.index.online.get('test'), false)
  } finally {
    s.close()
  }
})
test('dsm-strict stub cannot downgrade to mock or service UID permissions', async () => {
  const s = await setup()
  s.portal.close()
  const strict = createPortal(
    { ...s.config, authorizationMode: 'dsm-strict' },
    { authorization: new DsmStrictAuthorization() }
  )
  try {
    await strict.scan()
    assert.equal(
      (await strict.app.request(origin + '/health/ready')).status,
      503
    )
    const response = await strict.app.request(origin + '/auth/mock', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: '{"account":"A"}'
    })
    const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? ''
    for (const path of [
      '/api/files',
      '/api/files/' + fileId('test', 'A.fig') + '/content'
    ])
      assert.equal(
        (
          await strict.app.request(origin + path, {
            headers: { Cookie: cookie }
          })
        ).status,
        503
      )
  } finally {
    strict.close()
    rmSync(s.dir, { recursive: true, force: true })
  }
})
test('new ACL requests cannot reuse previously authorized content', async () => {
  const s = await setup()
  try {
    const cookie = await s.login('A'),
      authz = s.portal.authz as MockAuthorization
    authz.grants.get('A')?.delete('test/A.fig')
    for (const method of ['GET', 'HEAD'])
      assert.equal(
        (
          await s.request(
            '/api/files/' + fileId('test', 'A.fig') + '/content',
            { method, headers: { Cookie: cookie } }
          )
        ).status,
        404
      )
  } finally {
    s.close()
  }
})
test('ancestor denial and identical paths in another root never reuse a file grant', async () => {
  const s = await setup()
  s.portal.close()
  mkdirSync(s.source + '/Denied')
  copyFileSync('tests/fixtures/basic.fig', s.source + '/Denied/Hidden.fig')
  const second = s.dir + '/second'
  mkdirSync(second)
  copyFileSync('tests/fixtures/basic.fig', second + '/A.fig')
  const authz = new MockAuthorization(
    new Map([
      [
        'A',
        new Set(['test/', 'test/A.fig', 'test/Denied/Hidden.fig', 'second/'])
      ]
    ])
  )
  const portal = createPortal(
    {
      ...s.config,
      roots: [
        ...s.config.roots,
        { id: 'second', path: second, label: 'Other root' }
      ]
    },
    { authorization: authz }
  )
  try {
    await portal.scan()
    const response = await portal.app.request(origin + '/auth/mock', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: '{"account":"A"}'
      }),
      cookie = response.headers.get('set-cookie')?.split(';')[0] ?? ''
    const search = await (
      await portal.app.request(origin + '/api/search', {
        headers: { Cookie: cookie }
      })
    ).json()
    assert.deepEqual(
      search.items.map((f: { relative: string }) => f.relative),
      ['A.fig']
    )
    assert.equal(search.total, 1)
    for (const id of [
      fileId('test', 'Denied/Hidden.fig'),
      fileId('second', 'A.fig')
    ])
      for (const endpoint of ['', '/content', '/thumbnail'])
        for (const method of ['GET', 'HEAD'])
          assert.equal(
            (
              await portal.app.request(origin + '/api/files/' + id + endpoint, {
                method,
                headers: { Cookie: cookie }
              })
            ).status,
            404
          )
  } finally {
    portal.close()
    rmSync(s.dir, { recursive: true, force: true })
  }
})
