import { constants, openSync, closeSync, fstatSync, readSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { parseConfig, type Config } from './config.ts'

type Environment = Record<string, string | undefined>
class ConfigFileError extends Error {}
function fileError(label: string, reason: string): never {
  throw new ConfigFileError(`${label}: ${reason}`)
}
function readObject(path: string, limit: number, label: string) {
  let fd: number | undefined
  try {
    // A mis-mounted FIFO must fail the type check without waiting for a writer.
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    const before = fstatSync(fd)
    if (before.isDirectory())
      fileError(
        label,
        'is a directory; mount an existing JSON file, not a directory'
      )
    if (!before.isFile()) fileError(label, 'must be a regular JSON file')
    if (before.size > limit) fileError(label, `exceeds the ${limit}-byte limit`)
    const bytes = Buffer.alloc(limit + 1)
    let length = 0
    while (length < bytes.length) {
      const read = readSync(fd, bytes, length, bytes.length - length, null)
      if (!read) break
      length += read
    }
    const after = fstatSync(fd)
    if (
      length > limit ||
      length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    )
      fileError(label, 'changed while being read or exceeded its size limit')
    let value: unknown
    try {
      value = JSON.parse(bytes.subarray(0, length).toString('utf8'))
    } catch {
      fileError(label, 'contains invalid JSON; check the file syntax')
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      fileError(label, 'must contain a JSON object')
    return value as Record<string, unknown>
  } catch (error) {
    // Never include input JSON, secrets or a parser's value-bearing error.
    if (error instanceof ConfigFileError) throw error
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR')
      fileError(
        label,
        'file was not found; create the host JSON file and check its container mount target'
      )
    if (code === 'EACCES' || code === 'EPERM')
      fileError(
        label,
        'file is not readable; check file permissions for the container user (UID 10001)'
      )
    if (code === 'ELOOP')
      fileError(
        label,
        'must not be a symbolic link; mount the regular JSON file'
      )
    fileError(
      label,
      'could not be read; check the JSON file mount and permissions'
    )
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export function loadRuntimeConfig(env: Environment = process.env): Config {
  const raw = readObject(
    env.PORTAL_CONFIG ?? 'deploy/config.json',
    262144,
    'PORTAL_CONFIG'
  )
  if ('googleClientId' in raw || 'googleClientSecret' in raw)
    throw new Error('Keep OAuth credentials outside Portal config JSON')
  if (env.PORTAL_ORIGIN !== undefined) raw.origin = env.PORTAL_ORIGIN
  if (env.PORTAL_AUTHORIZATION_MODE !== undefined)
    raw.authorizationMode = env.PORTAL_AUTHORIZATION_MODE
  if (env.GOOGLE_HOSTED_DOMAINS !== undefined)
    raw.allowedHostedDomains = env.GOOGLE_HOSTED_DOMAINS.split(',').map((d) =>
      d.trim()
    )
  const bridgeValues = [
    env.NAS_BRIDGE_SOCKET,
    env.NAS_INSTANCE_ID,
    env.NAS_PROVIDER_ID,
    env.NAS_ACCEPTANCE_SHA256
  ]
  if (bridgeValues.some((value) => value !== undefined)) {
    if (bridgeValues.some((value) => !value) || raw.nasBridge !== undefined)
      throw new Error(
        'Choose complete native bridge environment settings or JSON settings, not both'
      )
    raw.nasBridge = {
      socketPath: env.NAS_BRIDGE_SOCKET,
      instanceId: env.NAS_INSTANCE_ID,
      providerId: env.NAS_PROVIDER_ID,
      acceptanceSha256: env.NAS_ACCEPTANCE_SHA256
    }
  }

  let clientId = env.GOOGLE_CLIENT_ID,
    clientSecret = env.GOOGLE_CLIENT_SECRET
  if (env.GOOGLE_OAUTH_FILE !== undefined) {
    if (!isAbsolute(env.GOOGLE_OAUTH_FILE))
      throw new Error('GOOGLE_OAUTH_FILE must be an absolute mounted file path')
    if (clientId !== undefined || clientSecret !== undefined)
      throw new Error(
        'Choose OAuth JSON or credential environment variables, not both'
      )
    const credentials = readObject(
      env.GOOGLE_OAUTH_FILE,
      65536,
      'GOOGLE_OAUTH_FILE'
    )
    const web = credentials.web
    if (
      'installed' in credentials ||
      'type' in credentials ||
      !web ||
      typeof web !== 'object' ||
      Array.isArray(web)
    )
      throw new Error(
        'OAuth JSON must be a Google Web application client, not a service account'
      )
    const client = web as Record<string, unknown>
    if (
      typeof client.client_id !== 'string' ||
      !client.client_id ||
      typeof client.client_secret !== 'string' ||
      !client.client_secret ||
      !Array.isArray(client.redirect_uris) ||
      !client.redirect_uris.includes(`${raw.origin}/auth/google/callback`)
    )
      throw new Error(
        'OAuth JSON needs web credentials and the exact Portal callback URI'
      )
    clientId = client.client_id
    clientSecret = client.client_secret
    // Endpoint fields in the download are deliberately ignored. OIDC uses fixed
    // Google endpoints; mounted JSON cannot redirect codes/tokens to another host.
  }
  try {
    return parseConfig({
      ...raw,
      googleClientId: clientId,
      googleClientSecret: clientSecret
    })
  } catch {
    throw new Error(
      'Invalid Portal configuration; check domains, roots and strict production profile'
    )
  }
}
