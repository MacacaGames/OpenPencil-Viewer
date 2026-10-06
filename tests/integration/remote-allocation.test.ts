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

test('Verified subject quota spans separate logins; authorized requests reclaim only eligible blank prewarms', async (t) => {
  const initial = Date.now()
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: initial })
  const base = realpathSync(
    mkdtempSync(resolve(tmpdir(), 'portal-account-quota-'))
  )
  const fixture = await createGoogleFixture(base, 3219, {
    viewerMode: 'selkies',
    maxSessions: 4,
    maxSessionsPerAccount: 2,
    remoteWorker: () => ({
      corePath: '/unused',
      streamUrl: 'http://127.0.0.1:8086',
      start: async () => undefined,
      reload: async () => undefined,
      stop: async () => undefined
    })
  })
  const request = (path: string, init: RequestInit = {}) =>
    fixture.portal.app.request(fixture.config.origin + path, init)
  const login = async (account: string, patch = {}) => {
    const start = await request('/auth/google/start'),
      url = new URL(start.headers.get('location')!)
    const callback = await request(
      '/auth/google/callback?' +
        new URLSearchParams({
          state: url.searchParams.get('state')!,
          code: fixtureCode(url, account, patch)
        }),
      { headers: { Cookie: start.headers.getSetCookie()[0].split(';')[0] } }
    )
    assert.equal(callback.status, 302)
    const cookie = callback.headers
      .getSetCookie()
      .find((c) => c.startsWith('portal='))!
      .split(';')[0]
    const me = await (
      await request('/api/me', { headers: { Cookie: cookie } })
    ).json()
    return {
      cookie,
      headers: {
        Cookie: cookie,
        Origin: fixture.config.origin,
        'X-CSRF-Token': me.csrf,
        'Content-Type': 'application/json'
      }
    }
  }
  const tab = (n: number) =>
    `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
  const body = (sequence = 1, patch = {}) =>
    JSON.stringify({
      width: 1280,
      height: 720,
      dpr: 1,
      uiScale: 1.25,
      request: sequence,
      ...patch
    })
  const status = async (who: Awaited<ReturnType<typeof login>>) =>
    (
      await request('/api/remote/status', { headers: { Cookie: who.cookie } })
    ).json()
  const warm = (
    who: Awaited<ReturnType<typeof login>>,
    n: number,
    sequence = 1
  ) =>
    request(`/api/remote-tab/${tab(n)}/warm`, {
      method: 'POST',
      headers: who.headers,
      body: body(sequence)
    })
  const open = (
    who: Awaited<ReturnType<typeof login>>,
    n: number,
    sequence = 1
  ) =>
    request(`/api/files/${fileId('designs', 'A.fig')}/remote`, {
      method: 'POST',
      headers: who.headers,
      body: body(sequence, { tab: tab(n) })
    })
  try {
    const A1 = await login('A'),
      A2 = await login('A', { iss: 'accounts.google.com' }),
      B = await login('B'),
      sameEmail = await login('C', { email: 'a@fixture.example' })
    const loaded = await open(A1, 1),
      loadedId = (await loaded.json()).id
    assert.equal(loaded.status, 200)
    const blank = await warm(A2, 2),
      blankId = (await blank.json()).id
    assert.equal(blank.status, 200)
    const rejected = await warm(A2, 3)
    assert.equal(rejected.status, 429)
    assert.deepEqual(await rejected.json(), { error: 'remote-account-limit' })
    assert.deepEqual(await status(A1), {
      used: 2,
      limit: 4,
      account: { used: 2, limit: 2 }
    })
    const bWarm = await warm(B, 4),
      bId = (await bWarm.json()).id
    assert.equal(bWarm.status, 200)
    assert.equal((await warm(sameEmail, 5)).status, 200) // Email equality does not merge quotas.
    assert.deepEqual(await status(B), {
      used: 4,
      limit: 4,
      account: { used: 1, limit: 2 }
    })
    const spoofed = await request(`/api/remote-tab/${tab(6)}/warm`, {
      method: 'POST',
      headers: A2.headers,
      body: body(1, { account: 'B' })
    })
    assert.equal(spoofed.status, 429)
    assert.equal((await spoofed.json()).error, 'remote-account-limit')
    t.mock.timers.setTime(initial + 60001)
    const renewed = await request(`/api/remote/${blankId}/renew`, {
      method: 'POST',
      headers: {
        ...A2.headers,
        Cookie: A2.cookie + '; ' + blank.headers.getSetCookie()[0].split(';')[0]
      }
    })
    assert.equal(renewed.status, 200)
    const replacement = await open(A2, 3, 2)
    assert.equal(replacement.status, 200)
    assert.equal(
      fixture.portal.remote!.leases.some((lease) => lease.id === blankId),
      false
    )
    assert.equal(
      fixture.portal.remote!.leases.some((lease) => lease.id === loadedId),
      true
    )
    assert.equal(
      fixture.portal.remote!.leases.some((lease) => lease.id === bId),
      true
    )
    const denied = await request(`/api/remote/${blankId}/renew`, {
      method: 'POST',
      headers: {
        ...A2.headers,
        Cookie: A2.cookie + '; ' + blank.headers.getSetCookie()[0].split(';')[0]
      }
    })
    assert.equal(denied.status, 401)
    assert.equal((await warm(A1, 1, 2)).status, 200) // Parking a loaded graph retains it.
    const stillFull = await warm(A2, 7)
    assert.equal(stillFull.status, 429)
    assert.equal((await stillFull.json()).error, 'remote-account-limit')
    assert.equal(
      fixture.portal.remote!.leases.some((lease) => lease.id === bId),
      true
    )
    assert.equal((await open(A1, 1, 3)).status, 200) // Existing lease works at both limits.
    const C = await login('D')
    assert.equal((await open(C, 8)).status, 200) // Global pressure reclaims another account's oldest blank.
    assert.equal(
      fixture.portal.remote!.leases.some((lease) => lease.id === bId),
      false
    )
    assert.equal(
      (await request('/auth/logout', { method: 'POST', headers: A1.headers }))
        .status,
      200
    )
    assert.equal((await status(A2)).account.used, 1) // Logout only removes this login's lease.
  } finally {
    await fixture.portal.remote?.close()
    fixture.close()
    rmSync(base, { recursive: true, force: true })
  }
})
