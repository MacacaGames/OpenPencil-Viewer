import test from 'node:test'
import assert from 'node:assert/strict'
import { parseConfig } from '../../apps/api/config.ts'
const base = {
  version: 1,
  mode: 'read-only',
  environment: 'production',
  origin: 'https://design.corp.example',
  host: '0.0.0.0',
  port: 3000,
  identityProvider: 'google-oidc',
  authorizationMode: 'dsm-strict',
  allowedHostedDomains: ['corp.example'],
  statePath: '/state/portal.sqlite',
  directoryPath: '/config/directory.json',
  webPath: '/app/dist/web',
  roots: [{ id: 'designs', label: 'Designs', path: '/data/designs' }],
  maxFileBytes: 536870912,
  maxDownloads: 4,
  scanIntervalMs: 60000,
  googleClientId: 'client',
  googleClientSecret: 'secret'
}
test('production requires Google HTTPS and explicit profile; unknown fields, unsafe roots and mock LAN binding reject', () => {
  assert.equal(parseConfig(base).authorizationMode, 'dsm-strict')
  for (const change of [
    { authorizationMode: 'mock' },
    { identityProvider: 'mock' },
    { origin: 'http://design.corp.example' },
    { mode: 'read-write' },
    { googleClientSecret: undefined },
    { driveScopes: ['drive'] },
    { roots: [{ id: 'designs', label: 'NAS', path: '/' }] },
    { roots: [base.roots[0], base.roots[0]] }
  ])
    assert.throws(() => parseConfig({ ...base, ...change }))
  assert.throws(() =>
    parseConfig({
      ...base,
      environment: 'development',
      identityProvider: 'mock',
      authorizationMode: 'mock',
      origin: 'http://127.0.0.1:3000'
    })
  )
})

test('Google shared mount is explicit, has no NAS directory dependency, and cannot use Mock or bridge', () => {
  const shared = {
    ...base,
    authorizationMode: 'google-mount',
    directoryPath: undefined
  }
  assert.equal(parseConfig(shared).authorizationMode, 'google-mount')
  for (const patch of [
    { identityProvider: 'mock' },
    { origin: 'http://design.corp.example' },
    { googleClientSecret: undefined },
    { authorizationMode: 'allow-all' },
    {
      nasBridge: {
        socketPath: '/run/bridge.sock',
        instanceId: 'nas',
        providerId: 'p',
        acceptanceSha256: 'a'.repeat(64)
      }
    }
  ])
    assert.throws(() => parseConfig({ ...shared, ...patch }))
  assert.throws(() => parseConfig({ ...base, directoryPath: undefined }))
})

test('native bridge configuration needs strict mode, canonical socket and a pinned evidence digest', () => {
  const nasBridge = {
    socketPath: '/run/openpencil-bridge/bridge.sock',
    instanceId: 'nas',
    providerId: 'verified-provider',
    acceptanceSha256: 'a'.repeat(64)
  }
  assert.deepEqual(parseConfig({ ...base, nasBridge }).nasBridge, nasBridge)
  for (const change of [
    { socketPath: 'relative.sock' },
    { socketPath: '/run/../bridge.sock' },
    { socketPath: '/run//bridge.sock' },
    { acceptanceSha256: '' },
    { acceptanceSha256: 'accept-all' },
    { insecure: true }
  ])
    assert.throws(() =>
      parseConfig({ ...base, nasBridge: { ...nasBridge, ...change } })
    )
})
