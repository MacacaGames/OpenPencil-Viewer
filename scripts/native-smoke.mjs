import { chromium } from '@playwright/test'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:3211/?test')
  await page.waitForFunction(
    () => document.querySelectorAll('canvas').length >= 2,
    null,
    { timeout: 120000 }
  )
  const body = await page.locator('body').innerText()
  for (const panel of ['Pages', 'Layers', 'Design'])
    if (!body.includes(panel)) throw new Error('Native panel missing: ' + panel)
  await page.screenshot({ path: '.work/native-smoke.png' })
  console.log(
    JSON.stringify({
      canvases: await page.locator('canvas').count(),
      panels: true,
      errors
    })
  )
} finally {
  await browser.close()
}
