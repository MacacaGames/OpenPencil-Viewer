import type { FileRecord, Principal } from '../contracts/index.ts'
import type { NasBridge } from '../nas-bridge/index.ts'
import type { Readable } from 'node:stream'
import type { DirectorySnapshot } from '../contracts/index.ts'
export interface AuthorizationProvider {
  readonly mode: 'mock' | 'dsm-strict' | 'google-mount'
  ready(): boolean | Promise<boolean>
  canRead(principal: Principal, record: FileRecord): Promise<boolean>
  directory?(): Promise<DirectorySnapshot>
  stat?(principal: Principal, record: FileRecord): Promise<void>
  open?(
    principal: Principal,
    record: FileRecord,
    signal: AbortSignal
  ): Promise<Readable>
}
// Explicit operator-selected shared browse profile, not a DSM ACL provider.
export class GoogleMountAuthorization implements AuthorizationProvider {
  readonly mode = 'google-mount'
  constructor(private readonly roots: Set<string>) {}
  ready() {
    return true
  }
  async canRead(principal: Principal, record: FileRecord) {
    return (
      principal.enabled &&
      principal.trustedEmail &&
      !principal.system &&
      principal.generation === 'google-mount-v1' &&
      /^google:[a-f0-9]{64}$/.test(principal.key) &&
      this.roots.has(record.rootId)
    )
  }
}
export class MockAuthorization implements AuthorizationProvider {
  readonly mode = 'mock'
  constructor(public grants: Map<string, Set<string>>) {}
  ready() {
    return true
  }
  async canRead(principal: Principal, record: FileRecord) {
    return (
      principal.enabled &&
      (this.grants
        .get(principal.key)
        ?.has(record.rootId + '/' + record.relative) ??
        false)
    )
  }
}
// A bridge never grants access from a local/service UID. Its native source,
// exact NAS/provider/roots and live acceptance digest must all be validated.
// Without a configured bridge, the original production gate remains closed.
export class DsmStrictAuthorization implements AuthorizationProvider {
  readonly mode = 'dsm-strict'
  constructor(readonly bridge?: NasBridge) {}
  ready() {
    return this.bridge?.ready() ?? false
  }
  async canRead(principal: Principal, record: FileRecord) {
    return this.bridge?.canRead(principal, record) ?? false
  }
}
