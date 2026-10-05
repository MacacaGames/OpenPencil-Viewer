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
test('Remote browser receives no graph; private native session edits remain in memory and clear on reload', async ({
  page,
  browser
}) => {
  const hash = () =>
    createHash('sha256').update(readFileSync(source)).digest('hex')
  const before = hash(),
    mtime = statSync(source).mtimeMs,
    requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  const input: string[] = []
  page.on('websocket', (socket) =>
    socket.on('framesent', ({ payload }) => {
      if (typeof payload === 'string') input.push(payload)
    })
  )
  await login(page)
  await page.getByRole('button', { name: /^A.fig/ }).dblclick()
  const iframe = page.frameLocator('iframe[title="OpenPencil 遠端畫面"]')
  await expect(iframe.locator('#synthetic-stream')).toBeVisible()
  // The delayed core initially paints1024px; Portal must resend size after open.
  await expect
    .poll(() =>
      iframe.locator('canvas').evaluate((c) => (c as HTMLCanvasElement).width)
    )
    .toBe(1440)
  await expect(
    page.getByRole('combobox', { name: '遠端文字大小' })
  ).toHaveValue('1.25')
  await page.getByRole('combobox', { name: '遠端文字大小' }).selectOption('1.5')
  const streamCanvas = iframe.locator('#synthetic-stream')
  // Wheel modifiers alone: keydown may occur outside the iframe or be absent for pinch.
  for (const modifier of ['ctrlKey', 'metaKey', 'overlay']) {
    input.length = 0
    await streamCanvas.evaluate((element, modifier) => {
      const box = element.getBoundingClientRect()
      let target = element
      if (modifier === 'overlay') {
        const input = document.createElement('input')
        input.id = 'overlayInput'
        document.body.append(input)
        target = input
      }
      target.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: box.left + box.width / 2,
          clientY: box.top + box.height / 2,
          deltaY: -120,
          [modifier === 'overlay' ? 'metaKey' : modifier]: true
        })
      )
    }, modifier)
    await expect
      .poll(() => input.some((message) => /^m,\d+,\d+,16,1$/.test(message)))
      .toBe(true)
    expect(input[0]).toBe('kd,65507')
    expect(input.at(-1)).toBe('ku,65507')
  }
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
  const initialFont = await native.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).fontSize)
  )
  await page
    .getByRole('combobox', { name: '遠端文字大小' })
    .selectOption('1.75')
  await expect
    .poll(() =>
      native.evaluate(() =>
        parseFloat(getComputedStyle(document.documentElement).fontSize)
      )
    )
    .toBeGreaterThan(initialFont)
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
  let downloads = 0
  native.on('download', () => downloads++)
  const external: string[] = []
  native.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:8085/'))
      external.push(request.url())
  })
  await expect(native.getByTestId('session-edit-notice')).toBeVisible()
  await expect(native.getByTestId('pages-add')).toBeEnabled()
  await expect(native.getByTestId('pages-item')).toHaveCount(2)
  await native.getByTestId('pages-item').filter({ hasText: 'Page 2' }).click()
  await expect(
    native.getByTestId('layers-item').filter({ hasText: 'LAN fixture circle' })
  ).toBeVisible()
  const circle = native
    .getByTestId('layers-item')
    .filter({ hasText: 'LAN fixture circle' })
  await circle.click()
  await expect(
    native.getByTestId('properties-panel').locator('fieldset')
  ).toBeEnabled()
  await native.keyboard.press('Delete')
  await expect(circle).toHaveCount(0)
  await native.keyboard.press('ControlOrMeta+z')
  await expect(circle).toBeVisible()
  await native.getByTestId('pages-add').click()
  await expect(native.getByTestId('pages-item')).toHaveCount(3)
  await native.getByTestId('pages-item').last().dblclick()
  await native.getByTestId('pages-item-input').fill('Temporary session page')
  await native.getByTestId('pages-item-input').press('Enter')
  await expect(native.getByTestId('pages-item').last()).toHaveText(
    'Temporary session page'
  )
  await native.keyboard.press('ControlOrMeta+s')
  await native.reload()
  await expect(native.getByRole('status')).toHaveCount(0, { timeout: 60000 })
  await expect(native.getByTestId('pages-item')).toHaveCount(2)
  await expect(
    native.getByText('Temporary session page', { exact: true })
  ).toHaveCount(0)
  expect(downloads).toBe(0)
  expect(external).toEqual([])
  await internalContext.close()
  await page.getByRole('button', { name: '登出', exact: true }).click()
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(
    page.getByRole('link', { name: 'Google Workspace 登入' })
  ).toBeVisible()
  expect(hash()).toBe(before)
  expect(statSync(source).mtimeMs).toBe(mtime)
})
