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
import { createPortal } from '../../apps/api/app.ts'
import { fileId } from '../../packages/filesystem/index.ts'
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
    // Changing allowed Workspace domains revokes an existing shared session.
    s.config.allowedHostedDomains = ['other.example']
    assert.equal(
      (await request(path, { headers: { Cookie: B.cookie } })).status,
      403
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
