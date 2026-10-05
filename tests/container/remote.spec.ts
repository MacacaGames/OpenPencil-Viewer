import { test, expect } from '@playwright/test'
import { fixtureCode } from '../helpers/google-mount-fixture.ts'
const origin = process.env.REMOTE_TEST_ORIGIN ?? 'http://127.0.0.1:24682'
test.use({ deviceScaleFactor: 2 })
test('real Linux Selkies H.264, resize, logout and source integrity (synthetic only)', async ({
  page,
  browser
}) => {
  const requests: string[] = [],
    packets: number[] = [],
    reportedStreams = new Set<string>()
  const account = 'A'
  let approvedDisplay: { width: number; height: number } | undefined
  page.on('response', (response) => {
    if (
      response.ok() &&
      response.request().method() === 'POST' &&
      /\/api\/(?:files\/[^/]+\/remote|remote\/[^/]+\/display)$/.test(
        new URL(response.url()).pathname
      )
    )
      void response
        .json()
        .then((body) => {
          approvedDisplay = body.display
        })
        .catch(() => undefined)
  })
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
      else {
        try {
          const message = JSON.parse(payload)
          if (message.type === 'stream_info') reportedStreams.add(socket.url())
        } catch {
          // Ordinary Selkies control messages are not JSON.
        }
      }
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
  const frame = page.frameLocator('iframe[title="OpenPencil 遠端畫面"]')
  const video = frame.locator('video').first()
  const decodedSize = () =>
    video.evaluate((element) => ({
      width: (element as HTMLVideoElement).videoWidth,
      height: (element as HTMLVideoElement).videoHeight
    }))
  const waitForDisplay = async () => {
    await expect
      .poll(
        async () => {
          const actual = await decodedSize()
          const approved = approvedDisplay
          // X11/capture may align a few pixels. A decoded bootstrap frame is not ready.
          return (
            !!approved &&
            Math.abs(actual.width - approved.width) <= 8 &&
            Math.abs(actual.height - approved.height) <= 8 &&
            actual.width <= 1920 &&
            actual.height <= 1080
          )
        },
        {
          timeout: 20000,
          message: 'decoded H.264 must converge to the authorized viewport size'
        }
      )
      .toBe(true)
    return decodedSize()
  }
  const nextDisplay = () =>
    page.waitForResponse(
      (response) =>
        response.ok() &&
        response.request().method() === 'POST' &&
        /\/api\/remote\/[^/]+\/display$/.test(new URL(response.url()).pathname)
    )
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
  const rendered = await waitForDisplay()
  const firstDecodedFrameMs =
    (await video.evaluate(() =>
      Number(Reflect.get(window, '__portalFirstDecodedFrameAt'))
    )) - start
  expect(firstDecodedFrameMs).toBeGreaterThan(0)
  const firstLease = (
    await (await page.request.get(origin + '/__fixture/status')).json()
  ).lease
  expect(rendered.width).toBeGreaterThan(64)
  expect(rendered.width).toBeGreaterThan(1440)
  expect(rendered.width).toBeLessThanOrEqual(1920)
  expect(rendered.height).toBeLessThanOrEqual(1080)
  expect(packets.length).toBeGreaterThan(0)
  await page.screenshot({ path: '.work/selkies-ci/session-edit-stream.png' })
  const nativeZoom = async (id: string) => {
    const status = await (
      await page.request.get(origin + '/__fixture/status')
    ).json()
    return status.leases.find((lease: { id: string }) => lease.id === id)
      ?.zoom as number | undefined
  }
  await expect.poll(() => nativeZoom(firstLease)).toBeGreaterThan(0)
  const zoomBefore = (await nativeZoom(firstLease))!
  const framesBefore = await video.evaluate(
    (v) => (v as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames
  )
  const box = await video.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.keyboard.down('Control')
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120)
  await page.keyboard.up('Control')
  await expect.poll(() => nativeZoom(firstLease)).toBeGreaterThan(zoomBefore)
  const afterCtrl = (await nativeZoom(firstLease))!
  await page.keyboard.down('Meta')
  await page.mouse.wheel(0, -120)
  await page.keyboard.up('Meta')
  await expect.poll(() => nativeZoom(firstLease)).toBeGreaterThan(afterCtrl)
  const afterMeta = (await nativeZoom(firstLease))!
  // Pinch has ctrlKey without a preceding physical keydown.
  await video.evaluate((element) => {
    const box = element.getBoundingClientRect()
    element.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -100,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2
      })
    )
  })
  await expect.poll(() => nativeZoom(firstLease)).toBeGreaterThan(afterMeta)
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
  const resized = nextDisplay()
  await page.setViewportSize({ width: 1100, height: 720 })
  approvedDisplay = (await (await resized).json()).display
  console.log(
    'resize state',
    await frame.locator('body').evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      enabled: Reflect.get(window, 'enable_resize'),
      manual: Reflect.get(window, 'manual_resolution')
    }))
  )
  const resizedDisplay = await waitForDisplay()
  expect(resizedDisplay.width).not.toBe(rendered.width)
  const beforeUi = await video.evaluate(
    (v) => (v as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames
  )
  const uiChanged = nextDisplay()
  await page.getByRole('combobox', { name: '遠端文字大小' }).selectOption('1.5')
  await uiChanged
  await expect
    .poll(() =>
      video.evaluate(
        (v) =>
          (v as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames
      )
    )
    .toBeGreaterThan(beforeUi)
  const expanded = nextDisplay()
  await page.getByRole('button', { name: '全螢幕', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(true)
  approvedDisplay = (await (await expanded).json()).display
  await waitForDisplay()
  await page.evaluate(() => document.exitFullscreen())
  console.log(
    JSON.stringify({
      host: 'local Docker test; not Unraid GPU acceptance',
      firstDecodedFrameMs,
      initialResolution: rendered,
      streamBytes: packets.reduce((sum, n) => sum + n, 0)
    })
  )
  await expect.poll(() => reportedStreams.size).toBe(1)

  const secondContext = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 2
  })
  const secondPage = await secondContext.newPage()
  try {
    await secondPage.route(origin + '/auth/google/start', async (route) => {
      const start = await route.fetch({ maxRedirects: 0 }),
        url = new URL(start.headers().location)
      await route.fulfill({
        response: start,
        headers: {
          ...start.headers(),
          location:
            origin +
            '/auth/google/callback?' +
            new URLSearchParams({
              state: url.searchParams.get('state')!,
              code: fixtureCode(url, 'B')
            })
        }
      })
    })
    await secondPage.goto(origin)
    await secondPage
      .getByRole('link', { name: 'Google Workspace 登入' })
      .click()
    secondPage.on('request', (request) => requests.push(request.url()))
    const secondStreams = new Set<string>()
    secondPage.on('websocket', (socket) =>
      socket.on('framereceived', ({ payload }) => {
        if (typeof payload === 'string') {
          try {
            if (JSON.parse(payload).type === 'stream_info')
              secondStreams.add(socket.url())
          } catch {}
        }
      })
    )
    const warmStart = Date.now()
    await secondPage.getByRole('button', { name: /^A.fig/ }).dblclick()
    const secondVideo = secondPage
      .frameLocator('iframe[title="OpenPencil 遠端畫面"]')
      .locator('video')
      .first()
    await expect(secondVideo).toBeVisible({ timeout: 150000 })
    await expect
      .poll(
        () =>
          secondVideo.evaluate(
            (element) =>
              (element as HTMLVideoElement).getVideoPlaybackQuality()
                .totalVideoFrames
          ),
        { timeout: 20000 }
      )
      .toBeGreaterThan(0)
    await expect
      .poll(
        () =>
          secondVideo.evaluate(
            (element) => (element as HTMLVideoElement).videoWidth
          ),
        { timeout: 20000 }
      )
      .toBeGreaterThan(1440)
    const both = await (
      await page.request.get(origin + '/__fixture/status')
    ).json()
    expect(both.leases).toHaveLength(2)
    const secondLease = both.leases.find(
      (lease: { id: string }) => lease.id !== firstLease
    ).id
    expect(both.profiles.sort()).toEqual([firstLease, secondLease].sort())
    await expect.poll(() => nativeZoom(secondLease)).toBeGreaterThan(0)
    const secondZoom = (await nativeZoom(secondLease))!
    expect(secondZoom).not.toBe(await nativeZoom(firstLease))
    await expect.poll(() => secondStreams.size).toBe(1)
    console.log(
      JSON.stringify({
        host: 'local Docker synthetic',
        concurrentUsers: 2,
        otherUserFirstDecodedFrameMs: Date.now() - warmStart,
        profilesIsolated: true,
        ctrlMetaPinchZoomVerified: true
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
      .toEqual([secondLease])
    await expect(secondVideo).toBeVisible()
    const secondBox = await secondVideo.boundingBox()
    expect(secondBox).not.toBeNull()
    await secondPage.mouse.move(
      secondBox!.x + secondBox!.width / 2,
      secondBox!.y + secondBox!.height / 2
    )
    await secondPage.keyboard.down('Control')
    await secondPage.mouse.wheel(0, -120)
    await secondPage.keyboard.up('Control')
    await expect.poll(() => nativeZoom(secondLease)).toBeGreaterThan(secondZoom)
    expect(requests.some((url) => /\/(scene|content)(?:\?|$)/.test(url))).toBe(
      false
    )
    await secondPage.getByRole('button', { name: '登出', exact: true }).click()
    await expect(secondPage.locator('iframe')).toHaveCount(0)
    await expect(
      secondPage.getByRole('link', { name: 'Google Workspace 登入' })
    ).toBeVisible()
    await expect
      .poll(
        async () =>
          (await (await page.request.get(origin + '/__fixture/status')).json())
            .profiles
      )
      .toEqual([])
    const final = await (
      await page.request.get(origin + '/__fixture/status')
    ).json()
    expect(final.sourceHash).toBe(before.sourceHash)
    expect(final.sourceMtime).toBe(before.sourceMtime)
  } finally {
    await secondContext.close()
  }
})
