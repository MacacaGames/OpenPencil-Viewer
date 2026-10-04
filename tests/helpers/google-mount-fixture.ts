// Synthetic signed OIDC fixture. Never used by the production entry point.
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { parseConfig } from '../../apps/api/config.ts'
import { createPortal } from '../../apps/api/app.ts'
import type { RemoteWorker } from '../../apps/api/remote-sessions.ts'

export function fixtureCode(
  url: URL,
  account = 'A',
  patch: Record<string, unknown> = {}
) {
  return (
    'synthetic:' +
    Buffer.from(
      JSON.stringify({
        account,
        nonce: url.searchParams.get('nonce'),
        challenge: url.searchParams.get('code_challenge'),
        patch
      })
    ).toString('base64url')
  )
}

export async function createGoogleFixture(
  base: string,
  port = 3213,
  options: {
    viewerMode?: 'raster' | 'selkies'
    sourceRoot?: string
    remoteWorker?: RemoteWorker
  } = {}
) {
  const source = resolve(base, 'source'),
    secondary = resolve(base, 'secondary')
  mkdirSync(source + '/nested', { recursive: true })
  mkdirSync(secondary, { recursive: true })
  for (const name of ['A.fig', 'B.fig'])
    copyFileSync('tests/fixtures/basic.fig', source + '/' + name)
  copyFileSync('tests/fixtures/basic.fig', source + '/nested/Nested.fig')
  copyFileSync('tests/fixtures/basic.fig', secondary + '/Second.fig')
  writeFileSync(source + '/ignored.txt', 'synthetic only')
  const config = parseConfig({
    version: 1,
    mode: 'read-only',
    environment: 'development',
    origin: `http://127.0.0.1:${port}`,
    host: '127.0.0.1',
    port,
    identityProvider: 'google-oidc',
    authorizationMode: 'google-mount',
    viewerMode: options.viewerMode,
    remote:
      options.viewerMode === 'selkies'
        ? {
            runtimePath: resolve(base, 'remote'),
            appPort: 8085,
            streamPort: 8086,
            maxWidth: 1920,
            maxHeight: 1080,
            maxPixels: 2073600,
            maxDpi: 192
          }
        : undefined,
    allowedHostedDomains: ['fixture.example'],
    statePath: resolve(base, 'state.sqlite'),
    webPath: resolve(process.env.PORTAL_TEST_WEB_PATH ?? 'dist/web'),
    roots: [
      {
        id: 'designs',
        label: 'Synthetic designs',
        path: options.sourceRoot ?? source
      },
      { id: 'secondary', label: 'Synthetic second root', path: secondary }
    ],
    maxFileBytes: 536870912,
    maxDownloads: 4,
    scanIntervalMs: 60000,
    googleClientId: 'synthetic-client',
    googleClientSecret: 'synthetic-secret'
  })
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = await exportJWK(publicKey)
  jwk.kid = 'synthetic-only'
  const keys = createLocalJWKSet({ keys: [jwk] })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    if (String(input) !== 'https://oauth2.googleapis.com/token')
      throw new Error('synthetic test blocked unexpected network')
    const body = new URLSearchParams(String(init?.body))
    const code = body.get('code') ?? ''
    if (!code.startsWith('synthetic:'))
      throw new Error('synthetic code required')
    const data = JSON.parse(Buffer.from(code.slice(10), 'base64url').toString())
    if (
      createHash('sha256')
        .update(body.get('code_verifier') ?? '')
        .digest('base64url') !== data.challenge
    )
      throw new Error('fixture PKCE mismatch')
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({
      iss: 'https://accounts.google.com',
      aud: config.googleClientId,
      sub: 'synthetic-' + data.account,
      email: data.account.toLowerCase() + '@fixture.example',
      email_verified: true,
      hd: 'fixture.example',
      nonce: data.nonce,
      iat: now,
      exp: now + 60,
      ...data.patch
    })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
      .sign(privateKey)
    return Response.json({ id_token: token })
  }
  const portal = createPortal(config, {
    googleTokenKeys: keys,
    remoteWorker: options.remoteWorker
  })
  await portal.scan()
  let closed = false
  return {
    portal,
    config,
    source,
    secondary,
    keys,
    close() {
      if (closed) return
      closed = true
      portal.close()
      globalThis.fetch = originalFetch
    }
  }
}
