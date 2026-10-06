import { test, expect, type Page } from '@playwright/test'
import { fixtureCode } from '../helpers/google-mount-fixture.ts'
const origin = 'http://127.0.0.1:3216'
async function login(page: Page, account = 'A') {
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
            code: fixtureCode(url, account)
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
const status = async (page: Page) =>
  (await (await page.request.get(origin + '/__fixture/status')).json())
    .leases as { id: string; file?: string; blankIdleMs?: number }[]

test('Account quota spans browser logins and offers explicit client fallback while global slots remain free', async ({
  page,
  browser
}) => {
  const otherContext = await browser.newContext(),
    other = await otherContext.newPage(),
    blocked = await page.context().newPage()
  const reads: string[] = []
  blocked.on('request', (request) => {
    if (request.url().includes('/client-content?')) reads.push(request.url())
  })
  try {
    await login(page)
    await page.getByRole('button', { name: 'A.fig', exact: true }).dblclick()
    await expect(stream(page)).toBeVisible()
    await login(other)
    await other.getByRole('button', { name: 'B.fig', exact: true }).dblclick()
    await expect(stream(other)).toBeVisible()
    await expect(page.getByTestId('account-session-usage')).toHaveText(
      '我的會話 2/2'
    )
    await blocked.goto(origin)
    await expect(blocked.getByTestId('server-session-usage')).toHaveText(
      'Server 會話 2/4'
    )
    await expect(blocked.getByTestId('remote-capacity-notice')).toContainText(
      '此帳號的伺服器會話已達上限'
    )
    const refused = blocked.waitForResponse(
      (response) =>
        /\/api\/files\/[^/]+\/remote$/.test(response.url()) &&
        response.request().method() === 'POST'
    )
    await blocked.getByRole('button', { name: 'A.fig', exact: true }).dblclick()
    expect((await refused).status()).toBe(429)
    expect((await (await refused).json()).error).toBe('remote-account-limit')
    const prompt = blocked.getByTestId('client-fallback-prompt')
    await expect(prompt).toContainText('此帳號的會話已達上限')
    expect(reads).toEqual([])
    await prompt.getByRole('button', { name: '取消', exact: true }).click()
    expect(reads).toEqual([])
    await blocked
      .getByTestId('remote-capacity-notice')
      .getByRole('button', { name: '改用瀏覽器編輯器', exact: true })
      .click()
    await prompt
      .getByRole('button', { name: '改用瀏覽器編輯器', exact: true })
      .click()
    await expect(blocked.getByTestId('client-edit-notice')).toBeVisible()
    expect(reads).toHaveLength(1)
    expect(await status(page)).toHaveLength(2)
    const original = (await status(page)).find(
      (lease) => lease.file === 'A.fig'
    )!.id
    await page
      .getByRole('button', { name: '返回文件列表', exact: true })
      .click()
    await page.getByRole('button', { name: 'B.fig', exact: true }).dblclick()
    await expect(stream(page)).toBeVisible()
    expect((await status(page)).some((lease) => lease.id === original)).toBe(
      true
    )
    await other.close()
    await expect.poll(async () => (await status(page)).length).toBe(1)
    const retry = blocked.waitForResponse(
      (response) =>
        /\/api\/files\/[^/]+\/remote$/.test(response.url()) &&
        response.request().method() === 'POST'
    )
    await blocked
      .getByRole('combobox', { name: '開啟方式' })
      .selectOption('server')
    expect((await retry).status()).toBe(200)
    await expect(stream(blocked)).toBeVisible()
  } finally {
    await otherContext.close()
    await blocked.close()
    await page.close()
    await expect.poll(async () => (await status(page)).length).toBe(0)
  }
})

test('An idle blank is reclaimed under quota pressure, reports release, and reallocates on explicit retry', async ({
  page
}) => {
  await page.clock.install()
  await login(page)
  await expect(page.getByTestId('account-session-usage')).toHaveText(
    '我的會話 1/2'
  )
  const blankId = (await status(page))[0].id
  const loaded = await page.context().newPage(),
    newcomer = await page.context().newPage()
  try {
    await loaded.goto(origin)
    await loaded.getByRole('button', { name: 'A.fig', exact: true }).dblclick()
    await expect(stream(loaded)).toBeVisible()
    const loadedId = (await status(page)).find(
      (lease) => lease.file === 'A.fig'
    )!.id
    // With no competing admission, the server's idle threshold does not evict the blank.
    await expect
      .poll(
        async () =>
          (await status(page)).find((lease) => lease.id === blankId)
            ?.blankIdleMs ?? 0
      )
      .toBeGreaterThanOrEqual(1000)
    await newcomer.goto(origin)
    await expect
      .poll(async () =>
        (await status(page)).some((lease) => lease.id === blankId)
      )
      .toBe(false)
    expect((await status(page)).some((lease) => lease.id === loadedId)).toBe(
      true
    )
    await page.clock.fastForward(31000)
    await expect(page.getByTestId('remote-prewarm-released')).toBeVisible()
    expect(await status(page)).toHaveLength(2) // No automatic reacquisition or fallback.
    const newcomerId = (await status(page)).find((lease) => !lease.file)!.id
    await expect
      .poll(
        async () =>
          (await status(page)).find((lease) => lease.id === newcomerId)
            ?.blankIdleMs ?? 0
      )
      .toBeGreaterThanOrEqual(1000)
    await page.getByRole('button', { name: 'A.fig', exact: true }).dblclick()
    await expect(stream(page)).toBeVisible()
    expect((await status(page)).some((lease) => lease.id === newcomerId)).toBe(
      false
    )
    expect((await status(page)).some((lease) => lease.id === loadedId)).toBe(
      true
    )
  } finally {
    await newcomer.close()
    await loaded.close()
    await page.close()
    await expect.poll(async () => (await status(page)).length).toBe(0)
  }
})
