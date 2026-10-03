import { serve } from '@hono/node-server'
import { resolve } from 'node:path'
import { rmSync } from 'node:fs'
import { createGoogleFixture } from '../helpers/google-mount-fixture.ts'
const base = resolve('.work/raster-e2e')
rmSync(base, { recursive: true, force: true })
const fixture = await createGoogleFixture(base, 3214, {
  viewerMode: 'raster',
  sourceRoot: process.env.REAL_FIG_FIXTURE_ROOT
})
const server = serve({
  fetch: fixture.portal.app.fetch,
  hostname: '127.0.0.1',
  port: 3214
})
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () =>
    server.close(() => {
      fixture.close()
      process.exit(0)
    })
  )
