import { test, expect, type Page } from '@playwright/test'
import {
  readFileSync,
  statSync,
  lstatSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fixtureCode } from '../helpers/google-mount-fixture.ts'
const origin = 'http://127.0.0.1:3214'
test.use({ baseURL: origin, screenshot: 'off', trace: 'off', video: 'off' })
async function login(page: Page) {
  await page.route(origin + '/auth/google/start', async (route) => {
    const start = await route.fetch({ maxRedirects: 0 })
    const url = new URL(start.headers().location)
    await route.fulfill({
      response: start,
      headers: {
        ...start.headers(),
        location:
          origin +
          '/auth/google/callback?' +
          new URLSearchParams({
            state: url.searchParams.get('state') ?? '',
            code: fixtureCode(url)
          })
      }
    })
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Google Workspace 登入' }).click()
  await expect(page.getByText('a@fixture.example')).toBeVisible()
}
test('viewer page navigation, zoom and pan transfer only bounded viewport images', async ({
  page
}) => {
  test.skip(
    Boolean(process.env.REAL_FIG_FIXTURE_ROOT),
    'Synthetic test uses the synthetic source'
  )
  const errors: string[] = [],
    pictures: number[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (request) => {
    expect(new URL(request.url()).pathname).not.toMatch(/\/(scene|content)$/)
  })
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.endsWith('/viewport'))
      pictures.push(Number(response.headers()['content-length']))
  })
  const file = '.work/raster-e2e/source/A.fig',
    before = statSync(file)
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex')
  await login(page)
  await page.getByRole('button', { name: 'A.fig', exact: false }).dblclick()
  await expect(page.getByTestId('viewer-image')).toBeVisible()
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByTestId('pages-item')).toHaveCount(2)
  const first = await page.getByTestId('viewer-image').screenshot()
  await page.getByTestId('pages-item').filter({ hasText: 'Page 2' }).click()
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByTestId('viewer-image')).toBeVisible()
  expect(await page.getByTestId('viewer-image').screenshot()).not.toEqual(first)
  const zoom = await page.getByTestId('viewer-zoom').textContent()
  await page.getByRole('button', { name: '放大', exact: true }).click()
  await expect(page.getByTestId('viewer-zoom')).not.toHaveText(zoom ?? '')
  await expect(page.getByRole('status')).toHaveCount(0)
  const box = await page.getByTestId('viewer-viewport').boundingBox()
  if (!box) throw new Error('missing viewport')
  await page.mouse.move(box.x + 200, box.y + 200)
  await page.mouse.down()
  await page.mouse.move(box.x + 280, box.y + 220, { steps: 6 })
  await page.mouse.up()
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.locator('canvas')).toHaveCount(0)
  expect(pictures.length).toBeGreaterThanOrEqual(4)
  expect(pictures.every((size) => size > 0 && size <= 8388608)).toBe(true)
  expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(
    hash
  )
  expect(statSync(file).mtimeMs).toBe(before.mtimeMs)
  await page.getByRole('button', { name: '登出' }).click()
  await expect(page.getByTestId('viewer-image')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('approved real documents deliver metadata and visible images, never whole scene', async ({
  browser
}) => {
  const root = process.env.REAL_FIG_FIXTURE_ROOT
  test.skip(!root, 'No approved real fixtures')
  const paths = readdirSync(root ?? '')
    .filter((n) => n.endsWith('.fig'))
    .map((n) => join(root ?? '', n))
    .sort((a, b) => statSync(a).size - statSync(b).size)
  test.setTimeout(paths.length * 90000)
  const rows: unknown[] = []
  for (const path of paths) {
    const before = lstatSync(path)
    expect(
      before.isFile() && before.nlink === 1 && before.size <= 536870912
    ).toBe(true)
    const hash = createHash('sha256').update(readFileSync(path)).digest('hex')
    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1440, height: 960 }
    })
    const page = await context.newPage()
    let transferred = 0
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.name))
    page.on('request', (request) =>
      expect(new URL(request.url()).pathname).not.toMatch(/\/(scene|content)$/)
    )
    page.on('response', (response) => {
      if (/\/(viewer|viewport)$/.test(new URL(response.url()).pathname))
        transferred += Number(response.headers()['content-length'] ?? 0)
    })
    try {
      await login(page)
      const start = Date.now()
      await page
        .getByRole('button', { name: path.split('/').at(-1), exact: false })
        .dblclick()
      await expect(page.getByTestId('viewer-image')).toBeVisible({
        timeout: 75000
      })
      await expect(page.getByRole('status')).toHaveCount(0)
      expect(transferred).toBeLessThan(8388608 + 2097152)
      expect(errors).toEqual([])
      rows.push({
        ordinal: rows.length + 1,
        sourceBytes: before.size,
        transferredBytes: transferred,
        clickToVisibleMs: Date.now() - start,
        pages: await page.getByTestId('pages-item').count()
      })
      expect(
        createHash('sha256').update(readFileSync(path)).digest('hex')
      ).toBe(hash)
      expect(statSync(path).mtimeMs).toBe(before.mtimeMs)
    } finally {
      await context.close()
    }
  }
  writeFileSync(
    '.work/raster-viewer-performance.json',
    JSON.stringify(
      { kind: 'local-server-rendered-viewer-no-NAS', rows },
      null,
      2
    )
  )
})
