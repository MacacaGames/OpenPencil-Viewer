import test, { type TestContext } from 'node:test'
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
import { EventEmitter, once } from 'node:events'
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
    maxSessions: 1,
    remoteWorker: () => worker
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
    assert.equal(fixture.portal.remote?.leases.length, 0)
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

for (const firstUser of [0, 1]) {
  test(
    `Two simultaneous remote users get isolated streams, shared cold parsing, independent logout and per-owner authorization (${firstUser === 0 ? 'A' : 'B'} reserves first)`,
    { timeout: 15000 },
    (t) => testConcurrentSessions(t, firstUser)
  )
}

async function testConcurrentSessions(t: TestContext, firstUser: number) {
  const base = realpathSync(mkdtempSync(resolve(tmpdir(), 'portal-multiuser-')))
  const sources = await Promise.all(
    [0, 1].map(async () => {
      const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
      await once(server, 'listening')
      const address = server.address()
      assert.ok(address && typeof address !== 'string')
      const received: string[] = []
      const packets = new EventEmitter()
      server.on('connection', (socket) =>
        socket.on('message', (message) => {
          received.push(message.toString())
          packets.emit('message')
        })
      )
      const waitFor = async (message: string) => {
        const signal = AbortSignal.timeout(5000)
        while (!received.includes(message))
          await once(packets, 'message', { signal })
      }
      return {
        server,
        received,
        waitFor,
        url: `http://127.0.0.1:${address.port}`
      }
    })
  )
  const corePath = resolve(base, 'core.js')
  writeFileSync(corePath, '/* synthetic */')
  const stopped: number[] = []
  const fixture = await createGoogleFixture(base, 3218, {
    viewerMode: 'selkies',
    maxSessions: 2,
    remoteWorker: (slot) => ({
      corePath,
      streamUrl: sources[slot].url,
      start: async (lease) => {
        mkdirSync(base + '/remote/' + lease.id, { recursive: true })
      },
      stop: async () => {
        stopped.push(slot)
      }
    })
  })
  const server = serve({
    fetch: fixture.portal.app.fetch,
    hostname: '127.0.0.1',
    port: 0
  }) as Server
  if (!server.listening) await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  fixture.config.origin = `http://127.0.0.1:${address.port}`
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
      .find((value) => value.startsWith('portal='))!
      .split(';')[0]
    const me = await (
      await request('/api/me', { headers: { Cookie: cookie } })
    ).json()
    return {
      Cookie: cookie,
      Origin: fixture.config.origin,
      'X-CSRF-Token': me.csrf
    }
  }
  const clients: WebSocket[] = []
  try {
    const headers = await Promise.all(['A', 'B'].map(login))
    // Exercise both reservation orders while responses still follow A/B order.
    const remote = fixture.portal.remote!
    const create = remote.create.bind(remote)
    let releaseFirst!: () => void
    const reservedFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const firstCookie = headers[firstUser].Cookie.slice('portal='.length)
    t.mock.method(
      remote,
      'create',
      async (...args: Parameters<typeof create>) => {
        if (args[1] !== firstCookie) await reservedFirst
        const pending = create(...args)
        if (args[1] === firstCookie) releaseFirst()
        return pending
      }
    )
    const responses = await Promise.all(
      headers.map((headers) =>
        request(`/api/files/${fileId('designs', 'A.fig')}/remote`, {
          method: 'POST',
          headers
        })
      )
    )
    assert.deepEqual(
      responses.map((response) => response.status),
      [200, 200]
    )
    const leases = await Promise.all(
      responses.map((response) => response.json())
    )
    const cookies = headers.map(
      (value, index) =>
        value.Cookie +
        '; ' +
        responses[index].headers.getSetCookie()[0].split(';')[0]
    )
    assert.equal(fixture.portal.remote!.leases.length, 2)
    const sessions = leases.map(({ id }) => {
      const session = remote.leases.find((lease) => lease.id === id)
      assert.ok(session)
      return session
    })
    assert.deepEqual(
      sessions.map((lease) => lease.slot),
      firstUser === 0 ? [0, 1] : [1, 0]
    )
    const streams = sessions.map((lease) => sources[lease.slot])
    const tickets = sessions.map((lease) => lease.ticket)
    const scenes = await Promise.all(
      tickets.map((ticket) =>
        fixture.portal.internalApp.request(
          `http://127.0.0.1/_remote/${ticket}/scene`
        )
      )
    )
    assert.deepEqual(
      scenes.map((response) => response.status),
      [200, 200]
    )
    assert.deepEqual(
      new Uint8Array(await scenes[0].arrayBuffer()),
      new Uint8Array(await scenes[1].arrayBuffer())
    )
    assert.equal(
      (await request(leases[0].url, { headers: { Cookie: cookies[1] } }))
        .status,
      401
    )
    for (let index = 0; index < 2; index++) {
      const client = new WebSocket(
        fixture.config.origin.replace('http', 'ws') +
          leases[index].url +
          'api/websockets',
        {
          origin: fixture.config.origin,
          headers: { Cookie: cookies[index] }
        }
      )
      clients.push(client)
      await once(client, 'open')
    }
    clients[0].send('kd,32')
    clients[1].send('kd,49')
    await Promise.all([
      streams[0].waitFor('kd,32'),
      streams[1].waitFor('kd,49')
    ])
    assert.deepEqual(
      streams.map((source) => source.received),
      [
        ['_stats,1', 'kd,32'],
        ['_stats,1', 'kd,49']
      ]
    )
    const closedA = once(clients[0], 'close')
    assert.equal(
      (
        await request('/auth/logout', {
          method: 'POST',
          headers: headers[0]
        })
      ).status,
      200
    )
    await closedA
    assert.deepEqual(stopped, [sessions[0].slot])
    assert.equal(clients[1].readyState, WebSocket.OPEN)
    assert.equal(
      (
        await request(`/api/remote/${leases[1].id}/renew`, {
          method: 'POST',
          headers: { ...headers[1], Cookie: cookies[1] }
        })
      ).status,
      200
    )
    clients[1].send('ku,49')
    await streams[1].waitFor('ku,49')
    assert.equal(streams[1].received.at(-1), 'ku,49')
    assert.deepEqual(streams[0].received, ['_stats,1', 'kd,32'])
    assert.equal(
      (
        await fixture.portal.internalApp.request(
          `http://127.0.0.1/_remote/${tickets[0]}/metadata`
        )
      ).status,
      404
    )
    assert.equal(
      (
        await fixture.portal.internalApp.request(
          `http://127.0.0.1/_remote/${tickets[1]}/metadata`
        )
      ).status,
      200
    )
  } finally {
    for (const client of clients) client.terminate()
    await fixture.portal.remote?.close()
    fixture.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    for (const source of sources) {
      for (const client of source.server.clients) client.terminate()
      await new Promise<void>((resolve) => source.server.close(() => resolve()))
    }
    rmSync(base, { recursive: true, force: true })
  }
}

