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
const opening = (page: Page, documentId = '') =>
  page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/files\/[^/]+\/remote$/.test(new URL(response.url()).pathname) &&
      (!documentId ||
        new URL(response.url()).pathname === `/api/files/${documentId}/remote`)
  )

test('Rapid file switches reuse a tab lease at capacity; tabs sharing one login stay isolated and close independently', async ({
  page
}) => {
  const context = page.context()
  const status = async () =>
    (await (await context.request.get(origin + '/__fixture/status')).json())
      .leases as { id: string; file: string; tab: string }[]
  await login(page)
  await expect(page.getByTestId('server-session-usage')).toHaveText(
    'Server 會話 1/2'
  )
  await expect
    .poll(async () => (await status()).map((lease) => lease.file))
    .toEqual([undefined])
  expect(await page.locator('iframe').count()).toBe(0)
  const warmId = (await status())[0].id
  const firstOpen = opening(page)
  await page.getByRole('button', { name: 'A.fig', exact: true }).dblclick()
  const first = await (await firstOpen).json()
  expect(first.id).toBe(warmId)
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
    await expect(page.getByTestId('server-session-usage')).toHaveText(
      'Server 會話 2/2'
    )
    const overflow = await context.newPage()
    try {
      const clientReads: string[] = []
      overflow.on('request', (request) => {
        if (/\/client-content\?revision=/.test(request.url()))
          clientReads.push(request.url())
      })
      await overflow.goto(origin)
      await expect(overflow.getByTestId('server-session-usage')).toHaveText(
        'Server 會話 2/2'
      )
      await expect(
        overflow.getByRole('button', { name: 'A.fig', exact: true })
      ).toBeVisible()
      await expect(overflow.getByTestId('remote-capacity-notice')).toBeVisible()
      await expect(overflow.getByTestId('client-fallback-prompt')).toHaveCount(
        0
      )
      const rejected = opening(overflow)
      await overflow
        .getByRole('button', { name: 'A.fig', exact: true })
        .dblclick()
      expect((await rejected).status()).toBe(429)
      const prompt = overflow.getByTestId('client-fallback-prompt')
      await expect(prompt).toBeVisible()
      await expect(prompt).toContainText('完整 .fig 將下載到此裝置')
      expect(clientReads).toEqual([])
      await prompt.getByRole('button', { name: '取消', exact: true }).click()
      await expect(prompt).toHaveCount(0)
      expect(clientReads).toEqual([])
      await expect(
        overflow.getByRole('combobox', { name: '開啟方式' })
      ).toHaveValue('server')
      // Retry uses authoritative admission again and asks again only after another429.
      const retry = opening(overflow)
      await overflow
        .getByTestId('remote-capacity-notice')
        .getByRole('button', { name: '重試伺服器', exact: true })
        .click()
      expect((await retry).status()).toBe(429)
      await expect(prompt).toBeVisible()
      await prompt
        .getByRole('button', { name: '改用瀏覽器編輯器', exact: true })
        .click()
      await expect(overflow.getByTestId('client-edit-notice')).toBeVisible({
        timeout: 60000
      })
      await expect(overflow.locator('iframe')).toHaveCount(0)
      expect(clientReads).toHaveLength(1)
      expect(
        await overflow.evaluate(() =>
          sessionStorage.getItem('portal.rendering')
        )
      ).toBe('client')
      expect((await status()).map((lease) => lease.id).sort()).toEqual(
        [first.id, other.id].sort()
      )
    } finally {
      await overflow.close()
    }
    const serverOnly = await context.newPage()
    try {
      await serverOnly.route(origin + '/auth/mode', async (route) => {
        const response = await route.fetch()
        await route.fulfill({
          response,
          json: { ...(await response.json()), allowClientEditor: false }
        })
      })
      const requests: string[] = []
      serverOnly.on('request', (request) => requests.push(request.url()))
      await serverOnly.goto(origin)
      const denied = opening(serverOnly)
      await serverOnly
        .getByRole('button', { name: 'A.fig', exact: true })
        .dblclick()
      expect((await denied).status()).toBe(429)
      await expect(
        serverOnly.getByTestId('remote-capacity-notice')
      ).toBeVisible()
      await expect(
        serverOnly.getByTestId('client-fallback-prompt')
      ).toHaveCount(0)
      await expect(
        serverOnly.getByRole('button', {
          name: '改用瀏覽器編輯器',
          exact: true
        })
      ).toHaveCount(0)
      expect(
        requests.some((url) => /\/client-content\?revision=/.test(url))
      ).toBe(false)
    } finally {
      await serverOnly.close()
    }
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
      await expect(page.getByTestId('client-fallback-prompt')).toHaveCount(0)
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

test('Busy dialog can retry when a slot frees; authentication/source/runtime failures never offer client fallback', async ({
  page
}) => {
  const context = page.context(),
    status = async () =>
      (await (await context.request.get(origin + '/__fixture/status')).json())
        .leases
  await login(page)
  await expect(page.getByTestId('server-session-usage')).toHaveText(
    'Server 會話 1/2'
  )
  const reserved = await context.newPage(),
    blocked = await context.newPage()
  try {
    await reserved.goto(origin)
    await expect.poll(async () => (await status()).length).toBe(2)
    const requests: string[] = []
    blocked.on('request', (request) => requests.push(request.url()))
    await blocked.goto(origin)
    const busy = opening(blocked)
    await blocked.getByRole('button', { name: 'A.fig', exact: true }).dblclick()
    expect((await busy).status()).toBe(429)
    const prompt = blocked.getByTestId('client-fallback-prompt')
    await expect(prompt).toBeVisible()
    await reserved.close()
    await expect.poll(async () => (await status()).length).toBe(1)
    const retried = opening(blocked)
    await prompt
      .getByRole('button', { name: '重試伺服器', exact: true })
      .click()
    expect((await retried).status()).toBe(200)
    await expect(stream(blocked)).toBeVisible()
    await expect(prompt).toHaveCount(0)
    await expect(
      blocked.getByRole('combobox', { name: '開啟方式' })
    ).toHaveValue('server')
    expect(
      requests.some((url) => /\/client-content\?revision=/.test(url))
    ).toBe(false)
    for (const [statusCode, code] of [
      [401, 'login-required'],
      [403, 'permission-denied'],
      [409, 'source-changed'],
      [503, 'remote-process-failed'],
      [503, 'remote-busy']
    ] as const) {
      await blocked
        .getByRole('button', { name: '返回文件列表', exact: true })
        .click()
      await blocked.route(/\/api\/files\/[^/]+\/remote$/, (route) =>
        route.fulfill({ status: statusCode, json: { error: code } })
      )
      const documentId = await blocked
        .getByRole('button', { name: 'B.fig', exact: true })
        .getAttribute('data-file-id')
      const failed = opening(blocked, documentId!)
      await blocked
        .getByRole('button', { name: 'B.fig', exact: true })
        .dblclick()
      expect((await failed).status()).toBe(statusCode)
      await expect(
        blocked.getByText('遠端會話無法啟動，請查看伺服器日誌。', {
          exact: true
        })
      ).toBeVisible()
      await expect(prompt).toHaveCount(0)
      await expect(blocked.getByTestId('remote-capacity-notice')).toHaveCount(0)
      await blocked.unroute(/\/api\/files\/[^/]+\/remote$/)
    }
    expect(
      requests.some((url) => /\/client-content\?revision=/.test(url))
    ).toBe(false)
  } finally {
    if (!reserved.isClosed()) await reserved.close()
    await blocked.close()
    await page.close()
    await expect.poll(async () => (await status()).length).toBe(0)
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
  await request.post(origin + '/__fixture/pause-startup', {
    data: { paused: true }
  })
  try {
    await login(page)
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

test('An expired retained session can be replaced from the list without reloading the browser tab', async ({
  page
}) => {
  await page.clock.install()
  await login(page)
  await expect(page.getByTestId('server-session-usage')).toHaveText(
    'Server 會話 1/2'
  )
  await page.getByRole('button', { name: 'A.fig', exact: true }).dblclick()
  await expect(stream(page)).toBeVisible()
  const old = (
    await (await page.request.get(origin + '/__fixture/status')).json()
  ).leases[0]
  const me = await (await page.request.get(origin + '/api/me')).json()
  const stopped = await page.request.post(
    origin + `/api/remote/${old.id}/stop`,
    { headers: { Origin: origin, 'X-CSRF-Token': me.csrf } }
  )
  expect(stopped.status()).toBe(200)
  await page.clock.fastForward(31000)
  await expect(
    page.getByText('會話已到期或來源不可用，請重新開啟文件。')
  ).toBeVisible()
  await page.getByRole('button', { name: '返回文件列表', exact: true }).click()
  await expect
    .poll(
      async () =>
        (await (await page.request.get(origin + '/__fixture/status')).json())
          .leases.length
    )
    .toBe(1)
  const fresh = (
    await (await page.request.get(origin + '/__fixture/status')).json()
  ).leases[0]
  expect(fresh.id).not.toBe(old.id)
  const next = opening(page)
  await page.getByRole('button', { name: 'A.fig', exact: true }).dblclick()
  expect((await (await next).json()).id).toBe(fresh.id)
  await expect(stream(page)).toBeVisible()
  await page.close()
  await expect
    .poll(
      async () =>
        (await (await page.request.get(origin + '/__fixture/status')).json())
          .leases.length
    )
    .toBe(0)
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
  // A saved client preference starts cold, without reserving a server session.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('portal.rendering'))
      sessionStorage.setItem('portal.rendering', 'client')
  })
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
  const serverLease = (
    await (await page.request.get(origin + '/__fixture/status')).json()
  ).leases[0]
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
    .toBe(1)
  await expect
    .poll(
      async () =>
        (await (await page.request.get(origin + '/__fixture/status')).json())
          .leases[0]?.parked
    )
    .toBe(true)
  await expect(page.locator('iframe')).toHaveCount(0)
  const resume = opening(page)
  await page.getByRole('combobox', { name: '開啟方式' }).selectOption('server')
  expect((await (await resume).json()).id).toBe(serverLease.id)
  await expect(stream(page)).toBeVisible()
  const resumed = (
    await (await page.request.get(origin + '/__fixture/status')).json()
  ).leases[0]
  expect(resumed.generation).toBe(serverLease.generation)
  await page.getByRole('button', { name: '登出', exact: true }).click()
  await expect(
    page.getByRole('link', { name: 'Google Workspace 登入' })
  ).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
})
