// Synthetic-only Linux runtime acceptance harness; not copied into release image.
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import type { Server } from 'node:http'
import { createGoogleFixture } from '../helpers/google-mount-fixture.ts'
import { attachRemoteStream } from '../../apps/api/remote-stream.ts'
import { createHash } from 'node:crypto'
import { readFileSync, statSync, readdirSync, mkdirSync } from 'node:fs'
const port = Number(process.env.FIXTURE_PORT ?? 3000)
const fixture = await createGoogleFixture('/state/synthetic', port, {
  viewerMode: 'selkies',
  maxSessions: 2
})
const app = new Hono()
const zooms = new Map<string, number>()
mkdirSync('/state/synthetic/remote', { recursive: true })
app.get('/__fixture/status', (c) =>
  c.json({
    lease: fixture.portal.remote?.leases[0]?.id,
    leases: fixture.portal.remote?.leases.map((lease) => ({
      id: lease.id,
      slot: lease.slot,
      file: lease.file.name,
      generation: lease.generation,
      zoom: zooms.get(lease.id)
    })),
    ready: fixture.portal.remote?.leases[0]?.ready,
    sourceHash: createHash('sha256')
      .update(readFileSync(fixture.source + '/A.fig'))
      .digest('hex'),
    sourceMtime: statSync(fixture.source + '/A.fig').mtimeMs,
    profiles: readdirSync('/state/synthetic/remote')
  })
)
app.route('/', fixture.portal.app)
const server = serve({
  fetch: app.fetch,
  hostname: '0.0.0.0',
  port
}) as Server
const internal = serve({
  fetch: async (request) => {
    const url = new URL(request.url)
    if (url.pathname === '/__fixture/metrics.js')
      return new Response(
        `
        const ticket = new URLSearchParams(location.search).get('ticket');
        setInterval(() => {
          const value = parseFloat(document.querySelector('[data-test-id="zoom-dropdown-trigger"]')?.textContent ?? '');
          if (Number.isFinite(value)) fetch('/__fixture/metrics?ticket='+ticket, {method:'POST', body:String(value)});
        },100);
      `,
        { headers: { 'Content-Type': 'application/javascript' } }
      )
    if (url.pathname === '/__fixture/metrics' && request.method === 'POST') {
      const lease = await fixture.portal.remote?.internal(
        url.searchParams.get('ticket') ?? ''
      )
      if (lease) zooms.set(lease.id, Number(await request.text()))
      return new Response('ok')
    }
    const response = await fixture.portal.internalApp.fetch(request)
    if (url.pathname !== '/remote-desktop') return response
    return new Response(
      (await response.text()).replace(
        '<head>',
        '<head><script src="/__fixture/metrics.js"></script>'
      ),
      { headers: response.headers }
    )
  },
  hostname: '127.0.0.1',
  port: 8085
})
attachRemoteStream(server, fixture.portal, fixture.config)
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await fixture.portal.remote?.close()
    internal.close()
    server.close()
    fixture.close()
    process.exit(0)
  })