test('Tab API reuses a full-capacity lease, scopes stream cookies, cancels stale/pending opens and gates client FIG access', async () => {
  const base = realpathSync(mkdtempSync(resolve(tmpdir(), 'portal-tab-api-')))
  let starts = 0,
    reloads = 0
  const fixture = await createGoogleFixture(base, 3218, {
    viewerMode: 'selkies',
    maxSessions: 2,
    allowClientEditor: true,
    remoteWorker: () => ({
      corePath: '/unused',
      streamUrl: 'http://127.0.0.1:8086',
      start: async (lease) => {
        starts++
        mkdirSync(base + '/remote/' + lease.id, { recursive: true })
      },
      reload: async () => {
        reloads++
      },
      stop: async () => undefined
    })
  })
  const request = (path: string, init: RequestInit = {}) =>
    fixture.portal.app.request(fixture.config.origin + path, init)
  try {
    const start = await request('/auth/google/start'),
      url = new URL(start.headers.get('location')!)
    const login = await request(
      '/auth/google/callback?' +
        new URLSearchParams({
          state: url.searchParams.get('state')!,
          code: fixtureCode(url, 'A')
        }),
      { headers: { Cookie: start.headers.getSetCookie()[0].split(';')[0] } }
    )
    const cookie = login.headers
      .getSetCookie()
      .find((value) => value.startsWith('portal='))!
      .split(';')[0]
    const me = await (
      await request('/api/me', { headers: { Cookie: cookie } })
    ).json()
    const headers = {
      Cookie: cookie,
      Origin: fixture.config.origin,
      'X-CSRF-Token': me.csrf,
      'Content-Type': 'application/json'
    }
    const tab = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      other = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
    const open = async (name: string, tab: string, sequence: number) => {
      const response = await request(
        `/api/files/${fileId('designs', name)}/remote`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            width: 1280,
            height: 720,
            dpr: 1,
            uiScale: 1.25,
            tab,
            request: sequence
          })
        }
      )
      return { response, body: await response.json() }
    }
    const close = (tab: string, sequence: number) =>
      request(`/api/remote-tab/${tab}/stop`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ request: sequence })
      })
    const a = await open('A.fig', tab, 1),
      b = await open('B.fig', other, 1)
    assert.equal(a.response.status, 200)
    assert.equal(b.response.status, 200)
    assert.notEqual(
      a.response.headers.getSetCookie()[0].split('=')[0],
      b.response.headers.getSetCookie()[0].split('=')[0]
    )
    const switched = await open('B.fig', tab, 2)
    assert.equal(switched.response.status, 200)
    assert.equal(switched.body.id, a.body.id)
    assert.deepEqual([starts, reloads], [2, 1])
    assert.equal((await close(tab, 1)).status, 200)
    assert.equal(fixture.portal.remote!.leases.length, 2)
    const lease = fixture.portal.remote!.leases.find(
      (lease) => lease.id === a.body.id
    )!
    const metadata = await (
      await fixture.portal.internalApp.request(
        `http://127.0.0.1/_remote/${lease.ticket}/metadata`
      )
    ).json()
    assert.equal(metadata.name, 'B.fig')
    assert.equal(metadata.generation, 2)
    assert.equal(
      (
        await fixture.portal.internalApp.request(
          `http://127.0.0.1/_remote/${lease.ticket}/ready`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ready: true, generation: 1 })
          }
        )
      ).status,
      409
    )
    assert.equal(
      (
        await request(a.body.url, {
          headers: {
            Cookie:
              cookie + '; ' + b.response.headers.getSetCookie()[0].split(';')[0]
          }
        })
      ).status,
      401
    )
    const id = fileId('designs', 'A.fig'),
      document = await (await request(`/api/files/${id}`, { headers })).json()
    const path = `/api/files/${id}/client-content?revision=${encodeURIComponent(document.revision)}`
    assert.equal((await request(path)).status, 401)
    assert.equal(
      (await request(`/api/files/${id}/content`, { headers })).status,
      410
    )
    assert.equal(
      (await request(`/api/files/${id}/scene`, { headers })).status,
      410
    )
    assert.equal(
      (
        await request(`/api/files/${id}/client-content?revision=stale`, {
          headers
        })
      ).status,
      409
    )
    assert.equal(
      (await request(path, { headers: { ...headers, Range: 'bytes=0-1' } }))
        .status,
      416
    )
    const bytes = await request(path, { headers })
    assert.equal(bytes.status, 200)
    assert.equal(bytes.headers.get('Cache-Control'), 'no-store')
    assert.deepEqual(
      Buffer.from(await bytes.arrayBuffer()),
      readFileSync('tests/fixtures/basic.fig')
    )
    fixture.config.allowClientEditor = false
    assert.equal((await request(path, { headers })).status, 410)
    assert.equal(
      (
        await request(`/api/remote-tab/${tab}/stop`, {
          method: 'POST',
          headers: {
            Cookie: cookie,
            Origin: fixture.config.origin,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ request: 2 })
        })
      ).status,
      403
    )
    assert.equal((await close(tab, 3)).status, 200)
    const canceled = await open('A.fig', tab, 3)
    assert.equal(canceled.response.status, 409)
    assert.deepEqual(
      fixture.portal.remote!.leases.map((lease) => lease.id),
      [b.body.id]
    )
    assert.equal((await close(other, 1)).status, 200)
    assert.equal(fixture.portal.remote!.leases.length, 0)
  } finally {
    await fixture.portal.remote?.close()
    fixture.close()
    rmSync(base, { recursive: true, force: true })
  }
})
