// Synthetic gateway/adapter test. This is not a Selkies or GPU acceptance server.
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { WebSocketServer } from 'ws'
import type { Server } from 'node:http'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  createGoogleFixture,
  fixtureCode
} from '../helpers/google-mount-fixture.ts'
import { attachRemoteStream } from '../../apps/api/remote-stream.ts'
import type { RemoteLease } from '../../apps/api/remote-sessions.ts'
const base = resolve('.work/remote-e2e')
mkdirSync(base, { recursive: true })
const corePath = resolve(base, 'synthetic-core.js')
writeFileSync(
  corePath,
  `
  const canvas = document.createElement('canvas'); canvas.id='synthetic-stream';
  document.getElementById('app').append(canvas);
  const socket = new WebSocket(location.origin.replace('http','ws')+location.pathname+'api/websockets');
  function resize() { canvas.width=innerWidth; canvas.height=innerHeight; const c=canvas.getContext('2d'); c.fillStyle='#38566b';c.fillRect(0,0,canvas.width,canvas.height);if(socket.readyState===1)socket.send('r,'+innerWidth+'x'+innerHeight+',primary'); }
  socket.onopen=resize; addEventListener('resize',resize);resize();
`
)
const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 })
await once(upstream, 'listening')
const address = upstream.address()
if (!address || typeof address === 'string') throw new Error('test socket')
const worker = {
  corePath,
  streamUrl: `http://127.0.0.1:${address.port}`,
  start: async (lease: RemoteLease) => {
    mkdirSync(base + '/remote/' + lease.id, { recursive: true })
  },
  stop: async (id: string) => {
    console.log('synthetic worker stopped', id)
  }
}
const fixture = await createGoogleFixture(base, 3215, {
  viewerMode: 'selkies',
  remoteWorker: worker
})
const app = new Hono()
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
  c.json({ ticket: fixture.portal.remote?.active?.ticket })
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
