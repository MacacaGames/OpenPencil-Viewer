import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { createHash } from 'node:crypto'
import { AppError } from '../../packages/contracts/index.ts'
import { checkIdentityClaims } from '../../packages/nas-identity/index.ts'
import type { Config } from './config.ts'
const googleKeys = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
  { timeoutDuration: 10000 }
)
export async function verifyGoogleToken(
  token: string,
  nonce: string,
  config: Pick<Config, 'googleClientId' | 'allowedHostedDomains'>,
  keys: JWTVerifyGetKey = googleKeys
) {
  if (!config.googleClientId || !nonce)
    throw new AppError('oidc-configuration-invalid', 503)
  const { payload } = await jwtVerify(token, keys, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: config.googleClientId,
    algorithms: ['RS256'],
    requiredClaims: [
      'exp',
      'iat',
      'sub',
      'aud',
      'iss',
      'nonce',
      'email',
      'email_verified',
      'hd'
    ],
    clockTolerance: 5
  })
  if (
    payload.nonce !== nonce ||
    (payload.azp !== undefined && payload.azp !== config.googleClientId) ||
    typeof payload.iat !== 'number' ||
    payload.iat > Date.now() / 1000 + 5
  )
    throw new AppError('oidc-claims-rejected', 403)
  return checkIdentityClaims(payload, config.allowedHostedDomains)
}
export function googleStart(
  config: Pick<Config, 'googleClientId' | 'origin'>,
  flow: { state: string; nonce: string; verifier: string }
) {
  const query = new URLSearchParams({
    client_id: config.googleClientId ?? '',
    redirect_uri: config.origin + '/auth/google/callback',
    response_type: 'code',
    scope: 'openid email profile',
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: createHash('sha256')
      .update(flow.verifier)
      .digest('base64url'),
    code_challenge_method: 'S256'
  })
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + query
}
export async function exchangeGoogle(
  code: string,
  flow: { nonce: string; verifier: string },
  config: Config
) {
  if (code.length > 4096) throw new AppError('oauth-code-rejected', 403)
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId ?? '',
      client_secret: config.googleClientSecret ?? '',
      redirect_uri: config.origin + '/auth/google/callback',
      grant_type: 'authorization_code',
      code_verifier: flow.verifier
    }),
    signal: AbortSignal.timeout(15000),
    redirect: 'error'
  })
  if (!response.ok) throw new AppError('oauth-exchange-failed', 502)
  const reader = response.body?.getReader()
  if (!reader) throw new AppError('oauth-exchange-failed', 502)
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.length
      if (length > 65536) throw new AppError('oauth-exchange-failed', 502)
      chunks.push(part.value)
    }
  } finally {
    await reader.cancel()
  }
  const result = JSON.parse(Buffer.concat(chunks).toString()) as Record<
    string,
    unknown
  >
  if (typeof result.id_token !== 'string')
    throw new AppError('oauth-exchange-failed', 502)
  return verifyGoogleToken(result.id_token, flow.nonce, config)
}
