// Synthetic gateway/adapter test. This is not a Selkies or GPU acceptance server.
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { WebSocketServer } from 'ws'
import type { Server } from 'node:http'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import {
  createGoogleFixture,
  fixtureCode
} from '../helpers/google-mount-fixture.ts'
import { attachRemoteStream } from '../../apps/api/remote-stream.ts'
import type { RemoteLease } from '../../apps/api/remote-sessions.ts'
const base = resolve('.work/remote-e2e')
rmSync(base, { recursive: true, force: true })
mkdirSync(base, { recursive: true })
const corePath = resolve(base, 'synthetic-core.js')
writeFileSync(
  corePath,
  `
  const canvas = document.createElement('canvas'); canvas.id='synthetic-stream';
  document.getElementById('app').append(canvas);
  let socket;
  function resize(width,height) { canvas.width=width; canvas.height=height; const c=canvas.getContext('2d'); c.fillStyle='#38566b';c.fillRect(0,0,width,height);if(socket?.readyState===1)socket.send('r,'+width+'x'+height+',primary'); }
  resize(1024,768);
  addEventListener('message', event => {
    if(event.origin===location.origin && event.source===parent && event.data?.type==='setManualResolution' && socket?.readyState===1)
      resize(event.data.width,event.data.height);
  });
  // Deliberately finish iframe load before socket readiness. Pre-open sizes are lost.
  setTimeout(() => {
    socket = new WebSocket(location.origin.replace('http','ws')+location.pathname+'api/websockets');
    socket.onopen=() => window.postMessage({type:'pipelineStatusUpdate',video:true},location.origin);
  },800);
`
)
const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 })
await once(upstream, 'listening')
const address = upstream.address()
if (!address || typeof address === 'string') throw new Error('test socket')
let pauseStartup = false
const worker = {
  corePath,
  streamUrl: `http://127.0.0.1:${address.port}`,
  start: async (lease: RemoteLease) => {
    mkdirSync(base + '/remote/' + lease.id, { recursive: true })
    if (pauseStartup)
      await new Promise<void>((_resolve, reject) => {
        lease.abort.signal.addEventListener(
          'abort',
          () => reject(new Error('synthetic startup canceled')),
          { once: true }
        )
      })
  },
  stop: async (id: string) => {
    console.log('synthetic worker stopped', id)
  }
}
const fixture = await createGoogleFixture(base, 3215, {
  viewerMode: 'selkies',
  maxSessions: 2,
  allowClientEditor: true,
  remoteWorker: () => worker
})
const app = new Hono()
app.post('/__fixture/pause-startup', async (c) => {
  pauseStartup = (await c.req.json()).paused === true
  return c.json({ ok: true })
})
app.get('/__fixture/google', (c) => {
  const url = new URL(c.req.url)
  return c.redirect(
    '/auth/google/callback?' +
      new URLSearchParams({
        state: url.searchParams.get('state') ?? '',
        code: fixtureCode(url, url.searchParams.get('account') ?? 'A')
      })
  )
})
app.get('/__fixture/lease', (c) =>
  c.json({ ticket: fixture.portal.remote?.leases[0]?.ticket })
)
app.get('/__fixture/status', (c) =>
  c.json({
    leases: fixture.portal.remote?.leases.map((lease) => ({
      id: lease.id,
      tab: lease.tab,
      file: lease.file.name,
      generation: lease.generation,
      ready: lease.ready
    }))
  })
)
app.route('/', fixture.portal.app)
const server = serve({
  fetch: app.fetch,
  hostname: '127.0.0.1',
  port: 3215
}) as Server
attachRemoteStream(server, fixture.portal, fixture.config)
const internal = serve({
  fetch: fixture.portal.internalApp.fetch,
  hostname: '127.0.0.1',
  port: 8085
})
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    internal.close()
    server.close()
    upstream.close()
    fixture.close()
    process.exit(0)
  })
