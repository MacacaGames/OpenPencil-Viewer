import { serve } from '@hono/node-server'
import { resolve } from 'node:path'
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { parseConfig } from './config.ts'
import { loadRuntimeConfig } from './runtime-config.ts'
import { createPortal } from './app.ts'
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
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    clearInterval(timer)
    server.close(() => {
      portal.close()
      process.exit(0)
    })
  })
