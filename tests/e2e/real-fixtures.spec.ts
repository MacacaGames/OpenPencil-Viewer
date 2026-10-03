import { test, expect } from '@playwright/test'
import {
  readdirSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  createReadStream
} from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { parseScene } from '../../apps/api/scene.ts'
import { SCENE_TYPE } from '../../packages/transport/scene-wire.ts'
import type { AddressInfo } from 'node:net'

// Explicit opt-in: operator-approved files, fed only to a localhost Mock browser.
// Routes substitute server-parsed scenes/metadata; this is not NAS authz acceptance.
test.use({ screenshot: 'off', trace: 'off', video: 'off' })
test('approved real FIGs load in native readonly UI without external document traffic', async ({
  browser
}) => {
  const root = process.env.REAL_FIG_FIXTURE_ROOT
  test.skip(!root, 'No operator-approved real fixtures configured')
  const paths = readdirSync(root!)
    .filter((n) => n.toLowerCase().endsWith('.fig'))
    .map((n) => join(root!, n))
    .sort((a, b) => lstatSync(a).size - lstatSync(b).size)
  expect(paths.length).toBeGreaterThan(0)
  expect(paths.length).toBeLessThanOrEqual(10)
  test.setTimeout(paths.length * 90000)
  const rows = []
  for (const path of paths) {
    const before = lstatSync(path)
    expect(
      before.isFile() && before.nlink === 1 && before.size <= 536870912
    ).toBe(true)
    const hash = createHash('sha256').update(readFileSync(path)).digest('hex')
    let revision = ''
    // Streaming avoids Playwright's base64 fulfilment limit for large fixtures.
    // A short-lived loopback endpoint with an unpredictable path is test-only.
    const fixturePath = '/' + randomUUID()
    const server = createServer(async (request, response) => {
      if (request.method !== 'GET' || request.url !== fixturePath) {
        response.writeHead(404).end()
        return
      }
      try {
        const packed = await parseScene(
          createReadStream(path),
          before.size,
          AbortSignal.timeout(60000)
        )
        response.writeHead(200, {
          'Content-Type': SCENE_TYPE,
          'Content-Length': String(packed.length),
          'X-Document-Revision': revision,
          'Access-Control-Allow-Origin': 'http://127.0.0.1:3212',
          'Access-Control-Allow-Credentials': 'true',
          'Cache-Control': 'no-store'
        })
        response.end(packed)
      } catch {
        response.writeHead(422).end()
      }
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const fixtureOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const context = await browser.newContext({
      baseURL: 'http://127.0.0.1:3212',
      viewport: { width: 1440, height: 960 }
    })
    const page = await context.newPage()
    const external: string[] = [],
      errors: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (
        ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) &&
        url.origin !== 'http://127.0.0.1:3212' &&
        url.origin !== fixtureOrigin
      )
        external.push(url.origin)
    })
    page.on('pageerror', (error) => errors.push(error.name))
    page.on('console', async (message) => {
      if (
        message.type() === 'error' &&
        /(?:Type|Reference|Range)Error:/.test(message.text())
      ) {
        errors.push('console-runtime-error')
        const stacks = await Promise.all(
          message
            .args()
            .map((arg) =>
              arg
                .evaluate((value) =>
                  value instanceof Error ? value.stack : ''
                )
                .catch(() => '')
            )
        )
        writeFileSync(
          '.work/real-ui-error-stack.txt',
          stacks.filter(Boolean).join('\n')
        )
      }
    })
    await page.route('http://127.0.0.1:3212/api/files/**', async (route) => {
      if (route.request().url().endsWith('/scene')) {
        await route.continue({ url: fixtureOrigin + fixturePath })
      } else {
        const response = await route.fetch(),
          metadata = await response.json()
        if (!response.ok()) return route.fulfill({ response })
        revision = metadata.revision
        await route.fulfill({
          response,
          json: { ...metadata, name: 'Approved fixture.fig', size: before.size }
        })
      }
    })
    try {
      await page.goto('/')
      await page.getByTestId('login-A').click()
      await expect(
        page.getByRole('button', { name: 'A.fig', exact: false })
      ).toBeVisible()
      const start = Date.now()
      await page.getByRole('button', { name: 'A.fig', exact: false }).dblclick()
      await expect(page.getByTestId('portal-document-name')).toHaveText(
        'Approved fixture.fig'
      )
      await expect(page.getByRole('status')).toHaveCount(0, { timeout: 75000 })
      await expect(page.locator('canvas').first()).toBeVisible()
      const pages = await page.getByTestId('pages-item').count()
      expect(pages).toBeGreaterThan(0)
      expect(await page.getByTestId('layers-item').count()).toBeGreaterThan(0)
      await expect(page.getByTestId('pages-add')).toBeDisabled()
      await expect(page.getByTestId('properties-tab-ai')).toHaveCount(0)
      expect(external).toEqual([])
      expect(errors).toEqual([])
      rows.push({
        fixtureOrdinal: rows.length + 1,
        bytes: before.size,
        pages,
        clickToNativeUIReadyMs: Date.now() - start
      })
      expect(
        createHash('sha256').update(readFileSync(path)).digest('hex')
      ).toBe(hash)
      expect(lstatSync(path).mtimeMs).toBe(before.mtimeMs)
    } finally {
      await context.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
  writeFileSync(
    '.work/real-ui-measurements.json',
    JSON.stringify(
      {
        kind: 'localhost-mock-routed-real-fixture-browser',
        rows,
        notMeasured: [
          'NAS authorization',
          'NAS disk/LAN',
          'GPU memory',
          'visual fidelity'
        ]
      },
      null,
      2
    ) + '\n'
  )
})
