import * as v from 'valibot'
const nonempty = v.pipe(v.string(), v.minLength(1))
const schema = v.strictObject({
  version: v.literal(1),
  mode: v.literal('read-only'),
  environment: v.picklist(['development', 'production']),
  origin: v.pipe(v.string(), v.url()),
  host: nonempty,
  port: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
  identityProvider: v.picklist(['mock', 'google-oidc']),
  authorizationMode: v.picklist(['mock', 'dsm-strict', 'google-mount']),
  viewerMode: v.optional(v.picklist(['raster', 'native'])),
  allowedHostedDomains: v.pipe(
    v.array(
      v.pipe(
        v.string(),
        v.regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)
      )
    ),
    v.minLength(1)
  ),
  statePath: nonempty,
  directoryPath: v.optional(nonempty),
  webPath: nonempty,
  roots: v.pipe(
    v.array(
      v.strictObject({
        id: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/)),
        label: nonempty,
        path: nonempty
      })
    ),
    v.minLength(1)
  ),
  maxFileBytes: v.pipe(
    v.number(),
    v.integer(),
    v.minValue(1),
    v.maxValue(536870912)
  ),
  maxDownloads: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(16)),
  scanIntervalMs: v.pipe(v.number(), v.integer(), v.minValue(1000)),
  googleClientId: v.optional(nonempty),
  googleClientSecret: v.optional(nonempty),
  nasBridge: v.optional(
    v.strictObject({
      socketPath: nonempty,
      instanceId: v.pipe(nonempty, v.maxLength(256)),
      providerId: v.pipe(nonempty, v.maxLength(256)),
      acceptanceSha256: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/))
    })
  )
})
export type Config = v.InferOutput<typeof schema>
export function parseConfig(raw: unknown): Config {
  const config = v.parse(schema, raw)
  const origin = new URL(config.origin)
  if (config.environment === 'production' && config.viewerMode === 'native')
    throw new Error('production uses the server-rendered viewer')
  if (origin.origin !== config.origin || origin.username || origin.password)
    throw new Error('origin must be an exact origin')
  if (
    new Set(config.roots.map((r) => r.id)).size !== config.roots.length ||
    config.roots.some((r) => !r.path.startsWith('/') || r.path === '/')
  )
    throw new Error('explicit unique absolute roots required')
  if (
    config.environment === 'production' &&
    (origin.protocol !== 'https:' ||
      config.identityProvider !== 'google-oidc' ||
      !['dsm-strict', 'google-mount'].includes(config.authorizationMode))
  )
    throw new Error(
      'production requires HTTPS, Google OIDC and an explicit Google authorization profile'
    )
  if (
    config.authorizationMode === 'google-mount' &&
    config.identityProvider !== 'google-oidc'
  )
    throw new Error('google-mount requires verified Google OIDC')
  if (config.authorizationMode !== 'google-mount' && !config.directoryPath)
    throw new Error('directoryPath required for NAS identity mapping')
  if (
    config.identityProvider === 'mock' &&
    (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) ||
      config.environment !== 'development' ||
      !['127.0.0.1', '::1'].includes(config.host))
  )
    throw new Error('mock is loopback development only')
  if (
    config.identityProvider === 'google-oidc' &&
    (!config.googleClientId || !config.googleClientSecret)
  )
    throw new Error('missing OAuth credentials')
  if (
    config.nasBridge &&
    (config.authorizationMode !== 'dsm-strict' ||
      !config.nasBridge.socketPath.startsWith('/') ||
      config.nasBridge.socketPath
        .split('/')
        .slice(1)
        .some((p) => !p || p === '.' || p === '..') ||
      /[\\\0]/.test(config.nasBridge.socketPath))
  )
    throw new Error(
      'native bridge requires dsm-strict and a canonical absolute socket path'
    )
  return config
}
