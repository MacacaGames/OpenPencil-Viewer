import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  readFileSync,
  statSync,
  symlinkSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { digest } from '../../apps/api/state.ts'
import { createPortal } from '../../apps/api/app.ts'
import { fileId } from '../../packages/filesystem/index.ts'
import { decodeScene, SCENE_TYPE } from '../../packages/transport/scene-wire.ts'
import {
  createGoogleFixture,
  fixtureCode
} from '../helpers/google-mount-fixture.ts'

test('Google-only shared mount: signed callback, all roots/FIGs, no directory/bindings, readonly boundaries and revocation', async () => {
  const base = realpathSync(mkdtempSync(resolve(tmpdir(), 'shared-mount-')))
  const s = await createGoogleFixture(base)
  const request = (path: string, init: RequestInit = {}) =>
    s.portal.app.request(s.config.origin + path, init)
  const login = async (
    account: string,
    patch: Record<string, unknown> = {}
  ) => {
    const start = await request('/auth/google/start')
    const url = new URL(start.headers.get('location')!)
    const proof = start.headers.get('set-cookie')!.split(';')[0]
    const response = await request(
      '/auth/google/callback?' +
        new URLSearchParams({
          state: url.searchParams.get('state')!,
          code: fixtureCode(url, account, patch)
        }),
      { headers: { Cookie: proof } }
    )
    return {
      response,
      cookie:
        response.headers
          .getSetCookie()
          .find((c) => c.startsWith('portal='))
          ?.split(';')[0] ?? ''
    }
  }
  try {
    assert.equal(s.config.directoryPath, undefined)
    assert.equal((await request('/health/ready')).status, 200)
    const id = fileId('designs', 'A.fig'),
      path = '/api/files/' + id + '/content'
    for (const endpoint of [
      '/api/me',
      '/api/roots',
      '/api/files',
      '/api/search',
      path
    ])
      assert.equal((await request(endpoint)).status, 401)
    assert.equal((await request(path, { method: 'HEAD' })).status, 401)
    assert.equal(
      (
        await request('/auth/mock', {
          method: 'POST',
          headers: { Origin: s.config.origin }
        })
      ).status,
      404
    )
    for (const patch of [
      { hd: 'foreign.example' },
      { email_verified: false },
      { nonce: 'wrong' },
      { aud: 'wrong' }
    ])
      assert.equal((await login('A', patch)).response.status, 403)
    const A = await login('A'),
      B = await login('B')
    assert.equal(A.response.status, 302)
    assert.equal(B.response.status, 302)
    const before = readFileSync(s.source + '/A.fig'),
      mtime = statSync(s.source + '/A.fig').mtimeMs
    symlinkSync(s.secondary + '/Second.fig', s.source + '/escape.fig')
    await s.portal.scan()
    for (const cookie of [A.cookie, B.cookie]) {
      const headers = { Cookie: cookie }
      const scene = await request('/api/files/' + id + '/scene', { headers })
      assert.equal(scene.status, 200)
      assert.equal(scene.headers.get('Content-Type'), SCENE_TYPE)
      assert.equal(
        scene.headers.get('X-Scene-Cache'),
        cookie === A.cookie ? 'miss' : 'hit'
      )
      const decoded = decodeScene(
        new Uint8Array(await scene.arrayBuffer())
      ) as {
        graph: {
          nodes: Array<[string, { type: string }]>
          figSchemaDeflated: null
          lazyFigImport?: unknown
        }
      }
      assert.equal(
        decoded.graph.nodes.filter(([, n]) => n.type === 'CANVAS').length,
        2
      )
      assert.equal(decoded.graph.figSchemaDeflated, null)
      assert.equal(decoded.graph.lazyFigImport, undefined)
      const roots = await (await request('/api/roots', { headers })).json()
      assert.equal(roots.items.length, 2)
      const all = await (await request('/api/search', { headers })).json()
      assert.deepEqual(
        all.items
          .filter((r: { kind: string }) => r.kind === 'file')
          .map((r: { name: string }) => r.name)
          .sort(),
        ['A.fig', 'B.fig', 'Nested.fig', 'Second.fig']
      )
      assert.equal(
        (await request(path, { method: 'HEAD', headers })).status,
        200
      )
      assert.deepEqual(
        Buffer.from(await (await request(path, { headers })).arrayBuffer()),
        before
      )
      assert.equal(
        (
          await request(
            '/api/files/' + fileId('designs', 'escape.fig') + '/content',
            { headers }
          )
        ).status,
        404
      )
      for (const method of ['PUT', 'PATCH', 'DELETE', 'POST'])
        assert.equal((await request(path, { method, headers })).status, 404)
    }
    assert.equal(
      s.portal.state.db.prepare('SELECT count(*) AS n FROM bindings').get()?.n,
      0
    )
    assert.deepEqual(readFileSync(s.source + '/A.fig'), before)
    assert.equal(statSync(s.source + '/A.fig').mtimeMs, mtime)
    const me = await (
      await request('/api/me', { headers: { Cookie: A.cookie } })
    ).json()
    assert.equal(me.authorization, 'google-mount')
    assert.equal(
      (
        await request('/auth/logout', {
          method: 'POST',
          headers: {
            Origin: s.config.origin,
            Cookie: A.cookie,
            'X-CSRF-Token': me.csrf
          }
        })
      ).status,
      200
    )
    assert.equal(
      (await request(path, { headers: { Cookie: A.cookie } })).status,
      401
    )
    assert.equal(
      (
        await request('/api/files/' + id + '/scene', {
          headers: { Cookie: A.cookie }
        })
      ).status,
      401
    )
    // Changing allowed Workspace domains revokes an existing shared session.
    s.config.allowedHostedDomains = ['other.example']
    assert.equal(
      (await request(path, { headers: { Cookie: B.cookie } })).status,
      403
    )
    assert.equal(
      (
        await request('/api/files/' + id + '/scene', {
          headers: { Cookie: B.cookie }
        })
      ).status,
      401
    )
    const row = s.portal.state.db
      .prepare('SELECT count(*) AS n FROM sessions')
      .get()
    assert.equal(row?.n, 0)
  } finally {
    s.close()
    rmSync(base, { recursive: true, force: true })
  }
})

