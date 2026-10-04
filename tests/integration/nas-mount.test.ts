import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  realpathSync,
  writeFileSync,
  readFileSync,
  statSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { parseConfig } from '../../apps/api/config.ts'
import { createPortal } from '../../apps/api/app.ts'
import { State, digest } from '../../apps/api/state.ts'
import { FileIndex } from '../../packages/filesystem/index.ts'

test('production Google NAS proof refuses a local replacement while preserving offline metadata and sessions', async () => {
  const dir = realpathSync(mkdtempSync(resolve(tmpdir(), 'portal-nas-proof-')))
  const priorSource = process.env.NAS_EXPECTED_SOURCE
  const roots = [{ id: 'designs', label: 'Synthetic', path: dir }]
  const config = parseConfig({
    version: 1,
    mode: 'read-only',
    environment: 'production',
    origin: 'https://fixture.example',
    host: '0.0.0.0',
    port: 3000,
    identityProvider: 'google-oidc',
    authorizationMode: 'google-mount',
    allowedHostedDomains: ['fixture.example'],
    statePath: dir + '/state.sqlite',
    webPath: resolve('dist/web'),
    roots,
    maxFileBytes: 1024,
    maxDownloads: 1,
    scanIntervalMs: 60000,
    googleClientId: 'synthetic',
    googleClientSecret: 'synthetic'
  })
  let portal: ReturnType<typeof createPortal> | undefined
  try {
    writeFileSync(dir + '/A.fig', 'synthetic only')
    const before = readFileSync(dir + '/A.fig'),
      mtime = statSync(dir + '/A.fig').mtimeMs
    const index = new FileIndex(roots, 1024)
    await index.scan()
    const state = new State(config.statePath)
    state.saveIndex(index.records.values(), [
      { id: 'designs', path: dir, identity: '85:256' }
    ])
    const identity = {
      iss: 'https://accounts.google.com',
      sub: 'synthetic',
      email: 'a@fixture.example',
      hd: 'fixture.example'
    }
    const token = state.createGoogleMountSession(identity, {
      key: 'google:' + digest(identity.iss + '\0' + identity.sub),
      generation: 'google-mount-v1',
      username: identity.email,
      email: identity.email,
      enabled: true,
      trustedEmail: true,
      system: false,
      groups: []
    })
    state.close()
    process.env.NAS_EXPECTED_SOURCE = ':/synthetic-export'
    portal = createPortal(config)
    await portal.scan()
    assert.equal(portal.index.online.get('designs'), false)
    assert.equal(
      portal.index.errors.get('designs'),
      'remote-nas-mount-unavailable'
    )
    assert.equal(
      (await portal.app.request(config.origin + '/health/ready')).status,
      503
    )
    const headers = { Cookie: '__Host-portal=' + token }
    assert.equal(
      (await portal.app.request(config.origin + '/api/me', { headers })).status,
      200
    )
    assert.equal(
      (await portal.app.request(config.origin + '/api/files', { headers }))
        .status,
      503
    )
    assert.equal(portal.state.loadIndex().records.length, index.records.size)
    assert.equal(portal.state.loadIndex().roots[0].identity, '85:256')
    assert.equal(
      portal.state.db.prepare('SELECT count(*) AS n FROM sessions').get()?.n,
      1
    )
    assert.deepEqual(readFileSync(dir + '/A.fig'), before)
    assert.equal(statSync(dir + '/A.fig').mtimeMs, mtime)
  } finally {
    portal?.close()
    if (priorSource === undefined) delete process.env.NAS_EXPECTED_SOURCE
    else process.env.NAS_EXPECTED_SOURCE = priorSource
    rmSync(dir, { recursive: true, force: true })
  }
})
