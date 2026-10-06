import { test, expect, type Page } from '@playwright/test'
import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fixtureCode } from '../helpers/google-mount-fixture.ts'
const origin = 'http://127.0.0.1:3215'
const source = '.work/remote-e2e/source/A.fig'
async function login(page: Page) {
  await page.route(origin + '/auth/google/start', async (route) => {
    const response = await route.fetch({ maxRedirects: 0 }),
      url = new URL(response.headers().location)
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
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
const stream = (page: Page) =>
  page
    .frameLocator('iframe[title="OpenPencil 遠端畫面"]')
    .locator('#synthetic-stream')
const opening = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/files\/[^/]+\/remote$/.test(new URL(response.url()).pathname)
  )

test('Rapid file switches reuse a tab lease at capacity; tabs sharing one login stay isolated and close independently', async ({
  page
}) => {
  const context = page.context()
  const status = async () =>
    (await (await context.request.get(origin + '/__fixture/status')).json())
      .leases as { id: string; file: string; tab: string }[]
  await login(page)
  const firstOpen = opening(page)
  await page.getByRole('button', { name: 'A.fig', exact: true }).dblclick()
  const first = await (await firstOpen).json()
  expect((await firstOpen).status()).toBe(200)
  await expect(stream(page)).toBeVisible()
  const second = await context.newPage()
  try {
    await second.goto(origin)
    const secondOpen = opening(second)
    await second.getByRole('button', { name: 'A.fig', exact: true }).dblclick()
    const other = await (await secondOpen).json()
    expect((await secondOpen).status()).toBe(200)
    expect(other.id).not.toBe(first.id)
    await expect(stream(second)).toBeVisible()
    await expect.poll(async () => (await status()).length).toBe(2)
    for (const name of ['B.fig', 'A.fig', 'B.fig']) {
      await page
        .getByRole('button', { name: '返回文件列表', exact: true })
        .click()
      const next = opening(page)
      await page.getByRole('button', { name, exact: true }).dblclick()
      const response = await next
      expect(response.status()).toBe(200)
      expect((await response.json()).id).toBe(first.id)
      await expect(page.getByRole('status')).toContainText('遠端會話編輯')
      await expect(stream(page)).toBeVisible()
      expect(
        (await status()).find((lease) => lease.id === first.id)?.file
      ).toBe(name)
    }
    await page.close()
    await expect
      .poll(async () => (await status()).map((lease) => lease.id), {
        timeout: 8000
      })
      .toEqual([other.id])
    await expect(stream(second)).toBeVisible()
    await second.close()
    await expect
      .poll(async () => (await status()).length, { timeout: 8000 })
      .toBe(0)
  } finally {
    if (!second.isClosed()) await second.close()
  }
})

test('Closing a tab during worker startup releases the reservation without waiting for a lease response', async ({
  page
}) => {
  const request = page.context().request
  const status = async () =>
    (await (await request.get(origin + '/__fixture/status')).json()).leases as {
      ready: boolean
    }[]
  await login(page)
  await request.post(origin + '/__fixture/pause-startup', {
    data: { paused: true }
  })
  try {
    await page.getByRole('button', { name: 'A.fig', exact: true }).dblclick()
    await expect
      .poll(async () => (await status()).map((lease) => lease.ready))
      .toEqual([false])
    await page.close()
    await expect
      .poll(async () => (await status()).length, { timeout: 8000 })
      .toBe(0)
  } finally {
    await request.post(origin + '/__fixture/pause-startup', {
      data: { paused: false }
    })
  }
})

test('Client-selected FIG editor parses in the browser, edits in memory and clears changes on reload without saving or export', async ({
  page
}) => {
  const hash = () =>
    createHash('sha256').update(readFileSync(source)).digest('hex')
  const before = hash(),
    mtime = statSync(source).mtimeMs
  const requests: string[] = [],
    external: string[] = []
  let downloads = 0
  await login(page)
  page.on('request', (request) => {
    requests.push(request.url())
    if (!request.url().startsWith(origin + '/')) external.push(request.url())
  })
  page.on('download', () => downloads++)
  await page.getByRole('combobox', { name: '開啟方式' }).selectOption('client')
  await page.getByRole('button', { name: 'A.fig', exact: true }).dblclick()
  await expect(page.getByTestId('client-edit-notice')).toBeVisible({
    timeout: 60000
  })
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(page.locator('canvas').first()).toBeVisible()
  expect(
    requests.filter((url) => /\/client-content\?revision=/.test(url))
  ).toHaveLength(1)
  expect(requests.some((url) => /\/scene(?:\?|$)/.test(url))).toBe(false)
  expect(
    (await (await page.request.get(origin + '/__fixture/status')).json()).leases
  ).toHaveLength(0)
  expect(
    await page.evaluate(() => Reflect.get(globalThis, '__portalMemoryIDB'))
  ).toBe(true)
  await expect(page.getByTestId('pages-add')).toBeEnabled()
  await page.getByTestId('pages-item').filter({ hasText: 'Page 2' }).click()
  const circle = page
    .getByTestId('layers-item')
    .filter({ hasText: 'LAN fixture circle' })
  await circle.click()
  await page.keyboard.press('Delete')
  await expect(circle).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(circle).toBeVisible()
  // Two undoable edits must need two keypresses, even after replacing the portal store.
  await circle.click()
  await page.keyboard.press('Delete')
  await page.getByTestId('pages-item').filter({ hasText: 'Page 1' }).click()
  const rectangle = page
    .getByTestId('layers-item')
    .filter({ hasText: 'LAN fixture rectangle' })
  await rectangle.click()
  await page.keyboard.press('Delete')
  await expect(rectangle).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(rectangle).toBeVisible()
  await page.getByTestId('pages-item').filter({ hasText: 'Page 2' }).click()
  await expect(circle).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(circle).toBeVisible()
  await page.getByTestId('pages-add').click()
  await expect(page.getByTestId('pages-item')).toHaveCount(3)
  await page.getByTestId('pages-add').click()
  await expect(page.getByTestId('pages-item')).toHaveCount(4)
  await page.keyboard.press('ControlOrMeta+s')
  await page.reload()
  await expect(page.getByTestId('client-edit-notice')).toBeVisible({
    timeout: 60000
  })
  await expect(page.getByTestId('pages-item')).toHaveCount(2)
  expect(
    await page.evaluate(async () =>
      (await indexedDB.databases()).filter((db) =>
        /canvas|recovery|draft|outbox/.test(db.name ?? '')
      )
    )
  ).toEqual([])
  expect(downloads).toBe(0)
  expect(external).toEqual([])
  expect(hash()).toBe(before)
  expect(statSync(source).mtimeMs).toBe(mtime)
  // Returning to server mode retires the browser editor and creates one tab lease.
  const next = opening(page)
  await page.getByRole('combobox', { name: '開啟方式' }).selectOption('server')
  expect((await next).status()).toBe(200)
  await expect(stream(page)).toBeVisible()
  await expect(page.getByTestId('client-edit-notice')).toHaveCount(0)
  await page.getByRole('combobox', { name: '開啟方式' }).selectOption('client')
  await expect(page.getByTestId('client-edit-notice')).toBeVisible({
    timeout: 60000
  })
  await expect
    .poll(
      async () =>
        (await (await page.request.get(origin + '/__fixture/status')).json())
          .leases.length
    )
    .toBe(0)
  await page.getByRole('button', { name: '登出', exact: true }).click()
  await expect(
    page.getByRole('link', { name: 'Google Workspace 登入' })
  ).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
})