test('production never serves original FIG, scene cache cannot bypass changed-source validation', async () => {
  const base = realpathSync(mkdtempSync(resolve(tmpdir(), 'production-scene-')))
  const s = await createGoogleFixture(base)
  const identity = {
    iss: 'https://accounts.google.com',
    sub: 'synthetic',
    email: 'a@fixture.example',
    hd: 'fixture.example'
  }
  const token = s.portal.state.createGoogleMountSession(identity, {
    key: 'google:' + digest(identity.iss + '\0' + identity.sub),
    generation: 'google-mount-v1',
    username: identity.email,
    email: identity.email,
    enabled: true,
    trustedEmail: true,
    system: false,
    groups: []
  })
  s.close()
  const portal = createPortal({
    ...s.config,
    environment: 'production',
    origin: 'https://fixture.example'
  })
  try {
    await portal.scan()
    const url =
      'https://fixture.example/api/files/' + fileId('designs', 'A.fig')
    const headers = { Cookie: '__Host-portal=' + token }
    for (const method of ['GET', 'HEAD'])
      assert.equal(
        (await portal.app.request(url + '/content', { method, headers }))
          .status,
        410
      )
    assert.equal((await portal.app.request(url + '/scene')).status, 401)
    assert.equal(
      (await portal.app.request(url + '/scene', { headers })).status,
      410
    )
    const metadata = await (await portal.app.request(url, { headers })).json()
    const manifestPath =
      url + '/viewer?revision=' + encodeURIComponent(metadata.revision)
    assert.equal((await portal.app.request(manifestPath)).status, 401)
    const response = await portal.app.request(manifestPath, { headers })
    assert.equal(response.status, 200)
    const manifest = await response.json()
    assert.equal(manifest.pages.length, 2)
    assert.ok(JSON.stringify(manifest).length < 2048)
    const viewPath =
      url +
      '/viewport?' +
      new URLSearchParams({
        revision: metadata.revision,
        page: manifest.pages[0].id,
        x: '0',
        y: '0',
        scale: '1',
        width: '1024',
        height: '768'
      })
    const image = await portal.app.request(viewPath, { headers })
    assert.equal(image.status, 200)
    assert.equal(image.headers.get('Content-Type'), 'image/webp')
    assert.ok((await image.arrayBuffer()).byteLength < 65536)
    assert.equal(
      (await portal.app.request(viewPath, { headers })).headers.get(
        'X-Viewer-Cache'
      ),
      'hit'
    )
    assert.equal(
      (
        await portal.app.request(
          viewPath.replace('width=1024', 'width=100000'),
          { headers }
        )
      ).status,
      400
    )
    assert.equal(
      (
        await portal.app.request(
          viewPath.replace(
            'page=' + encodeURIComponent(manifest.pages[0].id),
            'page=not-a-page'
          ),
          { headers }
        )
      ).status,
      404
    )
    // FileIndex's descriptor/revision validation still runs on a cache hit.
    const { writeFileSync } = await import('node:fs')
    writeFileSync(s.source + '/A.fig', 'changed synthetic document')
    assert.equal((await portal.app.request(viewPath, { headers })).status, 503)
  } finally {
    portal.close()
    s.close()
    rmSync(base, { recursive: true, force: true })
  }
})

test('shared session cannot survive switching to strict mode, and synthetic keys reject production', async () => {
  const base = realpathSync(mkdtempSync(resolve(tmpdir(), 'shared-profile-')))
  const s = await createGoogleFixture(base)
  try {
    assert.throws(
      () =>
        createPortal(
          { ...s.config, environment: 'production' },
          { googleTokenKeys: s.keys }
        ),
      /loopback development only/
    )
    const identity = {
      iss: 'https://accounts.google.com',
      sub: 'synthetic',
      email: 'a@fixture.example',
      hd: 'fixture.example'
    }
    const token = s.portal.state.createGoogleMountSession(identity, {
      key: 'test',
      generation: 'google-mount-v1',
      username: identity.email,
      email: identity.email,
      enabled: true,
      trustedEmail: true,
      system: false,
      groups: []
    })
    s.close()
    const strict = createPortal({
      ...s.config,
      authorizationMode: 'dsm-strict',
      directoryPath: base + '/missing.json'
    })
    try {
      assert.equal(
        (
          await strict.app.request(s.config.origin + '/api/me', {
            headers: { Cookie: 'portal=' + token }
          })
        ).status,
        401
      )
      assert.equal(
        (await strict.app.request(s.config.origin + '/health/ready')).status,
        503
      )
    } finally {
      strict.close()
    }
  } finally {
    // Already closed above; restoring fixture fetch does not close SQLite again.
    s.close()
    rmSync(base, { recursive: true, force: true })
  }
})
