import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  renameSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createPortal } from '../../apps/api/app.ts'
import { parseConfig } from '../../apps/api/config.ts'
import { fileId } from '../../packages/filesystem/index.ts'
test('offline restart retains metadata and mount identity; empty replacement is unavailable', async () => {
  const dir = realpathSync(mkdtempSync(resolve(tmpdir(), 'portal-restart-'))),
    source = dir + '/source'
  mkdirSync(source)
  copyFileSync('tests/fixtures/basic.fig', source + '/A.fig')
  writeFileSync(
    dir + '/directory.json',
    JSON.stringify({
      version: 1,
      instanceId: 'nas',
      source: 'mock',
      observedAt: Date.now(),
      expiresAt: Date.now() + 60000,
      principals: []
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
    roots: [{ id: 'root', label: 'Root', path: source }],
    maxFileBytes: 1024 * 1024,
    maxDownloads: 1,
    scanIntervalMs: 10000
  })
  let portal = createPortal(config)
  try {
    await portal.scan()
    const id = fileId('root', 'A.fig')
    assert.ok(portal.index.records.has(id))
    const identity = portal.index.identities.get('root')
    portal.close()
    renameSync(source, source + '-offline')
    portal = createPortal(config)
    await portal.scan()
    assert.ok(portal.index.records.has(id))
    assert.equal(portal.index.identities.get('root'), identity)
    assert.equal(portal.index.online.get('root'), false)
    portal.close()
    mkdirSync(source)
    portal = createPortal(config)
    await portal.scan()
    assert.ok(portal.index.records.has(id))
    assert.equal(portal.index.online.get('root'), false)
    portal.close()
    assert.throws(
      () =>
        createPortal({
          ...config,
          roots: [{ id: 'root', label: 'Root', path: source + '-offline' }]
        }),
      /administrator review/
    )
    rmSync(source, { recursive: true })
    renameSync(source + '-offline', source)
    portal = createPortal(config)
    await portal.scan()
    assert.equal(portal.index.online.get('root'), true)
  } finally {
    portal.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
