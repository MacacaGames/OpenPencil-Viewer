import test from 'node:test'
import assert from 'node:assert/strict'
import { FileIndex, validRelative } from '../../packages/filesystem/index.ts'
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  linkSync,
  rmSync,
  renameSync,
  appendFileSync,
  truncateSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { getEventListeners } from 'node:events'
import { execFileSync } from 'node:child_process'
import { AppError } from '../../packages/contracts/index.ts'
import { State } from '../../apps/api/state.ts'
const make = () => realpathSync(mkdtempSync(resolve(tmpdir(), 'safe-reader-')))
test('bounded range reads seek within large FIGs and retain revision/link/confinement checks', async () => {
  const dir = make()
  try {
    writeFileSync(dir + '/large.fig', 'prefix')
    truncateSync(dir + '/large.fig', 200 * 1024 * 1024)
    const index = new FileIndex(
      [{ id: 'test', label: 'test', path: dir }],
      256 * 1024 * 1024
    )
    await index.scan()
    const record = [...index.records.values()].find((r) => r.kind === 'file')!
    const signal = new AbortController().signal
    assert.equal(
      (await index.readRange(record, 0, 6, signal)).toString(),
      'prefix'
    )
    assert.equal(
      (await index.readRange(record, record.size - 64, record.size, signal))
        .length,
      64
    )
    for (const [start, end] of [
      [-1, 4],
      [0, record.size + 1],
      [0, 5 * 1024 * 1024],
      [2, 1]
    ])
      await assert.rejects(
        () => index.readRange(record, start, end, signal),
        /invalid-range/
      )
    appendFileSync(dir + '/large.fig', 'changed')
    await assert.rejects(
      () => index.readRange(record, 0, 6, signal),
      /source-changed/
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('reject traversal, encoded separators, links and non-fig directories; filenames are opaque API IDs', async () => {
  const dir = make()
  try {
    mkdirSync(dir + '/source')
    writeFileSync(dir + '/source/one.fig', 'one')
    writeFileSync(dir + '/secret.fig', 'secret')
    symlinkSync(dir + '/secret.fig', dir + '/source/link.fig')
    linkSync(dir + '/source/one.fig', dir + '/source/hard.fig')
    mkdirSync(dir + '/source/folder.fig')
    writeFileSync(dir + '/source/folder.fig/two.FIG', 'two')
    const index = new FileIndex(
      [{ id: 'test', label: 'test', path: dir + '/source' }],
      1024
    )
    await index.scan()
    assert.equal(index.online.get('test'), true)
    assert.deepEqual(
      [...index.records.values()]
        .filter((f) => f.kind === 'file')
        .map((f) => f.relative),
      ['folder.fig/two.FIG']
    )
    for (const path of [
      '../one.fig',
      'a/../b',
      '/etc/shadow',
      'a%2fb.fig',
      'a%252fb.fig',
      'a\\b.fig',
      'a//b.fig',
      '\0.fig'
    ])
      assert.equal(validRelative(path), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('destroy before consumption removes abort listener and cancellation does not keep a reader active', async () => {
  const dir = make()
  try {
    writeFileSync(dir + '/big.fig', Buffer.alloc(8 * 1024 * 1024))
    const index = new FileIndex(
      [{ id: 'test', label: 'test', path: dir }],
      16 * 1024 * 1024
    )
    await index.scan()
    const record = [...index.records.values()].find((r) => r.kind === 'file')
    assert.ok(record)
    const cancel = new AbortController(),
      stream = await index.open(record, cancel.signal)
    stream.destroy()
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(getEventListeners(cancel.signal, 'abort').length, 0)
    cancel.abort()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('append after indexed revision and replacement during scan cannot silently serve a different file', async () => {
  const dir = make()
  try {
    writeFileSync(dir + '/one.fig', 'before')
    const index = new FileIndex(
      [{ id: 'test', label: 'test', path: dir }],
      1024
    )
    await index.scan()
    const record = [...index.records.values()].find((r) => r.kind === 'file')
    assert.ok(record)
    appendFileSync(dir + '/one.fig', 'after')
    await assert.rejects(() => index.open(record, new AbortController().signal))
    const count = index.records.size
    renameSync(dir, dir + '-offline')
    await index.scan()
    assert.equal(index.online.get('test'), false)
    assert.equal(index.records.size, count)
    rmSync(dir + '-offline', { recursive: true, force: true })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('growth while a descriptor is streaming aborts and never exceeds the indexed byte limit', async () => {
  const dir = make()
  try {
    const size = 8 * 1024 * 1024
    writeFileSync(dir + '/growing.fig', Buffer.alloc(size))
    const index = new FileIndex(
      [{ id: 'test', label: 'test', path: dir }],
      size * 2
    )
    await index.scan()
    const record = [...index.records.values()].find((r) => r.kind === 'file')
    assert.ok(record)
    const source = await index.open(record, new AbortController().signal)
    appendFileSync(dir + '/growing.fig', Buffer.alloc(size))
    let received = 0
    await assert.rejects(async () => {
      for await (const chunk of source) received += chunk.length
    })
    assert.ok(received <= size)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('verified NAS index rebuilds legacy metadata, survives changed device baseline and persists stable proof', async () => {
  const dir = make()
  const state = new State(dir + '/state.sqlite')
  try {
    writeFileSync(dir + '/one.fig', 'synthetic')
    const roots = [{ id: 'test', label: 'test', path: dir }]
    const raw = JSON.parse(
      execFileSync('python3', ['tools/filesystem/reader.py', 'scan', dir], {
        encoding: 'utf8'
      })
    )
    const proof = { identity: 'a'.repeat(64), mountId: raw.mountId }
    const legacy = new FileIndex(roots, 1024)
    await legacy.scan()
    const stale = {
      records: [...legacy.records.values()],
      roots: [{ id: 'test', path: dir, identity: '85:256' }]
    }
    state.saveIndex(stale.records, stale.roots)
    state.db.prepare('INSERT INTO sessions VALUES(?,?)').run('preserved', '{}')
    const index = new FileIndex(roots, 1024, () => proof)
    index.restore(state.loadIndex())
    assert.equal(index.online.get('test'), false) // Never serve an unverified cache.
    await assert.rejects(
      () =>
        index.stat([...index.records.values()].find((r) => r.kind === 'file')!),
      /source-offline/
    )
    await index.scan()
    assert.equal(index.online.get('test'), true)
    assert.equal(
      [...index.records.values()].filter((r) => r.kind === 'file').length,
      1
    )
    state.saveIndex(index.records.values(), [
      {
        id: 'test',
        path: dir,
        identity: index.identities.get('test')!,
        sourceIdentity: index.sourceIdentities.get('test')
      }
    ])
    const saved = state.loadIndex()
    assert.equal(
      saved.roots[0].sourceIdentity,
      proof.identity + ':' + raw.identity.split(':')[1]
    )
    saved.roots[0].identity = '999999:' + raw.identity.split(':')[1]
    const restart = new FileIndex(roots, 1024, () => proof)
    restart.restore(saved)
    assert.equal(restart.online.get('test'), false)
    await restart.scan()
    assert.equal(restart.online.get('test'), true)
    assert.equal(restart.identities.get('test'), raw.identity)
    assert.equal(
      state.db.prepare('SELECT count(*) AS n FROM sessions').get()?.n,
      1
    )
    const record = [...restart.records.values()].find((r) => r.kind === 'file')!
    assert.equal((await restart.stat(record)).size, 9)
    const bytes = await restart.open(record, new AbortController().signal)
    let content = ''
    for await (const chunk of bytes) content += chunk.toString()
    assert.equal(content, 'synthetic')

    proof.mountId = raw.mountId === null ? 123 : raw.mountId + 1
    await assert.rejects(() => restart.stat(record), /source-offline/)
    assert.equal(restart.online.get('test'), false)
    await restart.scan()
    assert.equal(restart.errors.get('test'), 'source-mount-changed')
    assert.equal(restart.records.size, saved.records.length)
    proof.mountId = raw.mountId
    await restart.scan()
    assert.equal(restart.online.get('test'), true)

    proof.identity = 'b'.repeat(64)
    await restart.scan()
    assert.equal(restart.errors.get('test'), 'source-identity-changed')
    assert.equal(restart.online.get('test'), false)
    assert.equal(restart.records.size, saved.records.length)
    proof.identity = 'a'.repeat(64)
    await restart.scan()
    assert.equal(restart.online.get('test'), true)

    let observations = 0
    const changing = new FileIndex(roots, 1024, () => ({
      ...proof,
      mountId: observations++ === 0 ? raw.mountId : (raw.mountId ?? 0) + 1
    }))
    changing.restore(saved)
    await changing.scan()
    assert.equal(changing.errors.get('test'), 'source-mount-changed')
    assert.equal(changing.online.get('test'), false)
    assert.equal(changing.records.size, saved.records.length)

    const missing = new FileIndex(roots, 1024, () => {
      throw new AppError('remote-nas-mount-unavailable', 503)
    })
    missing.restore(saved)
    await missing.scan()
    assert.equal(missing.online.get('test'), false)
    assert.equal(missing.errors.get('test'), 'remote-nas-mount-unavailable')
    await assert.rejects(
      () => missing.open(record, new AbortController().signal),
      /source-offline/
    )
    saved.roots[0].sourceIdentity = 'a'.repeat(64) + ':999999'
    const replaced = new FileIndex(roots, 1024, () => proof)
    replaced.restore(saved)
    await replaced.scan()
    assert.equal(replaced.errors.get('test'), 'source-identity-changed')
  } finally {
    state.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
