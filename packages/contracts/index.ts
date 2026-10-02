export class AppError extends Error {
  constructor(
    public code: string,
    public status = 400
  ) {
    super(code)
  }
}
export interface VerifiedIdentity {
  iss: string
  sub: string
  email: string
  hd: string
}
export interface Principal {
  key: string
  generation: string
  username: string
  email: string
  enabled: boolean
  trustedEmail: boolean
  system: boolean
  groups: string[]
}
export interface DirectorySnapshot {
  version: 1
  instanceId: string
  source: 'mock' | 'admin-approved'
  observedAt: number
  expiresAt: number
  principals: Principal[]
}
export interface FileRecord {
  id: string
  rootId: string
  relative: string
  name: string
  parentId: string
  kind: 'file' | 'folder'
  size: number
  revision: string
}
export interface RootConfig {
  id: string
  label: string
  path: string
}
export interface Session {
  id: string
  identity: VerifiedIdentity
  principalKey: string
  generation: string
  created: number
  touched: number
  csrf: string
}
