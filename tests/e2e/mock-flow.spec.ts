import { test, expect } from '@playwright/test'
import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
test('A/B lists, double click native UI, readonly gestures, no external requests or persistent documents', async ({
  page
}) => {
  const external: string[] = [],
    content: string[] = [],
    errors: string[] = []
  page.on('request', (request) => {
    expect(new URL(request.url()).pathname.endsWith('/content')).toBe(false)
    const url = new URL(request.url())
    if (
      ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) &&
      url.origin !== 'http://127.0.0.1:3212'
    )
      external.push(request.url())
    if (url.pathname.endsWith('/scene')) content.push(request.url())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  const fixture = '.work/e2e-nas/A.fig'
  await page.goto('/')
  await expect(page.getByText('登入已失效', { exact: true })).toHaveCount(0)
  await page.getByTestId('login-A').click()
  await expect(page.getByText('alice@mock.example')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'A.fig', exact: false })
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'B.fig', exact: false })
  ).toHaveCount(0)
  expect(content).toHaveLength(0)
  const before = createHash('sha256')
      .update(readFileSync(fixture))
      .digest('hex'),
    mtime = statSync(fixture).mtimeMs
  await page.getByRole('button', { name: 'A.fig', exact: false }).dblclick()
  await expect(page.getByTestId('portal-document-name')).toHaveText('A.fig')
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 90000 })
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect(page.getByText('Pages', { exact: true })).toBeVisible()
  await expect(page.getByText('Layers', { exact: true })).toBeVisible()
  await expect(page.getByTestId('pages-item')).toHaveCount(2)
  await expect(page.getByTestId('pages-add')).toBeDisabled()
  await page.getByTestId('pages-item').filter({ hasText: 'Page 2' }).click()
  await expect(
    page.getByTestId('layers-item').filter({ hasText: 'LAN fixture circle' })
  ).toBeVisible()
  await page.getByTestId('pages-item').filter({ hasText: 'Page 1' }).click()
  const layer = page
    .getByTestId('layers-item')
    .filter({ hasText: 'LAN fixture rectangle' })
  await layer.click()
  await expect(layer).toHaveAttribute('data-selected', 'true')
  await expect(page.getByTestId('design-panel-single')).toBeVisible()
  await expect(
    page
      .getByTestId('design-panel-single')
      .getByRole('heading', { name: 'LAN fixture rectangle' })
  ).toBeVisible()
  await expect(page.getByTestId('properties-panel')).toBeVisible()
  await page.getByTestId('properties-tab-code').click()
  await expect(page.getByTestId('properties-tab-code')).toHaveAttribute(
    'data-state',
    'active'
  )
  await page.getByTestId('properties-tab-design').click()
  await expect(page.getByTestId('properties-tab-ai')).toHaveCount(0)
  await page.screenshot({ path: '.work/portal-native.png' })
  const scene = page.locator('canvas').first()
  await page.waitForTimeout(500)
  const sceneBefore = await scene.screenshot()
  const overlay = page.locator('canvas').last()
  await overlay.focus()
  await page.keyboard.press('Meta+s')
  await page.keyboard.press('Control+s')
  await page.keyboard.press('Delete')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Meta+v')
  await page.keyboard.press('r')
  const transfer = await page.evaluateHandle(() => new DataTransfer())
  await overlay.dispatchEvent('paste', { clipboardData: transfer })
  await overlay.dispatchEvent('drop', { dataTransfer: transfer })
  await transfer.dispose()
  const box = await overlay.boundingBox()
  if (box) {
    await page.mouse.move(box.x + 120, box.y + 130)
    await page.mouse.down()
    await page.mouse.move(box.x + 240, box.y + 230, { steps: 6 })
    await page.mouse.up()
  }
  await layer.click()
  await expect(layer).toHaveAttribute('data-selected', 'true')
  await page.waitForTimeout(500)
  expect(await scene.screenshot()).toEqual(sceneBefore)
  await expect(layer).toHaveText(/LAN fixture rectangle/)
  expect(createHash('sha256').update(readFileSync(fixture)).digest('hex')).toBe(
    before
  )
  expect(statSync(fixture).mtimeMs).toBe(mtime)
  const names = await page.evaluate(async () =>
    (await indexedDB.databases()).map((x) => x.name)
  )
  expect(
    names.filter((name) => name && /canvas|recovery|draft|outbox/.test(name))
  ).toEqual([])
  expect(
    await page.evaluate(() =>
      navigator.serviceWorker.getRegistrations().then((x) => x.length)
    )
  ).toBe(0)
  expect(content).toHaveLength(1)
  await page.getByRole('link', { name: 'OpenPencil · LAN Portal' }).click()
  await page
    .getByRole('button', { name: 'Shared.fig', exact: false })
    .dblclick()
  await expect(page.getByTestId('portal-document-name')).toHaveText(
    'Shared.fig'
  )
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 90000 })
  await page.getByRole('button', { name: '登出' }).click()
  await page.getByTestId('login-B').click()
  await expect(page.getByText('bob@mock.example')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'B.fig', exact: false })
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'A.fig', exact: false })
  ).toHaveCount(0)
  await expect(page.locator('canvas')).toHaveCount(0)
  // Browser history must reauthorize, including a previously loaded A-only file.
  await page.goBack()
  await page.goBack()
  await page.goBack()
  await expect(page.getByText('bob@mock.example')).toBeVisible()
  await expect(
    page.getByTestId('portal-document-name').filter({ hasText: /^A\.fig$/ })
  ).toHaveCount(0)
  await expect(
    page.getByTestId('layers-item').filter({ hasText: 'LAN fixture rectangle' })
  ).toHaveCount(0)
  expect(external).toEqual([])
  expect(errors).toEqual([])
  expect(content).toHaveLength(2)
})
