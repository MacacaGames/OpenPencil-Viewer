import { test, expect } from '@playwright/test'
import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fixtureCode } from '../helpers/google-mount-fixture.ts'
const origin = 'http://127.0.0.1:3213'
test.use({ baseURL: origin })
test('signed Google shared browse: both users see all files, nested navigation and native readonly FIG load', async ({
  page
}) => {
  let account = 'A'
  const errors: string[] = [],
    documentRequests: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    expect(new URL(request.url()).pathname.endsWith('/content')).toBe(false)
    if (request.url().endsWith('/scene')) documentRequests.push(request.url())
  })
  await page.route(origin + '/auth/google/start', async (route) => {
    const start = await route.fetch({ maxRedirects: 0 })
    const url = new URL(start.headers().location)
    expect(url.origin).toBe('https://accounts.google.com')
    await route.fulfill({
      response: start,
      headers: {
        ...start.headers(),
        location:
          origin +
          '/auth/google/callback?' +
          new URLSearchParams({
            state: url.searchParams.get('state')!,
            code: fixtureCode(url, account)
          })
      }
    })
  })
  const file = '.work/google-mount-e2e/source/B.fig'
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex'),
    mtime = statSync(file).mtimeMs
  await page.goto('/')
  await expect(page.getByTestId('shared-browse-profile')).toBeVisible()
  await page.getByRole('link', { name: 'Google Workspace 登入' }).click()
  await expect(page.getByText('a@fixture.example')).toBeVisible()
  for (const name of ['A.fig', 'B.fig'])
    await expect(page.getByRole('button', { name, exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'nested', exact: false }).dblclick()
  await expect(
    page.getByRole('button', { name: 'Nested.fig', exact: false })
  ).toBeVisible()
  await page.goto('/')
  await page.getByRole('button', { name: 'B.fig', exact: false }).dblclick()
  await expect(page.getByTestId('portal-document-name')).toHaveText('B.fig')
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 90000 })
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect(page.getByTestId('pages-item')).toHaveCount(2)
  await expect(page.getByTestId('pages-add')).toBeDisabled()
  await page.getByTestId('pages-item').filter({ hasText: 'Page 2' }).click()
  await expect(
    page.getByTestId('layers-item').filter({ hasText: 'LAN fixture circle' })
  ).toBeVisible()
  await page.locator('canvas').last().focus()
  await page.keyboard.press('Meta+s')
  await page.keyboard.press('Delete')
  expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(
    hash
  )
  expect(statSync(file).mtimeMs).toBe(mtime)
  await page.getByRole('button', { name: '登出' }).click()
  account = 'B'
  await page.getByRole('link', { name: 'Google Workspace 登入' }).click()
  await expect(page.getByText('b@fixture.example')).toBeVisible()
  for (const name of ['A.fig', 'B.fig'])
    await expect(page.getByRole('button', { name, exact: false })).toBeVisible()
  expect(documentRequests).toHaveLength(1)
  expect(errors).toEqual([])
})
