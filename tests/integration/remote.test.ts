import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Server } from 'node:http'
import { serve } from '@hono/node-server'
import { WebSocket, WebSocketServer } from 'ws'
import { once } from 'node:events'
import type { RemoteLease } from '../../apps/api/remote-sessions.ts'
import { attachRemoteStream } from '../../apps/api/remote-stream.ts'
import {
  createGoogleFixture,
  fixtureCode
} from '../helpers/google-mount-fixture.ts'
import { fileId } from '../../packages/filesystem/index.ts'

test('Google remote: source stays internal, WS binds owner/Origin, logout destroys display and profile lease', async (t) => {
  const logs: string[] = []
  t.mock.method(console, 'log', (value: unknown) => logs.push(String(value)))
  const base = realpathSync(mkdtempSync(resolve(tmpdir(), 'portal-remote-')))
  const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await once(upstream, 'listening')
  const address = upstream.address()
  assert.ok(address && typeof address !== 'string')
  const received: string[] = []
  upstream.on('connection', (connection) =>
    connection.on('message', (message) => received.push(message.toString()))
  )
  let active: RemoteLease | undefined,
    stopped = 0,
    encoderMode = 'cpu'
  const corePath = resolve(base, 'core.js')
  writeFileSync(corePath, '/* synthetic stream client */')
  const worker = {
    corePath,
    streamUrl: `http://127.0.0.1:${address.port}`,
    start: async (lease: RemoteLease) => {
      active = lease
      lease.encoderMode = encoderMode
      mkdirSync(base + '/remote/' + lease.id, { recursive: true })
    },
    stop: async () => {
      stopped++
      active = undefined
    }
  }
  const fixture = await createGoogleFixture(base, 3218, {
    viewerMode: 'selkies',
    remoteWorker: worker
  })
  const server = serve({
    fetch: fixture.portal.app.fetch,
    hostname: '127.0.0.1',
    port: 0
  }) as Server
  if (!server.listening) await once(server, 'listening')
  const publicAddress = server.address()
  assert.ok(publicAddress && typeof publicAddress !== 'string')
  fixture.config.origin = `http://127.0.0.1:${publicAddress.port}`
  attachRemoteStream(server, fixture.portal, fixture.config)
  const request = (path: string, init: RequestInit = {}) =>
    fixture.portal.app.request(fixture.config.origin + path, init)
  const login = async (account: string) => {
    const start = await request('/auth/google/start'),
      url = new URL(start.headers.get('location')!)
    const response = await request(
      '/auth/google/callback?' +
        new URLSearchParams({
          state: url.searchParams.get('state')!,
          code: fixtureCode(url, account)
        }),
      { headers: { Cookie: start.headers.getSetCookie()[0].split(';')[0] } }
    )
    const cookie = response.headers
      .getSetCookie()
      .find((c) => c.startsWith('portal='))!
      .split(';')[0]
    const me = await (
      await request('/api/me', { headers: { Cookie: cookie } })
    ).json()
    return { cookie, csrf: me.csrf }
  }
  let client: WebSocket | undefined
  try {
    const before = readFileSync(fixture.source + '/A.fig'),
      mtime = statSync(fixture.source + '/A.fig').mtimeMs
    const A = await login('A'),
      B = await login('B'),
      id = fileId('designs', 'A.fig')
    const headers = {
      Cookie: A.cookie,
      Origin: fixture.config.origin,
      'X-CSRF-Token': A.csrf
    }
    assert.equal(
      (
        await request(`/api/files/${id}/remote`, {
          method: 'POST',
          headers: { Origin: fixture.config.origin }
        })
      ).status,
      401
    )
    assert.equal(
      (
        await request(`/api/files/${id}/remote`, {
          method: 'POST',
          headers: { ...headers, 'X-CSRF-Token': 'wrong' }
        })
      ).status,
      403
    )
    const response = await request(`/api/files/${id}/remote`, {
      method: 'POST',
      headers
    })
    assert.equal(response.status, 200)
    const lease = await response.json(),
      streamCookie = response.headers.getSetCookie()[0].split(';')[0]
    assert.ok(active)
    const cookies = A.cookie + '; ' + streamCookie
    const clientAsset = lease.url + 'portal-client.js'
    assert.equal((await request(clientAsset)).status, 401)
    assert.equal(
      (
        await request(clientAsset, {
          headers: { Cookie: B.cookie + '; ' + streamCookie }
        })
      ).status,
      401
    )
    const bootstrap = await request(clientAsset, {
      headers: { Cookie: cookies }
    })
    assert.equal(bootstrap.status, 200)
    assert.match(await bootstrap.text(), /portalStreamReady/)
    const displayHeaders = {
      ...headers,
      Cookie: cookies,
      'Content-Type': 'application/json'
    }
    const changed = await request(`/api/remote/${lease.id}/display`, {
      method: 'POST',
      headers: displayHeaders,
      body: JSON.stringify({ width: 1200, height: 800, dpr: 2, uiScale: 1.5 })
    })
    assert.equal(changed.status, 200)
    assert.deepEqual((await changed.json()).display.width, 1620)
    assert.equal(
      (
        await request(`/api/remote/${lease.id}/display`, {
          method: 'POST',
          headers: displayHeaders,
          body: JSON.stringify({
            width: 1200,
            height: 800,
            dpr: 100,
            uiScale: 1.5
          })
        })
      ).status,
      400
    )
    assert.equal(
      (
        await request(`/api/remote/${lease.id}/display`, {
          method: 'POST',
          headers: { ...displayHeaders, 'X-CSRF-Token': 'wrong' },
          body: JSON.stringify({
            width: 1200,
            height: 800,
            dpr: 2,
            uiScale: 1.5
          })
        })
      ).status,
      403
    )
    assert.equal(
      (
        await request(`/api/files/${id}/remote`, {
          method: 'POST',
          headers: {
            Cookie: B.cookie,
            Origin: fixture.config.origin,
            'X-CSRF-Token': B.csrf
          }
        })
      ).status,
      429
    )
    for (const endpoint of ['scene', 'content'])
      assert.equal(
        (await request(`/api/files/${id}/${endpoint}`, { headers })).status,
        410
      )
    assert.equal(
      (await request(`/_remote/${active.ticket}/scene`, { headers })).status,
      404
    )
    assert.equal(
      (await request(`/_remote/${active.ticket}/display`, { headers })).status,
      404
    )
    assert.equal(
      (
        await (
          await fixture.portal.internalApp.request(
            `http://127.0.0.1/_remote/${active.ticket}/display`
          )
        ).json()
      ).display.uiScale,
      1.5
    )
    assert.equal(
      (
        await fixture.portal.internalApp.request(
          `http://127.0.0.1/_remote/${active.ticket}/scene`
        )
      ).status,
      200
    )
    assert.equal(
      (
        await fixture.portal.internalApp.request(
          'http://127.0.0.1/_remote/wrong/scene'
        )
      ).status,
      404
    )
    assert.equal(
      (
        await request(lease.url, {
          headers: { Cookie: B.cookie + '; ' + streamCookie }
        })
      ).status,
      401
    )
    assert.equal(
      (
        await request(lease.url + 'api/files/', {
          headers: { Cookie: cookies }
        })
      ).status,
      404
    )
    const wsUrl =
      fixture.config.origin.replace('http', 'ws') + lease.url + 'api/websockets'
    const rejected = new WebSocket(wsUrl, {
      origin: 'https://evil.example',
      headers: { Cookie: cookies }
    })
    await assert.rejects(once(rejected, 'open'))
    client = new WebSocket(wsUrl, {
      origin: fixture.config.origin,
      headers: { Cookie: cookies }
    })
    await once(client, 'open')
    client.send('cmd,cat /run/secrets/google-oauth.json')
    client.send('cw,document-data')
    client.send('kd,65507')
    client.send('kd,108')
    client.send('ku,65507')
    client.send('kd,97')
    client.send('r,7680x4320,primary')
    client.send('kd,32')
    await new Promise((r) => setTimeout(r, 100))
    assert.deepEqual(received, [
      '_stats,1',
      'kd,65507',
      'ku,65507',
      'kd,97',
      'r,1920x1080,primary',
      'kd,32'
    ])
    const closed = once(client, 'close')
    assert.equal(
      (await request('/auth/logout', { method: 'POST', headers })).status,
      200
    )
    await closed
    assert.equal(stopped, 1)
    assert.equal(fixture.portal.remote?.active, undefined)
    assert.equal(
      (await request(lease.url, { headers: { Cookie: cookies } })).status,
      401
    )
    assert.deepEqual(readFileSync(fixture.source + '/A.fig'), before)
    assert.equal(statSync(fixture.source + '/A.fig').mtimeMs, mtime)
    // Forced hardware must not silently transmit a software fallback stream.
    encoderMode = 'vaapi'
    const A2 = await login('A')
    const second = await request(`/api/files/${id}/remote`, {
      method: 'POST',
      headers: {
        Cookie: A2.cookie,
        Origin: fixture.config.origin,
        'X-CSRF-Token': A2.csrf
      }
    })
    assert.equal(second.status, 200)
    const secondLease = await second.json()
    client = new WebSocket(
      fixture.config.origin.replace('http', 'ws') +
        secondLease.url +
        'api/websockets',
      {
        origin: fixture.config.origin,
        headers: {
          Cookie:
            A2.cookie + '; ' + second.headers.getSetCookie()[0].split(';')[0]
        }
      }
    )
    await once(client, 'open')
    const binary: unknown[] = []
    client.on('message', (data, isBinary) => {
      if (isBinary) binary.push(data)
    })
    const hardwareClosed = once(client, 'close')
    const source = [...upstream.clients].at(-1)!
    source.send(Buffer.from('synthetic frame'))
    source.send(
      JSON.stringify({
        type: 'stream_info',
        info: { encoder: 'x264', hardware: false }
      })
    )
    await hardwareClosed
    assert.deepEqual(binary, [])
    assert.equal(stopped, 2)
    const reports = logs.map((line) => JSON.parse(line))
    assert.ok(
      reports.some(
        (report) =>
          report.event === 'remote-stream-rejected' &&
          report.stage === 'authorization' &&
          report.errorCode === 'origin-rejected'
      )
    )
    assert.equal(
      reports.filter((report) => report.event === 'remote-stream-connected')
        .length,
      2
    )
    assert.deepEqual(
      reports
        .filter((report) => report.event === 'remote-session-stop')
        .map((report) => report.reason),
      ['logout', 'forced-vaapi-fallback']
    )
    assert.equal(
      reports.filter((report) => report.event === 'remote-stream-closed')
        .length,
      2
    )
    for (const secret of [
      A.cookie.split('=')[1],
      streamCookie.split('=')[1],
      lease.credential,
      'document-data',
      '/run/secrets/google-oauth.json'
    ])
      if (secret) assert.equal(logs.join('\n').includes(secret), false)
  } finally {
    client?.terminate()
    await fixture.portal.remote?.close()
    fixture.close()
    await new Promise<void>((r) => server.close(() => r()))
    for (const connection of upstream.clients) connection.terminate()
    await new Promise<void>((r) => upstream.close(() => r()))
    rmSync(base, { recursive: true, force: true })
  }
})
