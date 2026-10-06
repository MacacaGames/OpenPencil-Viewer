import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  createGoogleFixture,
  fixtureCode
} from '../helpers/google-mount-fixture.ts'
import { fileId } from '../../packages/filesystem/index.ts'

test('Authenticated blank warmup exposes only aggregate capacity and preserves the same source through mode changes', async () => {
  const base = realpathSync(
    mkdtempSync(resolve(tmpdir(), 'portal-remote-warm-'))
  )
  let starts = 0,
    reloads = 0
  const fixture = await createGoogleFixture(base, 3218, {
    viewerMode: 'selkies',
    maxSessions: 32,
    remoteWorker: () => ({
      corePath: '/unused',
      streamUrl: 'http://127.0.0.1:8086',
      start: async () => {
        starts++
      },
      reload: async () => {
        reloads++
      },
      stop: async () => undefined
    })
  })
  const request = (path: string, init: RequestInit = {}) =>
    fixture.portal.app.request(fixture.config.origin + path, init)
  const login = async (account: string) => {
    const start = await request('/auth/google/start'),
      url = new URL(start.headers.get('location')!)
    const callback = await request(
      '/auth/google/callback?' +
        new URLSearchParams({
          state: url.searchParams.get('state')!,
          code: fixtureCode(url, account)
        }),
      { headers: { Cookie: start.headers.getSetCookie()[0].split(';')[0] } }
    )
    const cookie = callback.headers
      .getSetCookie()
      .find((c) => c.startsWith('portal='))!
      .split(';')[0]
    const me = await (
      await request('/api/me', { headers: { Cookie: cookie } })
    ).json()
    return { cookie, csrf: me.csrf }
  }
  try {
    const A = await login('A'),
      B = await login('B'),
      tab = '12345678-1234-1234-1234-123456789abc'
    const headers = {
      Cookie: A.cookie,
      Origin: fixture.config.origin,
      'X-CSRF-Token': A.csrf,
      'Content-Type': 'application/json'
    }
    const body = (sequence: number, patch = {}) =>
      JSON.stringify({
        width: 1280,
        height: 720,
        dpr: 1,
        uiScale: 1.25,
        request: sequence,
        ...patch
      })
    const status = async (cookie = A.cookie) =>
      (
        await request('/api/remote/status', { headers: { Cookie: cookie } })
      ).json()
    const warm = (sequence: number) =>
      request(`/api/remote-tab/${tab}/warm`, {
        method: 'POST',
        headers,
        body: body(sequence)
      })
    assert.equal((await request('/api/remote/status')).status, 401)
    assert.deepEqual(await status(), {
      used: 0,
      limit: 32,
      account: { used: 0, limit: 4 }
    })
    for (const [patch, expected] of [
      [{ Cookie: '' }, 401],
      [{ 'X-CSRF-Token': 'wrong' }, 403],
      [{ Origin: 'https://foreign.invalid' }, 403]
    ] as const)
      assert.equal(
        (
          await request(`/api/remote-tab/${tab}/warm`, {
            method: 'POST',
            headers: { ...headers, ...patch },
            body: body(1)
          })
        ).status,
        expected
      )
    assert.equal(
      (
        await request('/api/remote-tab/bad/warm', {
          method: 'POST',
          headers,
          body: body(1)
        })
      ).status,
      400
    )
    assert.equal(
      (
        await request(`/api/remote-tab/${tab}/warm`, {
          method: 'POST',
          headers,
          body: body(0)
        })
      ).status,
      400
    )
    assert.equal(
      (
        await request(`/api/remote-tab/${tab}/warm`, {
          method: 'POST',
          headers,
          body: body(1, { width: 9000 })
        })
      ).status,
      400
    )
    const warmed = await warm(1)
    assert.equal(warmed.status, 200)
    const blank = await warmed.json(),
      lease = fixture.portal.remote!.leases[0]
    assert.equal(lease.file, undefined)
    assert.deepEqual(await status(B.cookie), {
      used: 1,
      limit: 32,
      account: { used: 0, limit: 4 }
    })
    const metadata = await fixture.portal.internalApp.request(
      '/_remote/' + lease.ticket + '/metadata'
    )
    assert.equal((await metadata.json()).empty, true)
    assert.equal(
      (
        await fixture.portal.internalApp.request(
          '/_remote/' + lease.ticket + '/scene'
        )
      ).status,
      404
    )
    assert.equal(
      (await request('/_remote/' + lease.ticket + '/metadata')).status,
      404
    )
    const streamCookie = warmed.headers.getSetCookie()[0].split(';')[0]
    assert.equal(
      (
        await request(blank.url, {
          headers: { Cookie: A.cookie + '; ' + streamCookie }
        })
      ).status,
      401
    )
    assert.equal(
      (
        await request(`/api/remote/${blank.id}/renew`, {
          method: 'POST',
          headers: { ...headers, Cookie: A.cookie + '; ' + streamCookie }
        })
      ).status,
      200
    )
    const open = (sequence: number) =>
      request(`/api/files/${fileId('designs', 'A.fig')}/remote`, {
        method: 'POST',
        headers,
        body: body(sequence, { tab })
      })
    const opened = await open(2)
    assert.equal(opened.status, 200)
    assert.equal((await opened.json()).id, blank.id)
    assert.equal(lease.generation, 2)
    assert.equal(lease.parked, false)
    assert.equal((await warm(3)).status, 200)
    assert.equal(fixture.portal.remote!.leases[0].file?.name, 'A.fig')
    assert.equal(lease.parked, true)
    assert.equal((await open(4)).status, 200)
    assert.equal(lease.generation, 2)
    assert.deepEqual([starts, reloads], [1, 1])
    assert.equal(
      (
        await request(`/api/remote-tab/${tab}/stop`, {
          method: 'POST',
          headers: { ...headers, Cookie: B.cookie, 'X-CSRF-Token': B.csrf },
          body: JSON.stringify({ request: 4 })
        })
      ).status,
      200
    )
    assert.deepEqual(await status(), {
      used: 1,
      limit: 32,
      account: { used: 1, limit: 4 }
    })
    assert.equal(
      (await request('/auth/logout', { method: 'POST', headers })).status,
      200
    )
    assert.deepEqual(await status(B.cookie), {
      used: 0,
      limit: 32,
      account: { used: 0, limit: 4 }
    })
  } finally {
    await fixture.portal.remote?.close()
    fixture.close()
    rmSync(base, { recursive: true, force: true })
  }
})
