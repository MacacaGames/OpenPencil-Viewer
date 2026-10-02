import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  symlinkSync,
  rmSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRuntimeConfig } from '../../apps/api/runtime-config.ts'

test('native bridge environment is complete, exclusive and keeps errors free of private values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'portal-bridge-config-'))
  const path = join(dir, 'config.json'),
    oauth = join(dir, 'oauth.json')
  const config = JSON.parse(readFileSync('deploy/config.example.json', 'utf8'))
  const settings = {
    NAS_BRIDGE_SOCKET: '/run/openpencil-bridge/bridge.sock',
    NAS_INSTANCE_ID: 'nas',
    NAS_PROVIDER_ID: 'provider',
    NAS_ACCEPTANCE_SHA256: 'a'.repeat(64)
  }
  const env = { PORTAL_CONFIG: path, GOOGLE_OAUTH_FILE: oauth, ...settings }
  try {
    writeFileSync(path, JSON.stringify(config))
    writeFileSync(
      oauth,
      JSON.stringify({
        web: {
          client_id: 'test-client',
          client_secret: 'private-secret',
          redirect_uris: [
            'https://openpencil.macaca.games/auth/google/callback'
          ]
        }
      })
    )
    const loaded = loadRuntimeConfig(env)
    assert.equal(loaded.nasBridge?.socketPath, settings.NAS_BRIDGE_SOCKET)
    assert.equal(
      loaded.nasBridge?.acceptanceSha256,
      settings.NAS_ACCEPTANCE_SHA256
    )
    for (const key of Object.keys(settings))
      assert.throws(
        () => loadRuntimeConfig({ ...env, [key]: undefined }),
        /Choose complete native bridge/
      )
    writeFileSync(
      path,
      JSON.stringify({ ...config, nasBridge: loaded.nasBridge })
    )
    assert.throws(() => loadRuntimeConfig(env), /Choose complete native bridge/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('mounted JSON failures identify the cause without leaking contents or private paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'portal-private-config-'))
  const configPath = join(dir, 'config.json'),
    oauthPath = join(dir, 'google.json')
  const config = readFileSync('deploy/config.example.json', 'utf8')
  writeFileSync(configPath, config)
  writeFileSync(
    oauthPath,
    JSON.stringify({
      web: {
        client_id: 'test-client',
        client_secret: 'test-secret-do-not-log',
        redirect_uris: ['https://openpencil.macaca.games/auth/google/callback']
      }
    })
  )
  const env = { PORTAL_CONFIG: configPath, GOOGLE_OAUTH_FILE: oauthPath }
  try {
    // The configured limit remains inclusive for a valid JSON object.
    writeFileSync(configPath, config.padEnd(262144, ' '))
    assert.equal(loadRuntimeConfig(env).authorizationMode, 'dsm-strict')
    writeFileSync(configPath, config)
    for (const label of ['PORTAL_CONFIG', 'GOOGLE_OAUTH_FILE'] as const) {
      const bad = join(dir, 'bad.json')
      const cases: [() => void, string][] = [
        [() => {}, 'file was not found'],
        [() => mkdirSync(bad), 'is a directory'],
        [() => symlinkSync(configPath, bad), 'must not be a symbolic link'],
        [
          () =>
            writeFileSync(
              bad,
              ' '.repeat(label === 'PORTAL_CONFIG' ? 262145 : 65537)
            ),
          'exceeds the'
        ],
        [
          () => writeFileSync(bad, '{test-secret-do-not-log'),
          'contains invalid JSON'
        ],
        [() => writeFileSync(bad, ''), 'contains invalid JSON'],
        [() => writeFileSync(bad, '[]'), 'must contain a JSON object'],
        [() => writeFileSync(bad, 'null'), 'must contain a JSON object'],
        [
          () => writeFileSync(bad, '"test-secret-do-not-log"'),
          'must contain a JSON object'
        ]
      ]
      for (const [prepare, reason] of cases) {
        rmSync(bad, { recursive: true, force: true })
        prepare()
        assert.throws(
          () => loadRuntimeConfig({ ...env, [label]: bad }),
          (e: unknown) =>
            e instanceof Error &&
            e.message.startsWith(`${label}:`) &&
            e.message.includes(reason) &&
            !e.message.includes('test-secret') &&
            !e.message.includes(dir)
        )
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('unreadable mounted config reports container-user permissions', (t) => {
  if (process.getuid?.() === 0 || process.platform === 'win32') {
    t.skip('requires an unprivileged Unix user')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'portal-config-permissions-'))
  const path = join(dir, 'config.json')
  try {
    writeFileSync(path, 'test-secret-do-not-log', { mode: 0o000 })
    assert.throws(
      () => loadRuntimeConfig({ PORTAL_CONFIG: path }),
      (e: unknown) =>
        e instanceof Error &&
        e.message.startsWith('PORTAL_CONFIG: file is not readable') &&
        e.message.includes('UID 10001') &&
        !e.message.includes('test-secret') &&
        !e.message.includes(dir)
    )
  } finally {
    chmodSync(path, 0o600)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a FIFO mounted as config fails without waiting for a writer', (t) => {
  if (process.platform === 'win32') {
    t.skip('requires Unix FIFOs')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'portal-config-fifo-'))
  const path = join(dir, 'config.json')
  try {
    assert.equal(spawnSync('mkfifo', [path]).status, 0)
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '--eval',
        'import { loadRuntimeConfig } from "./apps/api/runtime-config.ts"; try { loadRuntimeConfig(); process.exitCode = 1 } catch (error) { console.error(error.message) }'
      ],
      {
        env: { ...process.env, PORTAL_CONFIG: path },
        encoding: 'utf8',
        timeout: 5000
      }
    )
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0)
    assert.match(
      result.stderr,
      /^PORTAL_CONFIG: must be a regular JSON file\s*$/
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

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
