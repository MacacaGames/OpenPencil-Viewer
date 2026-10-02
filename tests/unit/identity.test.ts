import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolvePrincipal,
  checkIdentityClaims,
  parseDirectory
} from '../../packages/nas-identity/index.ts'
import { State } from '../../apps/api/state.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
const identity = checkIdentityClaims(
  {
    iss: 'accounts.google.com',
    sub: 'subject-A',
    email: 'a@corp.example',
    email_verified: true,
    hd: 'corp.example'
  },
  ['corp.example']
)
const principal = {
  key: 'nas:1',
  generation: '1',
  username: 'alice',
  email: 'a@corp.example',
  trustedEmail: true,
  enabled: true,
  system: false,
  groups: []
}
const snapshot = () =>
  parseDirectory({
    version: 1,
    instanceId: 'test',
    source: 'admin-approved',
    observedAt: Date.now(),
    expiresAt: Date.now() + 60000,
    principals: [{ ...principal }]
  })
test('hd and verified email required; hints and suffix cannot authenticate', () => {
  for (const claims of [
    { ...identity, email_verified: false },
    { ...identity, email_verified: true, hd: 'evil.example' },
    { ...identity, email_verified: true, iss: 'https://evil.example' },
    { ...identity, email_verified: true, hd: undefined },
    { ...identity, email_verified: true, sub: '' }
  ])
    assert.throws(() => checkIdentityClaims(claims, ['corp.example']))
})
test('unique trusted enabled NAS principal; collision, stale, editable email, admin and aliases deny', () => {
  assert.equal(resolvePrincipal(snapshot(), identity).key, principal.key)
  for (const alter of [
    'duplicate',
    'disabled',
    'untrusted',
    'system',
    'admin',
    'expired',
    'alias'
  ]) {
    const s = snapshot()
    if (alter === 'duplicate')
      s.principals.push({ ...principal, key: 'second' })
    if (alter === 'disabled') s.principals[0].enabled = false
    if (alter === 'untrusted') s.principals[0].trustedEmail = false
    if (alter === 'system') s.principals[0].system = true
    if (alter === 'admin') s.principals[0].username = 'admin'
    if (alter === 'expired') s.expiresAt = 0
    if (alter === 'alias') s.principals[0].email = 'a+tag@corp.example'
    assert.throws(() => resolvePrincipal(s, identity))
  }
})
test('subject/email/NAS generation/instance changes require review; OAuth proof/state is once-only', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'identity-'))
  const db = new State(dir + '/state.sqlite')
  try {
    const s = snapshot()
    db.bind(identity, principal, s)
    assert.throws(() =>
      db.bind({ ...identity, sub: 'new-subject' }, principal, s)
    )
    assert.throws(() => db.bind(identity, { ...principal, generation: '2' }, s))
    assert.throws(() =>
      db.bind({ ...identity, email: 'other@corp.example' }, principal, s)
    )
    assert.throws(() =>
      db.bind(identity, principal, { ...s, instanceId: 'rebuilt-nas' })
    )
    const flow = db.createOAuth()
    assert.equal(db.consumeOAuth(flow.state, flow.proof).nonce, flow.nonce)
    assert.throws(() => db.consumeOAuth(flow.state, flow.proof))
    const wrong = db.createOAuth()
    assert.throws(() => db.consumeOAuth(wrong.state, 'wrong-browser'))
    assert.throws(() => db.consumeOAuth(wrong.state, wrong.proof))
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
test('sessions enforce maximum and idle expiry; administrator revoke removes only the selected principal', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'session-policy-')),
    db = new State(dir + '/state.sqlite')
  try {
    for (const field of ['created', 'touched']) {
      const token = db.createSession(identity, principal, snapshot()),
        session = db.session(token)
      session[field as 'created' | 'touched'] =
        Date.now() - (field === 'created' ? 3600000 : 1200000)
      db.db
        .prepare('UPDATE sessions SET data=? WHERE id=?')
        .run(JSON.stringify(session), session.id)
      assert.throws(() => db.session(token))
      assert.equal(
        db.db.prepare('SELECT id FROM sessions WHERE id=?').get(session.id),
        undefined
      )
    }
    const token = db.createSession(identity, principal, snapshot())
    assert.equal(db.revokePrincipal(principal.key), 1)
    assert.throws(() => db.session(token))
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
