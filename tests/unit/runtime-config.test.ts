import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRuntimeConfig } from '../../apps/api/runtime-config.ts'

test('mounted web OAuth JSON + environment domains work without exposing secrets or trusting JSON endpoints', () => {
  const dir = mkdtempSync(join(tmpdir(), 'portal-runtime-config-'))
  const configPath = join(dir, 'config.json'),
    oauthPath = join(dir, 'google.json')
  const config = JSON.parse(readFileSync('deploy/config.example.json', 'utf8'))
  const web = {
    client_id: 'test.apps.googleusercontent.com',
    client_secret: 'test-secret-do-not-log',
    redirect_uris: ['https://portal.example.org/auth/google/callback'],
    token_uri: 'https://attacker.invalid'
  }
  writeFileSync(configPath, JSON.stringify(config))
  const writeOAuth = (value: unknown) =>
    writeFileSync(oauthPath, JSON.stringify(value))
  writeOAuth({ web })
  const env = {
    PORTAL_CONFIG: configPath,
    GOOGLE_OAUTH_FILE: oauthPath,
    PORTAL_ORIGIN: 'https://portal.example.org',
    GOOGLE_HOSTED_DOMAINS: 'example.org, other.example.org'
  }
  const loaded = loadRuntimeConfig(env)
  assert.equal(loaded.origin, env.PORTAL_ORIGIN)
  assert.deepEqual(loaded.allowedHostedDomains, [
    'example.org',
    'other.example.org'
  ])
  assert.equal(loaded.googleClientSecret, web.client_secret)
  assert.equal('token_uri' in loaded, false)
  try {
    for (const value of [
      { installed: web },
      { type: 'service_account', private_key: 'do-not-log' },
      { web: { ...web, redirect_uris: [] } }
    ]) {
      writeOAuth(value)
      assert.throws(
        () => loadRuntimeConfig(env),
        (e: unknown) => e instanceof Error && !e.message.includes('do-not-log')
      )
    }
    writeOAuth({ web })
    for (const change of [
      { GOOGLE_CLIENT_SECRET: 'do-not-log' },
      { GOOGLE_OAUTH_FILE: 'relative.json' },
      { GOOGLE_HOSTED_DOMAINS: 'example.org,' },
      { GOOGLE_HOSTED_DOMAINS: 'https://example.org' },
      { PORTAL_ORIGIN: 'http://portal.example.org' }
    ])
      assert.throws(() => loadRuntimeConfig({ ...env, ...change }))
    symlinkSync(oauthPath, join(dir, 'link.json'))
    assert.throws(() =>
      loadRuntimeConfig({ ...env, GOOGLE_OAUTH_FILE: join(dir, 'link.json') })
    )
    writeFileSync(oauthPath, 'x'.repeat(65537))
    assert.throws(() => loadRuntimeConfig(env))
    writeFileSync(oauthPath, '{test-secret-do-not-log')
    assert.throws(
      () => loadRuntimeConfig(env),
      (e: unknown) => e instanceof Error && !e.message.includes('test-secret')
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('legacy server-only OAuth environment remains supported and JSON cannot smuggle credentials or production mock mode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'portal-runtime-config-'))
  const path = join(dir, 'config.json')
  const config = JSON.parse(readFileSync('deploy/config.example.json', 'utf8'))
  const env = {
    PORTAL_CONFIG: path,
    GOOGLE_CLIENT_ID: 'client',
    GOOGLE_CLIENT_SECRET: 'secret'
  }
  try {
    writeFileSync(path, JSON.stringify(config))
    assert.equal(loadRuntimeConfig(env).authorizationMode, 'dsm-strict')
    for (const change of [
      { googleClientSecret: 'do-not-log' },
      { authorizationMode: 'mock' },
      { unsafeUnknownField: true }
    ]) {
      writeFileSync(path, JSON.stringify({ ...config, ...change }))
      assert.throws(
        () => loadRuntimeConfig(env),
        (e: unknown) => e instanceof Error && !e.message.includes('do-not-log')
      )
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
