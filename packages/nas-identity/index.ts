import * as v from 'valibot'
import {
  AppError,
  type DirectorySnapshot,
  type Principal,
  type VerifiedIdentity
} from '../contracts/index.ts'
const text = v.pipe(v.string(), v.minLength(1), v.maxLength(256))
const principalSchema = v.strictObject({
  key: text,
  generation: text,
  username: text,
  email: v.pipe(v.string(), v.email()),
  enabled: v.boolean(),
  trustedEmail: v.boolean(),
  system: v.boolean(),
  groups: v.pipe(v.array(text), v.maxLength(256))
})
const snapshotSchema = v.strictObject({
  version: v.literal(1),
  instanceId: text,
  source: v.picklist(['mock', 'admin-approved', 'native-dsm']),
  observedAt: v.pipe(v.number(), v.integer(), v.minValue(0)),
  expiresAt: v.pipe(v.number(), v.integer(), v.minValue(0)),
  principals: v.pipe(v.array(principalSchema), v.maxLength(10000))
})
export function parseDirectory(data: unknown): DirectorySnapshot {
  return v.parse(snapshotSchema, data)
}
export function validateDirectoryFreshness(
  snapshot: DirectorySnapshot,
  now = Date.now()
): void {
  if (
    snapshot.observedAt > now + 30000 ||
    snapshot.expiresAt <= now ||
    now - snapshot.observedAt > 300000 ||
    snapshot.expiresAt > snapshot.observedAt + 300000
  )
    throw new AppError('directory-unavailable', 503)
}
export function resolvePrincipal(
  snapshot: DirectorySnapshot,
  identity: VerifiedIdentity,
  now = Date.now()
): Principal {
  validateDirectoryFreshness(snapshot, now)
  // Exact matching is deliberate: no aliases, +tags, dots, or guessed usernames.
  const matches = snapshot.principals.filter((p) => p.email === identity.email)
  if (matches.length !== 1) throw new AppError('identity-review-required', 403)
  const principal = matches[0]
  if (
    !principal ||
    !principal.enabled ||
    !principal.trustedEmail ||
    principal.system ||
    ['root', 'admin', 'guest'].includes(principal.username.toLowerCase())
  )
    throw new AppError('identity-rejected', 403)
  if (snapshot.principals.filter((p) => p.key === principal.key).length !== 1)
    throw new AppError('directory-invalid', 503)
  return principal
}
export function checkIdentityClaims(
  claims: Record<string, unknown>,
  allowedDomains: string[]
): VerifiedIdentity {
  const { iss, sub, email, hd, email_verified } = claims
  if (
    (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') ||
    typeof sub !== 'string' ||
    !sub ||
    sub.length > 255 ||
    typeof email !== 'string' ||
    !v.safeParse(v.pipe(v.string(), v.email()), email).success ||
    email_verified !== true ||
    typeof hd !== 'string' ||
    !allowedDomains.includes(hd)
  )
    throw new AppError('oidc-claims-rejected', 403)
  // Canonical issuer accepts Google's two documented issuer representations.
  return { iss: 'https://accounts.google.com', sub, email, hd }
}
