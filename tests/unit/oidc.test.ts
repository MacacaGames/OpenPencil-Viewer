import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose'
import { verifyGoogleToken, googleStart } from '../../apps/api/oidc.ts'
test('signed OIDC token verifies signature/issuer/audience/expiry/nonce/hd/email_verified', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = await exportJWK(publicKey)
  jwk.kid = 'local'
  const keys = createLocalJWKSet({ keys: [jwk] }),
    config = {
      googleClientId: 'client',
      allowedHostedDomains: ['corp.example']
    }
  const claims = {
    iss: 'https://accounts.google.com',
    sub: 'subject',
    aud: 'client',
    email: 'a@corp.example',
    email_verified: true,
    hd: 'corp.example',
    nonce: 'nonce',
    exp: Math.floor(Date.now() / 1000) + 60,
    iat: Math.floor(Date.now() / 1000)
  }
  const sign = (values: Record<string, unknown>, key = privateKey) =>
    new SignJWT(values)
      .setProtectedHeader({ alg: 'RS256', kid: 'local' })
      .sign(key)
  assert.equal(
    (await verifyGoogleToken(await sign(claims), 'nonce', config, keys)).sub,
    'subject'
  )
  for (const patch of [
    { iss: 'https://evil.example' },
    { aud: 'other' },
    { exp: 1 },
    { nonce: 'bad' },
    { hd: 'evil.example' },
    { email_verified: false },
    { exp: undefined },
    { iat: Math.floor(Date.now() / 1000) + 600 },
    { azp: 'other-client' },
    { nonce: undefined },
    { hd: undefined }
  ])
    await assert.rejects(() =>
      sign({ ...claims, ...patch }).then((token) =>
        verifyGoogleToken(token, 'nonce', config, keys)
      )
    )
  const other = await generateKeyPair('RS256')
  await assert.rejects(() =>
    sign(claims, other.privateKey).then((token) =>
      verifyGoogleToken(token, 'nonce', config, keys)
    )
  )
})
test('authorization URL has exact callback, PKCE, nonce/state and only identity scopes', () => {
  const url = new URL(
    googleStart(
      { googleClientId: 'client', origin: 'https://design.corp.example' },
      { state: 'state', nonce: 'nonce', verifier: 'random-verifier' }
    )
  )
  assert.equal(url.origin, 'https://accounts.google.com')
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://design.corp.example/auth/google/callback'
  )
  assert.equal(url.searchParams.get('scope'), 'openid email profile')
  assert.equal(url.searchParams.get('state'), 'state')
  assert.equal(url.searchParams.get('nonce'), 'nonce')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('code_challenge')?.length, 43)
  for (const name of [
    'access_type',
    'login_hint',
    'hd',
    'include_granted_scopes'
  ])
    assert.equal(url.searchParams.has(name), false)
})
