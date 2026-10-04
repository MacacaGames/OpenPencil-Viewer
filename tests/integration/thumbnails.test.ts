import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
  statSync,
  readFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import {
  createGoogleFixture,
  fixtureCode
} from '../helpers/google-mount-fixture.ts'
import { thumbnailFig, thumbnailPNG } from '../helpers/thumbnail-fixture.ts'
import { fileId } from '../../packages/filesystem/index.ts'
test('authorized thumbnails use bounded NAS ranges and share temporary cache without bypassing source/session checks', async (t) => {
  const base = realpathSync(mkdtempSync(resolve(tmpdir(), 'thumbnail-test-')))
  const fixture = await createGoogleFixture(base)
  const request = (path: string, init: RequestInit = {}) =>
    fixture.portal.app.request(fixture.config.origin + path, init)
  const login = async (account: string) => {
    const start = await request('/auth/google/start'),
      url = new URL(start.headers.get('location')!)
    const response = await request(
      '/auth/google/callback?' +
        new URLSearchParams({
          state: url.searchParams.get('state')!,
          code: fixtureCode(url, account)
        }),
      { headers: { Cookie: start.headers.getSetCookie()[0].split(';')[0] } }
    )
    return response.headers
      .getSetCookie()
      .find((x) => x.startsWith('portal='))!
      .split(';')[0]
  }
  try {
    writeFileSync(fixture.source + '/A.fig', thumbnailFig(16 * 1024 * 1024))
    await fixture.portal.scan()
    const id = fileId('designs', 'A.fig'),
      A = await login('A'),
      B = await login('B')
    const record = fixture.portal.index.records.get(id)!
    const path = `/api/files/${id}/thumbnail?revision=${encodeURIComponent(record.revision)}`
    const hash = () =>
      createHash('sha256')
        .update(readFileSync(fixture.source + '/A.fig'))
        .digest('hex')
    const before = hash(),
      mtime = statSync(fixture.source + '/A.fig').mtimeMs
    let bytes = 0,
      calls = 0
    const read = fixture.portal.index.readRange.bind(fixture.portal.index)
    t.mock.method(
      fixture.portal.index,
      'readRange',
      async (...args: Parameters<typeof read>) => {
        bytes += args[2] - args[1]
        calls++
        return read(...args)
      }
    )
    assert.equal((await request(path)).status, 401)
    assert.equal(
      (
        await request(
          path.replace(encodeURIComponent(record.revision), 'wrong'),
          { headers: { Cookie: A } }
        )
      ).status,
      409
    )
    const first = await request(path, { headers: { Cookie: A } })
    assert.equal(first.status, 200)
    assert.equal(first.headers.get('Content-Type'), 'image/png')
    assert.equal(first.headers.get('Cache-Control'), 'no-store')
    assert.deepEqual(Buffer.from(await first.arrayBuffer()), thumbnailPNG())
    assert.ok(bytes < 128 * 1024, `range bytes ${bytes}`)
    const initialCalls = calls
    const second = await request(path, { headers: { Cookie: B } })
    assert.equal(second.status, 200)
    assert.equal(calls, initialCalls)
    fixture.portal.state.revoke(
      fixture.portal.state.session(A.split('=')[1]).id
    )
    assert.equal((await request(path, { headers: { Cookie: A } })).status, 401)
    assert.equal((await request(path, { headers: { Cookie: B } })).status, 200)
    assert.equal(hash(), before)
    assert.equal(statSync(fixture.source + '/A.fig').mtimeMs, mtime)
    writeFileSync(fixture.source + '/A.fig', thumbnailFig())
    // An indexed source changed before rescan: filesystem proof fails closed.
    assert.equal((await request(path, { headers: { Cookie: B } })).status, 503)
    await fixture.portal.scan()
    const updated = fixture.portal.index.records.get(id)!
    assert.equal(
      (
        await request(
          `/api/files/${id}/thumbnail?revision=${encodeURIComponent(updated.revision)}`,
          { headers: { Cookie: B } }
        )
      ).status,
      200
    )
    assert.ok(calls > initialCalls)
  } finally {
    fixture.close()
    rmSync(base, { recursive: true, force: true })
  }
})
