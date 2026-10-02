import test from 'node:test'
import assert from 'node:assert/strict'
import { serve } from '@hono/node-server'
import { once } from 'node:events'
import {
  mkdtempSync,
  realpathSync,
  writeFileSync,
  truncateSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createPortal } from '../../apps/api/app.ts'
import { parseConfig } from '../../apps/api/config.ts'
import { fileId } from '../../packages/filesystem/index.ts'
test('HTTP cancellation frees the global/per-principal slot and Python reader for the next download', async () => {
  const dir = realpathSync(mkdtempSync(resolve(tmpdir(), 'http-cancel-')))
  writeFileSync(dir + '/A.fig', '')
  truncateSync(dir + '/A.fig', 32 * 1024 * 1024)
  writeFileSync(dir + '/Shared.fig', 'next download')
  writeFileSync(
    dir + '/directory.json',
    JSON.stringify({
      version: 1,
      instanceId: 'nas',
      source: 'mock',
      observedAt: Date.now(),
      expiresAt: Date.now() + 60000,
      principals: [
        {
          key: 'A',
          generation: '1',
          username: 'alice',
          email: 'alice@mock.example',
          enabled: true,
          trustedEmail: true,
          system: false,
          groups: []
        }
      ]
    })
  )
  const config = parseConfig({
    version: 1,
    mode: 'read-only',
    environment: 'development',
    origin: 'http://127.0.0.1:3210',
    host: '127.0.0.1',
    port: 3210,
    identityProvider: 'mock',
    authorizationMode: 'mock',
    allowedHostedDomains: ['mock.example'],
    statePath: dir + '/state.sqlite',
    directoryPath: dir + '/directory.json',
    webPath: resolve('dist/web'),
    roots: [{ id: 'test', label: 'Test', path: dir }],
    maxFileBytes: 536870912,
    maxDownloads: 1,
    scanIntervalMs: 10000
  })
  const portal = createPortal(config)
  await portal.scan()
  const server = serve({
    fetch: portal.app.fetch,
    hostname: '127.0.0.1',
    port: 0
  })
  if (!server.listening) await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  config.origin = 'http://127.0.0.1:' + address.port
  try {
    const login = await fetch(config.origin + '/auth/mock', {
      method: 'POST',
      headers: { Origin: config.origin, 'Content-Type': 'application/json' },
      body: '{"account":"A"}'
    })
    assert.equal(login.status, 200)
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
    const response = await fetch(
      config.origin + '/api/files/' + fileId('test', 'A.fig') + '/content',
      { headers: { Cookie: cookie } }
    )
    assert.equal(response.status, 200)
    assert.ok(response.body)
    const reader = response.body.getReader()
    const first = await reader.read()
    assert.ok(first.value?.byteLength)
    await reader.cancel()
    await new Promise((resolve) => setTimeout(resolve, 150))
    const next = await fetch(
      config.origin + '/api/files/' + fileId('test', 'Shared.fig') + '/content',
      { headers: { Cookie: cookie } }
    )
    assert.equal(next.status, 200)
    assert.equal(await next.text(), 'next download')
  } finally {
    if ('closeAllConnections' in server) server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    portal.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
