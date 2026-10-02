import { DatabaseSync } from 'node:sqlite'
import { randomBytes, createHash } from 'node:crypto'
import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  AppError,
  type VerifiedIdentity,
  type Principal,
  type Session,
  type DirectorySnapshot,
  type FileRecord
} from '../../packages/contracts/index.ts'
export const randomToken = () => randomBytes(32).toString('base64url')
export const digest = (text: string) =>
  createHash('sha256').update(text).digest('hex')
export class State {
  db: DatabaseSync
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    chmodSync(path, 0o600)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS bindings(iss TEXT,sub TEXT,email TEXT UNIQUE,instance TEXT,principal TEXT,generation TEXT,PRIMARY KEY(iss,sub),UNIQUE(instance,principal));
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth(state TEXT PRIMARY KEY,proof TEXT,nonce TEXT,verifier TEXT,expires INTEGER);
      CREATE TABLE IF NOT EXISTS metadata(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS root_identity(id TEXT PRIMARY KEY,path TEXT NOT NULL,identity TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(at INTEGER,principal TEXT,file TEXT,result TEXT);
    `)
  }
  bind(
    identity: VerifiedIdentity,
    principal: Principal,
    snapshot: DirectorySnapshot
  ) {
    const prior = this.db
      .prepare('SELECT * FROM bindings WHERE iss=? AND sub=?')
      .get(identity.iss, identity.sub)
    if (prior) {
      if (
        prior.email !== identity.email ||
        prior.instance !== snapshot.instanceId ||
        prior.principal !== principal.key ||
        prior.generation !== principal.generation
      )
        throw new AppError('identity-review-required', 403)
      return
    }
    try {
      this.db
        .prepare('INSERT INTO bindings VALUES(?,?,?,?,?,?)')
        .run(
          identity.iss,
          identity.sub,
          identity.email,
          snapshot.instanceId,
          principal.key,
          principal.generation
        )
    } catch {
      throw new AppError('identity-review-required', 403)
    }
  }
  createSession(
    identity: VerifiedIdentity,
    principal: Principal,
    snapshot: DirectorySnapshot
  ) {
    this.bind(identity, principal, snapshot)
    const token = randomToken(),
      now = Date.now()
    const session: Session = {
      id: digest(token),
      identity,
      principalKey: principal.key,
      generation: principal.generation,
      created: now,
      touched: now,
      csrf: randomToken()
    }
    this.db
      .prepare('INSERT INTO sessions VALUES(?,?)')
      .run(session.id, JSON.stringify(session))
    this.audit(principal.key, '', 'login')
    return token
  }
  session(token: string | undefined): Session {
    if (!token) throw new AppError('login-required', 401)
    const id = digest(token),
      row = this.db.prepare('SELECT data FROM sessions WHERE id=?').get(id)
    if (!row || typeof row.data !== 'string')
      throw new AppError('login-required', 401)
    const session = JSON.parse(row.data) as Session,
      now = Date.now()
    if (now - session.created >= 3600000 || now - session.touched >= 1200000) {
      this.revoke(id)
      throw new AppError('login-required', 401)
    }
    session.touched = now
    this.db
      .prepare('UPDATE sessions SET data=? WHERE id=?')
      .run(JSON.stringify(session), id)
    return session
  }
  revoke(id: string) {
    this.db.prepare('DELETE FROM sessions WHERE id=?').run(id)
  }
  revokePrincipal(principal: string) {
    const result = this.db
      .prepare(
        "DELETE FROM sessions WHERE json_extract(data,'$.principalKey')=?"
      )
      .run(principal)
    this.audit(principal, '', 'admin-revoke')
    return Number(result.changes)
  }
  audit(principal: string, file: string, result: string) {
    this.db
      .prepare('INSERT INTO audit VALUES(?,?,?,?)')
      .run(Date.now(), principal, file, result)
  }
  loadIndex() {
    const records = this.db
      .prepare('SELECT data FROM metadata')
      .all()
      .map((row) => JSON.parse(String(row.data)) as FileRecord)
    const roots = this.db
      .prepare('SELECT id,path,identity FROM root_identity')
      .all()
      .map((row) => ({
        id: String(row.id),
        path: String(row.path),
        identity: String(row.identity)
      }))
    return { records, roots }
  }
  saveIndex(
    records: Iterable<FileRecord>,
    roots: Iterable<{ id: string; path: string; identity: string }>
  ) {
    this.db.exec('BEGIN')
    try {
      this.db.exec('DELETE FROM metadata; DELETE FROM root_identity')
      const insert = this.db.prepare('INSERT INTO metadata VALUES(?,?)')
      for (const record of records)
        insert.run(record.id, JSON.stringify(record))
      const root = this.db.prepare('INSERT INTO root_identity VALUES(?,?,?)')
      for (const record of roots)
        root.run(record.id, record.path, record.identity)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  createOAuth() {
    const state = randomToken(),
      proof = randomToken(),
      nonce = randomToken(),
      verifier = randomToken()
    this.db.prepare('DELETE FROM oauth WHERE expires<?').run(Date.now())
    this.db
      .prepare('INSERT INTO oauth VALUES(?,?,?,?,?)')
      .run(digest(state), digest(proof), nonce, verifier, Date.now() + 300000)
    return { state, proof, nonce, verifier }
  }
  consumeOAuth(state: string, proof: string | undefined) {
    const row = this.db
      .prepare('DELETE FROM oauth WHERE state=? RETURNING *')
      .get(digest(state))
    if (
      !row ||
      !proof ||
      row.proof !== digest(proof) ||
      typeof row.expires !== 'number' ||
      row.expires <= Date.now() ||
      typeof row.nonce !== 'string' ||
      typeof row.verifier !== 'string'
    )
      throw new AppError('oauth-state-rejected', 403)
    return { nonce: row.nonce, verifier: row.verifier }
  }
  close() {
    this.db.close()
  }
}
