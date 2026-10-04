import { test, expect } from '@playwright/test'
import { fixtureCode } from '../helpers/google-mount-fixture.ts'
const origin = process.env.REMOTE_TEST_ORIGIN ?? 'http://127.0.0.1:24682'
test('real Linux Selkies H.264, resize, logout and source integrity (synthetic only)', async ({
  page
}) => {
  const requests: string[] = [],
    packets: number[] = []
  let account = 'A'
  page.on('request', (request) => requests.push(request.url()))
  await page.addInitScript(() => {
    const seen = new WeakSet<HTMLVideoElement>()
    const observe = () =>
      document.querySelectorAll('video').forEach((video) => {
        if (seen.has(video)) return
        seen.add(video)
        video.requestVideoFrameCallback(() =>
          Reflect.set(
            window,
            '__portalFirstDecodedFrameAt',
            performance.timeOrigin + performance.now()
          )
        )
      })
    new MutationObserver(observe).observe(document, {
      childList: true,
      subtree: true
    })
    observe()
  })
  page.on('console', (message) => {
    if (
      /handleResizeUI|Sending resolution|Auto-resize skipped|Cannot send resolution/.test(
        message.text()
      )
    )
      console.log(message.text())
  })
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      if (Buffer.isBuffer(payload)) packets.push(payload.length)
    })
  )
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
            state: url.searchParams.get('state')!,
            code: fixtureCode(url, account)
          })
      }
    })
  })
  await page.goto(origin)
  await page.getByRole('link', { name: 'Google Workspace 登入' }).click()
  const before = await (
    await page.request.get(origin + '/__fixture/status')
  ).json()
  const start = Date.now()
  await page.getByRole('button', { name: /^A.fig/ }).dblclick()
  const frame = page.frameLocator('iframe[title="OpenPencil 遠端唯讀畫面"]')
  const video = frame.locator('video').first()
  await Promise.race([
    video.waitFor({ state: 'visible', timeout: 150000 }),
    page
      .getByText('遠端會話無法啟動，請查看伺服器日誌。', { exact: true })
      .waitFor({ state: 'visible', timeout: 150000 })
      .then(() => {
        throw new Error(
          'native container session failed; inspect container logs'
        )
      })
  ])
  await expect
    .poll(
      () =>
        video.evaluate(
          (element) =>
            (element as HTMLVideoElement).getVideoPlaybackQuality()
              .totalVideoFrames
        ),
      { timeout: 15000 }
    )
    .toBeGreaterThan(0)
  const rendered = await video.evaluate((element) => ({
    width: (element as HTMLVideoElement).videoWidth,
    height: (element as HTMLVideoElement).videoHeight
  }))
  const firstDecodedFrameMs =
    (await video.evaluate(() =>
      Number(Reflect.get(window, '__portalFirstDecodedFrameAt'))
    )) - start
  expect(firstDecodedFrameMs).toBeGreaterThan(0)
  const firstLease = (
    await (await page.request.get(origin + '/__fixture/status')).json()
  ).lease
  expect(rendered.width).toBeGreaterThan(64)
  expect(packets.length).toBeGreaterThan(0)
  const framesBefore = await video.evaluate(
    (v) => (v as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames
  )
  const box = await video.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.keyboard.down('Control')
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120)
  await page.keyboard.up('Control')
  await page.keyboard.down('Space')
  await page.mouse.down()
  await page.mouse.move(
    box!.x + box!.width / 2 + 100,
    box!.y + box!.height / 2 + 70,
    { steps: 8 }
  )
  await page.mouse.up()
  await page.keyboard.up('Space')
  await expect
    .poll(
      () =>
        video.evaluate(
          (v) =>
            (v as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames
        ),
      { timeout: 15000 }
    )
    .toBeGreaterThan(framesBefore)
  expect(requests.some((url) => /\/(scene|content)(?:\?|$)/.test(url))).toBe(
    false
  )
  await page.setViewportSize({ width: 1100, height: 720 })
  console.log(
    'resize state',
    await frame.locator('body').evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      enabled: Reflect.get(window, 'enable_resize'),
      manual: Reflect.get(window, 'manual_resolution')
    }))
  )
  await expect
    .poll(() => video.evaluate((v) => (v as HTMLVideoElement).videoWidth), {
      timeout: 15000
    })
    .toBeLessThanOrEqual(1100)
  console.log(
    JSON.stringify({
      host: 'local Docker test; not Unraid GPU acceptance',
      firstDecodedFrameMs,
      initialResolution: rendered,
      streamBytes: packets.reduce((sum, n) => sum + n, 0)
    })
  )
  await page.getByRole('button', { name: '登出', exact: true }).click()
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect
    .poll(
      async () =>
        (await (await page.request.get(origin + '/__fixture/status')).json())
          .profiles
    )
    .toEqual([])
  const after = await (
    await page.request.get(origin + '/__fixture/status')
  ).json()
  expect(after.sourceHash).toBe(before.sourceHash)
  expect(after.sourceMtime).toBe(before.sourceMtime)
  account = 'B'
  await page.getByRole('link', { name: 'Google Workspace 登入' }).click()
  const warmStart = Date.now()
  await page.getByRole('button', { name: /^A.fig/ }).dblclick()
  await expect(frame.locator('video').first()).toBeVisible({ timeout: 150000 })
  await expect
    .poll(
      () =>
        frame
          .locator('video')
          .first()
          .evaluate(
            (v) =>
              (v as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames
          ),
      { timeout: 15000 }
    )
    .toBeGreaterThan(0)
  const second = await (
    await page.request.get(origin + '/__fixture/status')
  ).json()
  expect(second.lease).not.toBe(firstLease)
  expect(second.profiles).toEqual([second.lease])
  console.log(
    JSON.stringify({
      host: 'local Docker synthetic',
      warmOtherUserFirstDecodedFrameMs: Date.now() - warmStart,
      profilesIsolated: true
    })
  )
  await page.getByRole('button', { name: '登出', exact: true }).click()
  await expect
    .poll(
      async () =>
        (await (await page.request.get(origin + '/__fixture/status')).json())
          .profiles
    )
    .toEqual([])
})
