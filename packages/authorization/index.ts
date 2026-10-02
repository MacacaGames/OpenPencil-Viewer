import type { FileRecord, Principal } from '../contracts/index.ts'
export interface AuthorizationProvider {
  readonly mode: 'mock' | 'dsm-strict'
  ready(): boolean
  canRead(principal: Principal, record: FileRecord): Promise<boolean>
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
// No validated native evaluator exists yet. Production must remain unavailable;
// this stub deliberately has no local/service UID or root-allowlist fallback.
export class DsmStrictAuthorization implements AuthorizationProvider {
  readonly mode = 'dsm-strict'
  ready() {
    return false
  }
  async canRead(_principal: Principal, _record: FileRecord) {
    return false
  }
}
