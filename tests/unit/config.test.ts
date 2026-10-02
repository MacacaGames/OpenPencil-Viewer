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
test('production requires Google HTTPS + dsm-strict; unknown fields, unsafe roots and mock LAN binding reject', () => {
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
