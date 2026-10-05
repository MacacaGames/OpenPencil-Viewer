// Copy into a disposable, installed upstream checkout's scratch/ directory.
import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { platform, arch } from 'node:os'

const route = process.argv[2] ?? '/fixture.fig'
const output = process.argv[3] ?? 'public-browser-result.json'
if (!['/fixture.fig', '/control.fig', '/decode-control.fig'].includes(route))
  throw new Error('Use a known public fixture route')
const browser = await chromium.launch({
  channel: process.env.OPENPENCIL_REPRO_BROWSER_CHANNEL,
  headless: true,
  args: ['--enable-unsafe-swiftshader']
})
const context = await browser.newContext({
  viewport: { width: 1400, height: 960 },
  deviceScaleFactor: 1,
  serviceWorkers: 'block'
})
await context.route('**/*', (request) =>
  new URL(request.request().url()).hostname === '127.0.0.1'
    ? request.continue()
    : request.abort()
)
const page = await context.newPage()
const events: Array<Record<string, unknown>> = []
const errors: string[] = []
let crashed = false
page.on('crash', () => {
  crashed = true
})
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  const value = message.text()
  if (value.startsWith('PUBLIC_REPRO ')) {
    const event = JSON.parse(value.slice(13)) as Record<string, unknown>
    if (typeof event.stack === 'string')
      event.stack = event.stack
        .replace(
          /http:\/\/127\.0\.0\.1:14320\/@fs\/.*?\/node_modules\//g,
          'http://localhost/UPSTREAM/node_modules/'
        )
        .replaceAll('http://127.0.0.1:14320/', 'http://localhost/')
    events.push(event)
    console.log('PUBLIC_REPRO ' + JSON.stringify(event))
  } else if (message.type() === 'error') errors.push(value)
})
let outcome: unknown = null
try {
  await page.goto(
    'http://127.0.0.1:14320/browser-image-memory.html?fixture=' +
      encodeURIComponent(route),
    { timeout: 45_000 }
  )
  await page.waitForFunction(
    () => Reflect.get(window, 'publicReproOutcome'),
    null,
    {
      timeout: 180_000
    }
  )
  outcome = await page.evaluate(() => Reflect.get(window, 'publicReproOutcome'))
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error))
  outcome = crashed ? 'renderer-crash' : 'driver-error-or-timeout'
} finally {
  await writeFile(
    output,
    JSON.stringify(
      {
        fixtureRoute: route,
        scope:
          'Direct upstream browser parser and WebGL renderer; no app storage/session/collaboration',
        browserVersion: browser.version(),
        hostPlatform: platform(),
        hostArch: arch(),
        launchArgs: ['--enable-unsafe-swiftshader'],
        deviceScaleFactor: 1,
        stackPathsRedacted: true,
        outcome,
        crashed,
        events,
        errors
      },
      null,
      2
    ) + '\n'
  )
  console.log('RESULT ' + JSON.stringify({ outcome, crashed, errors }))
  await context.close().catch(() => {})
  await browser.close().catch(() => {})
}
