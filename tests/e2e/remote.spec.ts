import { test, expect } from '@playwright/test'
import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fixtureCode } from '../helpers/google-mount-fixture.ts'
const origin = 'http://127.0.0.1:3215'
const source = '.work/remote-e2e/source/A.fig'
async function login(page: import('@playwright/test').Page) {
  await page.route(origin + '/auth/google/start', async (route) => {
    const start = await route.fetch({ maxRedirects: 0 })
    const url = new URL(start.headers().location)
    return route.fulfill({
      response: start,
      headers: {
        ...start.headers(),
        location:
          origin +
          '/auth/google/callback?' +
          new URLSearchParams({
            state: url.searchParams.get('state')!,
            code: fixtureCode(url, 'A')
          })
      }
    })
  })
  await page.goto(origin)
  await page.getByRole('link', { name: 'Google Workspace 登入' }).click()
  await expect(page.getByRole('heading', { name: '設計文件' })).toBeVisible()
}
test('Remote Portal browser receives no document graph; private native adapter preserves readonly UI', async ({
  page,
  browser
}) => {
  const hash = () =>
    createHash('sha256').update(readFileSync(source)).digest('hex')
  const before = hash(),
    mtime = statSync(source).mtimeMs,
    requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await login(page)
  await page.getByRole('button', { name: /^A.fig/ }).dblclick()
  const iframe = page.frameLocator('iframe[title="OpenPencil 遠端唯讀畫面"]')
  await expect(iframe.locator('#synthetic-stream')).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
  expect(requests.some((url) => /\/(scene|content)(?:\?|$)/.test(url))).toBe(
    false
  )
  await page.setViewportSize({ width: 1200, height: 760 })
  await expect
    .poll(() =>
      iframe.locator('canvas').evaluate((c) => (c as HTMLCanvasElement).width)
    )
    .toBeLessThanOrEqual(1200)
  const lease = await (
    await page.request.get(origin + '/__fixture/lease')
  ).json()
  const internalContext = await browser.newContext()
  const native = await internalContext.newPage()
  await native.goto(
    'http://127.0.0.1:8085/remote-desktop?ticket=' + lease.ticket
  )
  await expect(native.locator('canvas').first()).toBeVisible()
  await expect(native.getByRole('status')).toHaveCount(0, { timeout: 60000 })
  expect(
    await native.evaluate(() => Reflect.get(globalThis, '__portalMemoryIDB'))
  ).toBe(true)
  expect(
    await native.evaluate(async () =>
      (await indexedDB.databases()).filter((db) =>
        /canvas|recovery|draft|outbox/.test(db.name ?? '')
      )
    )
  ).toEqual([])
  await expect(native.getByTestId('pages-add')).toBeDisabled()
  await expect(native.getByTestId('pages-item')).toHaveCount(2)
  await native.getByTestId('pages-item').filter({ hasText: 'Page 2' }).click()
  await expect(
    native.getByTestId('layers-item').filter({ hasText: 'LAN fixture circle' })
  ).toBeVisible()
  await internalContext.close()
  await page.getByRole('button', { name: '登出', exact: true }).click()
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(
    page.getByRole('link', { name: 'Google Workspace 登入' })
  ).toBeVisible()
  expect(hash()).toBe(before)
  expect(statSync(source).mtimeMs).toBe(mtime)
})
