import { serve } from '@hono/node-server'
import { resolve } from 'node:path'
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { parseConfig } from './config.ts'
import { loadRuntimeConfig } from './runtime-config.ts'
import { createPortal } from './app.ts'
import { attachRemoteStream } from './remote-stream.ts'
import type { Server } from 'node:http'
import { assertRemoteMount } from './remote-mount.ts'
export function mockConfig() {
  const base = resolve(process.env.MOCK_ROOT ?? '.work/mock-nas'),
    statePath = resolve(process.env.STATE_PATH ?? '.work/mock-state.sqlite')
  if (!base.startsWith(resolve('.work') + '/'))
    throw new Error('Mock fixtures must be in a disposable .work subdirectory')
  mkdirSync(base, { recursive: true })
  for (const name of ['A.fig', 'B.fig', 'Shared.fig'])
    if (!existsSync(base + '/' + name))
      copyFileSync('tests/fixtures/basic.fig', base + '/' + name)
  const directoryPath = resolve('.work/mock-directory.json')
  const refresh = () => {
    const now = Date.now()
    writeFileSync(
      directoryPath,
      JSON.stringify({
        version: 1,
        instanceId: 'mock-nas',
        source: 'mock',
        observedAt: now,
        expiresAt: now + 60000,
        principals: ['A', 'B'].map((key) => ({
          key,
          generation: 'mock-1',
          username: key === 'A' ? 'alice' : 'bob',
          email: key === 'A' ? 'alice@mock.example' : 'bob@mock.example',
          enabled: true,
          trustedEmail: true,
          system: false,
          groups: []
        }))
      }),
      { mode: 0o600 }
    )
  }
  refresh()
  const timer = setInterval(refresh, 30000)
  timer.unref()
  const port = Number(process.env.PORT ?? 3210),
    origin = process.env.PORTAL_ORIGIN ?? `http://127.0.0.1:${port}`
  return parseConfig({
    version: 1,
    mode: 'read-only',
    environment: 'development',
    origin,
    host: '127.0.0.1',
    port,
    identityProvider: 'mock',
    authorizationMode: 'mock',
    allowedHostedDomains: ['mock.example'],
    statePath,
    directoryPath,
    webPath: resolve('dist/web'),
    roots: [{ id: 'fixtures', label: 'Mock NAS (synthetic)', path: base }],
    maxFileBytes: 536870912,
    maxDownloads: 4,
    scanIntervalMs: 10000
  })
}
const config =
  process.env.PORTAL_PROFILE === 'mock' ? mockConfig() : loadRuntimeConfig()
const portal = createPortal(config)
if (config.viewerMode === 'selkies' && config.environment === 'production')
  assertRemoteMount(config.roots, process.env.NAS_EXPECTED_SOURCE)
await portal.scan()
const timer = setInterval(() => void portal.scan(), config.scanIntervalMs)
timer.unref()
const server = serve(
  { fetch: portal.app.fetch, hostname: config.host, port: config.port },
  () =>
    console.log(
      `Portal ${config.identityProvider}/${config.authorizationMode}: ${config.origin}`
    )
)
const privateServer =
  config.viewerMode === 'selkies'
    ? serve({
        fetch: portal.internalApp.fetch,
        hostname: '127.0.0.1',
        port: config.remote!.appPort
      })
    : undefined
if (config.viewerMode === 'selkies')
  attachRemoteStream(server as Server, portal, config)
let shuttingDown = false
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    if (shuttingDown) return
    shuttingDown = true
    clearInterval(timer)
    await portal.remote?.close()
    privateServer?.close()
    server.close(() => {
      portal.close()
      process.exit(0)
    })
    ;(server as Server).closeAllConnections()
  })
