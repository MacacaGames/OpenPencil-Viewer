import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { root, bun } from '../../scripts/common.ts'

test.beforeAll(() => {
  const script = root + '/.work/editor/create-image-fixture.ts'
  writeFileSync(
    script,
    readFileSync(root + '/tests/adapter/create-image-fixture.ts')
  )
  try {
    execFileSync(bun, ['run', script], {
      cwd: root + '/.work/editor',
      stdio: 'pipe'
    })
  } finally {
    unlinkSync(script)
  }
})
test('viewport image worker renders fit/tile fills across resize, pages and repeated opens', async ({
  page
}) => {
  const errors: string[] = [],
    external: string[] = []
  let workers = 0
  page.on('worker', () => {
    workers++
  })
  page.on('pageerror', (error) => {
    errors.push(error.message)
  })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (
      ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) &&
      url.origin !== 'http://127.0.0.1:3212'
    )
      external.push(url.origin)
    expect(url.pathname.endsWith('/content')).toBe(false)
  })
  await page.route('**/api/files/**/scene', async (route) => {
    const response = await route.fetch()
    const body = readFileSync(root + '/.work/viewport-images.scene')
    return route.fulfill({
      response,
      status: 200,
      headers: {
        ...response.headers(),
        'Content-Length': String(body.length),
        'Content-Type': 'application/vnd.openpencil.scene+zip',
        'Cache-Control': 'no-store'
      },
      body
    })
  })
  await page.goto('/')
  await page.getByTestId('login-A').click()
  await page.getByRole('button', { name: 'A.fig', exact: false }).dblclick()
  await expect(
    page.getByTestId('layers-item').filter({ hasText: 'Image fit' })
  ).toBeVisible({ timeout: 75000 })
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 75000 })
  const scene = page.locator('canvas').first()
  await expect.poll(() => workers).toBeGreaterThanOrEqual(2)
  await expect
    .poll(() =>
      scene.screenshot().then((png) =>
        page.evaluate(
          async (bytes) => {
            const bitmap = await createImageBitmap(
              new Blob([new Uint8Array(bytes)])
            )
            try {
              const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
              const context = canvas.getContext('2d')
              if (!context) return 0
              context.drawImage(bitmap, 0, 0)
              const pixels = context.getImageData(
                0,
                0,
                canvas.width,
                canvas.height
              ).data
              let red = 0
              for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i] > 180 && pixels[i + 1] < 80 && pixels[i + 2] < 80)
                  red++
              }
              return red
            } finally {
              bitmap.close()
            }
          },
          [...png]
        )
      )
    )
    .toBeGreaterThan(2000)
  await expect(scene).toHaveScreenshot('viewport-images.png', {
    maxDiffPixelRatio: 0.01
  })
  await page.setViewportSize({ width: 1300, height: 900 })
  await page.setViewportSize({ width: 1440, height: 960 })
  await expect(scene).toHaveScreenshot('viewport-images.png', {
    maxDiffPixelRatio: 0.01
  })
  await page
    .getByTestId('pages-item')
    .filter({ hasText: 'Image page 2' })
    .click()
  await expect(
    page.getByTestId('layers-item').filter({ hasText: 'Image second page' })
  ).toBeVisible()
  await page.getByTestId('pages-item').first().click()
  await expect(scene).toHaveScreenshot('viewport-images.png', {
    maxDiffPixelRatio: 0.01
  })
  await page.getByRole('link', { name: 'OpenPencil · LAN Portal' }).click()
  await expect(page.locator('canvas')).toHaveCount(0)
  await page.getByRole('button', { name: 'A.fig', exact: false }).dblclick()
  await expect(
    page.getByTestId('layers-item').filter({ hasText: 'Image fit' })
  ).toBeVisible({ timeout: 75000 })
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 75000 })
  await expect(scene).toHaveScreenshot('viewport-images.png', {
    maxDiffPixelRatio: 0.01
  })
  expect(errors).toEqual([])
  expect(external).toEqual([])
})
