import * as v from 'valibot'
import { resolve } from 'node:path'
const nonempty = v.pipe(v.string(), v.minLength(1))
const schema = v.strictObject({
  version: v.literal(1),
  mode: v.picklist(['read-only', 'session-edit']),
  environment: v.picklist(['development', 'production']),
  origin: v.pipe(v.string(), v.url()),
  host: nonempty,
  port: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
  identityProvider: v.picklist(['mock', 'google-oidc']),
  authorizationMode: v.picklist(['mock', 'dsm-strict', 'google-mount']),
  viewerMode: v.optional(v.picklist(['raster', 'native', 'selkies'])),
  allowClientEditor: v.optional(v.boolean(), false),
  remote: v.optional(
    v.strictObject({
      runtimePath: nonempty,
      appPort: v.literal(8085),
      streamPort: v.literal(8086),
      maxSessions: v.optional(
        v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(8)),
        4
      ),
      disconnectGraceMs: v.optional(
        v.pipe(v.number(), v.integer(), v.minValue(1000), v.maxValue(15000)),
        3000
      ),
      maxWidth: v.pipe(
        v.number(),
        v.integer(),
        v.minValue(640),
        v.maxValue(3840)
      ),
      maxHeight: v.pipe(
        v.number(),
        v.integer(),
        v.minValue(480),
        v.maxValue(2160)
      ),
      maxPixels: v.pipe(
        v.number(),
        v.integer(),
        v.minValue(307200),
        v.maxValue(8294400)
      ),
      maxDpi: v.pipe(v.number(), v.integer(), v.minValue(96), v.maxValue(192))
    })
  ),
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
  if (config.mode === 'session-edit' && config.viewerMode !== 'selkies')
    throw new Error('session-edit requires the isolated selkies application')
  if (
    config.allowClientEditor &&
    (config.viewerMode !== 'selkies' ||
      config.mode !== 'session-edit' ||
      config.authorizationMode !== 'google-mount')
  )
    throw new Error(
      'client editor requires explicit selkies session-edit/google-mount access'
    )
  if (
    config.viewerMode === 'selkies' &&
    (config.authorizationMode !== 'google-mount' ||
      !config.remote ||
      !config.remote.runtimePath.startsWith('/') ||
      config.remote.runtimePath === '/' ||
      config.remote.appPort === config.port ||
      (config.port >= config.remote.streamPort &&
        config.port < config.remote.streamPort + config.remote.maxSessions))
  )
    throw new Error(
      'selkies requires google-mount and isolated local runtime/ports'
    )
  if (config.remote && config.viewerMode !== 'selkies')
    throw new Error('remote settings require selkies')
  if (config.viewerMode === 'selkies' && config.remote) {
    const runtime = resolve(config.remote.runtimePath)
    const overlaps = (other: string) => {
      const path = resolve(other)
      return (
        runtime === path ||
        runtime.startsWith(path + '/') ||
        path.startsWith(runtime + '/')
      )
    }
    if (
      runtime !== config.remote.runtimePath ||
      config.roots.some((r) => overlaps(r.path)) ||
      overlaps(config.webPath)
    )
      throw new Error(
        'remote runtime must be canonical and isolated from source roots and public web assets'
      )
  }
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
