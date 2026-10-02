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
  appendFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { getEventListeners } from 'node:events'
const make = () => realpathSync(mkdtempSync(resolve(tmpdir(), 'safe-reader-')))
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
