import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { bodyLimit } from 'hono/body-limit'
import { Readable } from 'node:stream'
import { parseScene, SceneCache } from './scene.ts'
import { SCENE_TYPE } from '../../packages/transport/scene-wire.ts'
import { ViewerRenderer } from './viewer.ts'
import {
  RemoteSessions,
  remoteErrorCode,
  type RemoteWorker
} from './remote-sessions.ts'
import { LocalRemoteWorker } from './remote-worker.ts'
import { ThumbnailCache } from './thumbnails.ts'
import { remoteDisplay } from '../../packages/contracts/remote-display.ts'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { assertRemoteMount } from './remote-mount.ts'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseViewport } from '../../packages/contracts/viewer.ts'
import type { JWTVerifyGetKey } from 'jose'
import { constants, openSync, closeSync, fstatSync, readSync } from 'node:fs'
import { NasBridge } from '../../packages/nas-bridge/index.ts'
import type { Config } from './config.ts'
import { State, digest } from './state.ts'
import { googleStart, exchangeGoogle } from './oidc.ts'
import {
  parseDirectory,
  resolvePrincipal,
  checkIdentityClaims
} from '../../packages/nas-identity/index.ts'
import {
  AppError,
  type Principal,
  type VerifiedIdentity,
  type FileRecord
} from '../../packages/contracts/index.ts'
import { FileIndex } from '../../packages/filesystem/index.ts'
import {
  type AuthorizationProvider,
  MockAuthorization,
  GoogleMountAuthorization,
  DsmStrictAuthorization
} from '../../packages/authorization/index.ts'
export function createPortal(
  config: Config,
  options: {
    authorization?: AuthorizationProvider
    index?: FileIndex
    googleTokenKeys?: JWTVerifyGetKey
    remoteWorker?: RemoteWorker
  } = {}
) {
  if (
    (options.googleTokenKeys || options.remoteWorker) &&
    (config.environment !== 'development' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(
        new URL(config.origin).hostname
      ) ||
      !['127.0.0.1', '::1'].includes(config.host))
  )
    throw new Error('Test OIDC keys are loopback development only')
  const expectedSource = process.env.NAS_EXPECTED_SOURCE
  const verifiedNas =
    config.environment === 'production' &&
    config.authorizationMode === 'google-mount' &&
    (config.viewerMode === 'selkies' || Boolean(expectedSource))
  const app = new Hono(),
    state = new State(config.statePath),
    index =
      options.index ??
      new FileIndex(
        config.roots,
        config.maxFileBytes,
        verifiedNas
          ? () => assertRemoteMount(config.roots, expectedSource)
          : undefined
      )
  const scenes = new SceneCache()
  const viewer = new ViewerRenderer(config.webPath)
  const thumbnails = new ThumbnailCache()
  let parsing = false
  try {
    if (!options.index) index.restore(state.loadIndex())
  } catch (error) {
    state.close()
    throw error
  }
  const mockRoot = config.roots[0]?.id
  const authz: AuthorizationProvider =
    options.authorization ??
    (config.authorizationMode === 'mock'
      ? new MockAuthorization(
          new Map([
            [
              'A',
              new Set(
                ['', 'A.fig', 'Shared.fig'].map((p) => mockRoot + '/' + p)
              )
            ],
            [
              'B',
              new Set(
                ['', 'B.fig', 'Shared.fig'].map((p) => mockRoot + '/' + p)
              )
            ]
          ])
        )
      : config.authorizationMode === 'google-mount'
        ? new GoogleMountAuthorization(
            new Set(config.roots.map((root) => root.id))
          )
        : new DsmStrictAuthorization(
            config.nasBridge
              ? new NasBridge(
                  config.nasBridge,
                  config.environment,
                  config.roots.map((root) => root.id),
                  index.identities,
                  config.maxFileBytes,
                  config.environment === 'development' &&
                    config.identityProvider === 'mock'
                )
              : undefined
          ))
  const bridge =
    authz instanceof DsmStrictAuthorization ? authz.bridge : undefined
  const sharedBrowse = config.authorizationMode === 'google-mount'
  const googlePrincipal = (identity: VerifiedIdentity): Principal => {
    // Reapply the current domain policy to server-stored verified identity.
    const verified = checkIdentityClaims(
      { ...identity, email_verified: true },
      config.allowedHostedDomains
    )
    return {
      key: 'google:' + digest(verified.iss + '\0' + verified.sub),
      generation: 'google-mount-v1',
      username: verified.email,
      email: verified.email,
      enabled: true,
      trustedEmail: true,
      system: false,
      groups: []
    }
  }
  const cookieName = config.origin.startsWith('https:')
    ? '__Host-portal'
    : 'portal'
  const cookieOptions = {
    httpOnly: true,
    secure: config.origin.startsWith('https:'),
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: 3600
  }
  let downloads = 0
  const principalDownloads = new Map<string, number>()
  const directory = async () => {
    if (bridge) return bridge.directory()
    if (authz.directory) return authz.directory()
    let fd: number | undefined
    try {
      if (!config.directoryPath) throw new Error('missing-directory')
      fd = openSync(
        config.directoryPath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      )
      const before = fstatSync(fd),
        limit = 4 * 1024 * 1024
      if (!before.isFile() || before.size > limit) throw new Error('bounded')
      const bytes = Buffer.alloc(before.size + 1)
      let length = 0
      while (length < bytes.length) {
        const received = readSync(
          fd,
          bytes,
          length,
          bytes.length - length,
          null
        )
        if (!received) break
        length += received
      }
      const after = fstatSync(fd)
      if (
        length !== before.size ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs
      )
        throw new Error('changed')
      const snapshot = parseDirectory(
        JSON.parse(bytes.subarray(0, length).toString('utf8'))
      )
      if (
        config.environment === 'production' &&
        snapshot.source !== 'admin-approved'
      )
        throw new Error('untrusted')
      return snapshot
    } catch {
      throw new AppError('directory-unavailable', 503)
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }
  const identify = async (cookie: string | undefined, touch = true) => {
    const session = state.session(cookie, touch)
    try {
      if (sharedBrowse !== (session.accessProfile === 'google-mount'))
        throw new AppError('login-required', 401)
      if (sharedBrowse) {
        const principal = googlePrincipal(session.identity)
        if (
          principal.key !== session.principalKey ||
          principal.generation !== session.generation
        )
          throw new AppError('identity-review-required', 403)
        return { session, principal }
      }
      const snapshot = await directory(),
        principal = resolvePrincipal(snapshot, session.identity)
      state.bind(session.identity, principal, snapshot)
      if (
        principal.key !== session.principalKey ||
        principal.generation !== session.generation
      )
        throw new AppError('identity-review-required', 403)
      return { session, principal }
    } catch (error) {
      state.revoke(session.id)
      throw error
    }
  }
  const createLoginSession = async (identity: VerifiedIdentity) => {
    if (sharedBrowse)
      return state.createGoogleMountSession(identity, googlePrincipal(identity))
    const snapshot = await directory()
    return state.createSession(
      identity,
      resolvePrincipal(snapshot, identity),
      snapshot
    )
  }
  const allowed = async (principal: Principal, record: FileRecord) => {
    if (!index.online.get(record.rootId) || !(await authz.ready()))
      throw new AppError('source-unavailable', 503)
    const checked = new Set<string>()
    let current: FileRecord | undefined = record
    while (current) {
      if (checked.has(current.id)) return false
      checked.add(current.id)
      if (!(await authz.canRead(principal, current))) return false
      if (current.relative === '') return true
      current = index.records.get(current.parentId)
    }
    return false
  }
  const authorize = async (principal: Principal, id: string) => {
    if (
      !(await authz.ready()) ||
      config.roots.some((root) => !index.online.get(root.id))
    )
      throw new AppError('source-unavailable', 503)
    const record = index.records.get(id)
    if (!record || !(await allowed(principal, record))) {
      state.audit(
        principal.key,
        /^[a-f0-9]{32}$/.test(id) ? id : 'invalid',
        'deny'
      )
      throw new AppError('not-found', 404)
    }
    return record
  }
  const requireOrigin = (origin: string | undefined) => {
    if (origin !== config.origin) throw new AppError('origin-rejected', 403)
  }
  const streamCookie = config.origin.startsWith('https:')
    ? '__Host-portal-stream'
    : 'portal-stream'
  const streamCookieOptions = {
    ...cookieOptions,
    sameSite: 'Strict' as const,
    maxAge: 90
  }
  const remote =
    config.viewerMode === 'selkies'
      ? new RemoteSessions(
          options.remoteWorker ?? new LocalRemoteWorker(config),
          async (lease) => {
            if (config.environment === 'production')
              assertRemoteMount(config.roots, process.env.NAS_EXPECTED_SOURCE)
            const { session, principal } = await identify(lease.cookie, false)
            if (session.id !== lease.owner)
              throw new AppError('remote-expired', 401)
            const record = await authorize(principal, lease.file.id)
            if (record.revision !== lease.file.revision)
              throw new AppError('source-changed', 409)
            await index.stat(record)
          }
        )
      : undefined
  const internalApp = new Hono()
  internalApp.onError((error, c) =>
    c.json(
      { error: error instanceof AppError ? error.code : 'remote-failed' },
      error instanceof AppError ? (error.status as 400) : 500
    )
  )
  internalApp.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' blob: data:; font-src 'self' blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    )
    await next()
  })
  internalApp.get('/_remote/:ticket/metadata', async (c) => {
    const lease = await remote?.internal(c.req.param('ticket'))
    if (!lease) throw new AppError('not-found', 404)
    return c.json({
      name: lease.file.name,
      revision: lease.file.revision,
      mode: config.mode,
      display: lease.display
    })
  })
  internalApp.get('/_remote/:ticket/display', async (c) => {
    const lease = await remote?.internal(c.req.param('ticket'))
    if (!lease) throw new AppError('not-found', 404)
    return c.json({ display: lease.display })
  })
  internalApp.get('/_remote/:ticket/scene', async (c) => {
    const lease = await remote?.internal(c.req.param('ticket'))
    if (!lease) throw new AppError('not-found', 404)
    const record = lease.file,
      key = record.id + ':' + record.revision
    let packed = scenes.get(key)
    const begin = performance.now()
    if (!packed) {
      if (parsing) throw new AppError('scene-busy', 429)
      parsing = true
      const signal = AbortSignal.any([
        c.req.raw.signal,
        lease.abort.signal,
        AbortSignal.timeout(60000)
      ])
      try {
        const source = await index.open(record, signal)
        packed = await parseScene(source, record.size, signal, (timings) =>
          console.log(
            JSON.stringify({
              event: 'remote-parse',
              lease: lease.id,
              ...timings
            })
          )
        )
        await remote!.internal(lease.ticket)
        await index.stat(record)
        signal.throwIfAborted()
        scenes.put(key, packed)
      } finally {
        parsing = false
      }
    }
    await remote!.internal(lease.ticket)
    console.log(
      JSON.stringify({
        event: 'remote-scene',
        lease: lease.id,
        sourceBytes: record.size,
        sceneBytes: packed.length,
        elapsedMs: performance.now() - begin
      })
    )
    return new Response(packed, {
      headers: {
        'Content-Type': SCENE_TYPE,
        'Content-Length': String(packed.length),
        'X-Document-Revision': record.revision,
        'Cache-Control': 'no-store'
      }
    })
  })
  internalApp.post(
    '/_remote/:ticket/ready',
    bodyLimit({ maxSize: 2048 }),
    async (c) => {
      const lease = await remote?.internal(c.req.param('ticket'))
      if (!lease || !config.remote) throw new AppError('not-found', 404)
      const data = await c.req.json()
      const timings = Object.fromEntries(
        [
          'sceneHydrationMs',
          'documentMaterializationMs',
          'layoutMs',
          'firstPresentationMs'
        ].map((key) => [
          key,
          Math.min(180000, Math.max(0, Number(data.timings?.[key]) || 0))
        ])
      )
      const result = {
        ready: data.ready === true,
        loadMs: Number(data.loadMs) || 0,
        timings
      }
      writeFileSync(
        config.remote.runtimePath + '/' + lease.id + '/ready.json',
        JSON.stringify(result),
        { mode: 0o600 }
      )
      console.log(
        JSON.stringify({
          event: 'remote-presentation',
          lease: lease.id,
          ...result
        })
      )
      return c.json({ ok: true })
    }
  )
  internalApp.all('/_remote/*', () => {
    throw new AppError('not-found', 404)
  })
  internalApp.get('/readonly-runtime.js', (c) =>
    c.body(readFileSync(config.webPath + '/../api/remote-memory.js'), 200, {
      'Content-Type': 'application/javascript'
    })
  )
  internalApp.get('/remote-desktop', (c) =>
    c.html(
      readFileSync(config.webPath + '/index.html', 'utf8').replace(
        '<head>',
        '<head><script src="/readonly-runtime.js"></script>'
      )
    )
  )
  internalApp.use('/*', serveStatic({ root: config.webPath }))
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Cross-Origin-Resource-Policy', 'same-origin')
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' blob: data:; font-src 'self' blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    )
    await next()
  })
  app.onError((error, c) =>
    c.json(
      { error: error instanceof AppError ? error.code : 'request-failed' },
      error instanceof AppError ? (error.status as 400) : 500
    )
  )
  app.get('/health/live', (c) => c.json({ live: true }))
  app.get('/health/ready', async (c) => {
    let dirReady = sharedBrowse
    try {
      if (!sharedBrowse) {
        const snapshot = await directory()
        dirReady =
          snapshot.expiresAt > Date.now() &&
          snapshot.observedAt >= Date.now() - 300000
      }
    } catch {}
    const ready =
      authz.mode === config.authorizationMode &&
      (await authz.ready()) &&
      dirReady &&
      config.roots.every((r) => index.online.get(r.id))
    return c.json(
      {
        ready,
        authorization: authz.mode,
        nasAclEnforced: config.authorizationMode === 'dsm-strict'
      },
      ready ? 200 : 503
    )
  })
  app.get('/auth/mode', (c) =>
    c.json({
      provider: config.identityProvider,
      authorization: config.authorizationMode,
      mode: config.mode,
      viewer:
        config.viewerMode === 'selkies'
          ? 'selkies'
          : config.environment === 'production'
            ? 'raster'
            : (config.viewerMode ?? 'native')
    })
  )
  app.use(
    '/auth/mock',
    bodyLimit({
      maxSize: 1024,
      onError: (c) => c.json({ error: 'request-too-large' }, 413)
    })
  )
  app.post('/auth/mock', async (c) => {
    if (
      config.identityProvider !== 'mock' ||
      config.environment !== 'development'
    )
      throw new AppError('not-found', 404)
    requireOrigin(c.req.header('Origin'))
    const content = c.req.header('Content-Length')
    if (content && Number(content) > 1024)
      throw new AppError('request-too-large', 413)
    const body = (await c.req.json()) as Record<string, unknown>
    if (body.account !== 'A' && body.account !== 'B')
      throw new AppError('identity-rejected', 403)
    const account = body.account,
      email = account === 'A' ? 'alice@mock.example' : 'bob@mock.example'
    const identity = checkIdentityClaims(
      {
        iss: 'https://accounts.google.com',
        sub: 'mock-' + account,
        email,
        hd: 'mock.example',
        email_verified: true
      },
      config.allowedHostedDomains
    )
    const token = await createLoginSession(identity)
    const previous = getCookie(c, cookieName)
    if (previous) {
      try {
        state.revoke(state.session(previous).id)
      } catch {}
    }
    setCookie(c, cookieName, token, cookieOptions)
    return c.json({ ok: true })
  })
  app.get('/auth/google/start', (c) => {
    if (config.identityProvider !== 'google-oidc')
      throw new AppError('not-found', 404)
    const flow = state.createOAuth()
    setCookie(c, 'portal-oidc', flow.proof, { ...cookieOptions, maxAge: 300 })
    return c.redirect(googleStart(config, flow))
  })
  app.get('/auth/google/callback', async (c) => {
    if (config.identityProvider !== 'google-oidc')
      throw new AppError('not-found', 404)
    const flow = state.consumeOAuth(
      c.req.query('state') ?? '',
      getCookie(c, 'portal-oidc')
    )
    deleteCookie(c, 'portal-oidc', cookieOptions)
    const code = c.req.query('code')
    if (!code || c.req.query('error')) throw new AppError('oauth-rejected', 403)
    const identity = await exchangeGoogle(
      code,
      flow,
      config,
      options.googleTokenKeys
    )
    // A verified Google identity is still not a NAS principal or a file grant.
    // Record only the phase, without tokens/email, when NAS setup is pending.
    state.audit('', '', 'oidc-verified')
    const token = await createLoginSession(identity)
    const previous = getCookie(c, cookieName)
    if (previous) {
      try {
        state.revoke(state.session(previous).id)
      } catch {}
    }
    setCookie(c, cookieName, token, cookieOptions)
    return c.redirect('/')
  })
  app.post('/auth/logout', async (c) => {
    requireOrigin(c.req.header('Origin'))
    const { session } = await identify(getCookie(c, cookieName))
    if (c.req.header('X-CSRF-Token') !== session.csrf)
      throw new AppError('csrf-rejected', 403)
    state.revoke(session.id)
    if (remote?.active?.owner === session.id)
      await remote.stop(undefined, 'logout')
    deleteCookie(c, streamCookie, streamCookieOptions)
    deleteCookie(c, cookieName, cookieOptions)
    return c.json({ ok: true })
  })
  app.get('/api/me', async (c) => {
    const { session, principal } = await identify(getCookie(c, cookieName))
    return c.json({
      email: session.identity.email,
      username: principal.username,
      csrf: session.csrf,
      readonly: true,
      authorization: authz.mode,
      maxFileBytes: config.maxFileBytes
    })
  })
  const displayBody = bodyLimit({
    maxSize: 2048,
    onError: () => {
      throw new AppError('invalid-display', 413)
    }
  })
  app.post('/api/files/:id/remote', displayBody, async (c) => {
    if (!remote) throw new AppError('remote-disabled', 404)
    requireOrigin(c.req.header('Origin'))
    const cookie = getCookie(c, cookieName)
    const { session, principal } = await identify(cookie)
    if (c.req.header('X-CSRF-Token') !== session.csrf)
      throw new AppError('csrf-rejected', 403)
    const record = await authorize(principal, c.req.param('id'))
    if (record.kind !== 'file') throw new AppError('not-found', 404)
    await index.stat(record)
    let display
    try {
      display = remoteDisplay(
        c.req.header('Content-Type')?.includes('application/json')
          ? await c.req.json()
          : { width: 1920, height: 1080, dpr: 1, uiScale: 1.25 },
        config.remote!
      )
    } catch {
      throw new AppError('invalid-display', 400)
    }
    const lease = await remote.create(session.id, cookie!, record, display)
    setCookie(c, streamCookie, lease.credential, streamCookieOptions)
    return c.json({
      id: lease.id,
      url: `/stream/${lease.id}/`,
      expires: lease.expires,
      display: lease.display
    })
  })
  app.post('/api/remote/:id/:action', displayBody, async (c) => {
    if (!remote) throw new AppError('remote-disabled', 404)
    requireOrigin(c.req.header('Origin'))
    const { session } = await identify(getCookie(c, cookieName), false)
    if (c.req.header('X-CSRF-Token') !== session.csrf)
      throw new AppError('csrf-rejected', 403)
    const lease = await remote.access(
      c.req.param('id'),
      session.id,
      getCookie(c, streamCookie)
    )
    if (c.req.param('action') === 'display') {
      try {
        lease.display = remoteDisplay(await c.req.json(), config.remote!)
      } catch {
        throw new AppError('invalid-display', 400)
      }
      return c.json({ display: lease.display })
    }
    if (c.req.param('action') === 'renew') {
      remote.renew(lease)
      setCookie(c, streamCookie, lease.credential, streamCookieOptions)
      return c.json({ expires: lease.expires })
    }
    if (c.req.param('action') === 'stop') {
      await remote.stop(lease.id)
      deleteCookie(c, streamCookie, streamCookieOptions)
      return c.json({ ok: true })
    }
    throw new AppError('not-found', 404)
  })
  app.get('/stream/:id/*', async (c) => {
    if (!remote) throw new AppError('remote-disabled', 404)
    const id = c.req.param('id')
    let lease
    try {
      const { session } = await identify(getCookie(c, cookieName), false)
      lease = await remote.access(id, session.id, getCookie(c, streamCookie))
    } catch (error) {
      console.log(
        JSON.stringify({
          event: 'remote-stream-http-rejected',
          lease: /^[A-Za-z0-9_-]{43}$/.test(id) ? id : undefined,
          errorCode: remoteErrorCode(error, 'request-failed')
        })
      )
      throw error
    }
    const suffix = c.req.path.slice(`/stream/${lease.id}/`.length)
    console.log(
      JSON.stringify({
        event: 'remote-stream-http',
        lease: lease.id,
        asset: !suffix
          ? 'page'
          : suffix === 'selkies-core.js'
            ? 'core'
            : suffix === 'portal-client.js'
              ? 'client'
              : suffix === 'manifest.json'
                ? 'manifest'
                : 'unknown'
      })
    )
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-eval'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"
    )
    if (!suffix)
      return c.html(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>OpenPencil 唯讀串流</title></head><body><div id="app"></div><script src="portal-client.js"></script><script type="module" src="selkies-core.js"></script></body></html>'
      )
    if (suffix === 'portal-client.js')
      return c.body(
        readFileSync(resolve(config.webPath, '../api/remote-client.js')),
        200,
        { 'Content-Type': 'application/javascript' }
      )
    if (suffix === 'selkies-core.js')
      return c.body(readFileSync(remote.worker.corePath), 200, {
        'Content-Type': 'application/javascript'
      })
    if (suffix === 'manifest.json')
      return c.json({ name: 'OpenPencil read-only' })
    throw new AppError('not-found', 404)
  })
  // Dedicated loopback listener only; never let the public SPA fallback mask this boundary.
  app.all('/_remote/*', () => {
    throw new AppError('not-found', 404)
  })
  app.all('/remote-desktop', () => {
    throw new AppError('not-found', 404)
  })
  app.get('/api/roots', async (c) => {
    const { principal } = await identify(getCookie(c, cookieName))
    const result: FileRecord[] = []
    for (const r of index.records.values())
      if (r.relative === '' && (await allowed(principal, r))) result.push(r)
    return c.json({ items: result })
  })
  for (const endpoint of ['/api/files', '/api/search'])
    app.get(endpoint, async (c) => {
      const { principal } = await identify(getCookie(c, cookieName))
      if (
        !(await authz.ready()) ||
        config.roots.some((r) => !index.online.get(r.id))
      )
        throw new AppError('source-unavailable', 503)
      const parentId = c.req.query('parentId'),
        q = (c.req.query('q') ?? '').slice(0, 256).toLowerCase()
      if (parentId) {
        const parent = await authorize(principal, parentId)
        if (parent.kind !== 'folder') throw new AppError('not-found', 404)
      }
      const visible: FileRecord[] = []
      for (const record of index.records.values())
        if (record.kind === 'file' || record.relative !== '') {
          if (
            endpoint === '/api/files' &&
            record.parentId !==
              (parentId ?? index.records.values().next().value?.id)
          )
            continue
          if (
            endpoint === '/api/search' &&
            !record.relative.toLowerCase().includes(q)
          )
            continue
          if (await allowed(principal, record)) visible.push(record)
        }
      visible.sort((a, b) => a.relative.localeCompare(b.relative))
      const cursor = Number(c.req.query('cursor') ?? '0')
      if (!Number.isSafeInteger(cursor) || cursor < 0)
        throw new AppError('cursor-invalid', 400)
      return c.json({
        items: visible.slice(cursor, cursor + 100),
        total: visible.length,
        next: cursor + 100 < visible.length ? String(cursor + 100) : null
      })
    })
  app.get('/api/files/:id', async (c) => {
    const { principal } = await identify(getCookie(c, cookieName))
    const record = await authorize(principal, c.req.param('id'))
    if (record.kind === 'file') {
      if (bridge) await bridge.stat(principal, record)
      else if (authz.stat) await authz.stat(principal, record)
      else await index.stat(record)
    }
    return c.json(record)
  })
  app.get('/api/files/:id/thumbnail', async (c) => {
    const cookie = getCookie(c, cookieName)
    const { principal } = await identify(cookie)
    const record = await authorize(principal, c.req.param('id'))
    if (
      !sharedBrowse ||
      record.kind !== 'file' ||
      bridge ||
      authz.open ||
      authz.stat
    )
      throw new AppError('thumbnail-unavailable', 404)
    if (c.req.query('revision') !== record.revision)
      throw new AppError('source-changed', 409)
    await index.stat(record) // Never let a shared cache bypass current source/access proof.
    const signal = AbortSignal.any([
      c.req.raw.signal,
      AbortSignal.timeout(30000)
    ])
    const key =
      config.roots.find((root) => root.id === record.rootId)!.path +
      '\0' +
      record.id +
      '\0' +
      record.revision
    const image = await thumbnails.get(key, async () => {
      const extractor = await import(
        pathToFileURL(resolve(config.webPath, '../api/thumbnail-extractor.js'))
          .href
      )
      let readBytes = 0
      return extractor.extractThumbnail({
        size: record.size,
        read: async (start: number, end: number) => {
          readBytes += end - start
          if (readBytes > 8 * 1024 * 1024)
            throw new AppError('thumbnail-unavailable', 404)
          return index.readRange(record, start, end, signal)
        }
      }) as Promise<Uint8Array | null>
    })
    const current = await identify(cookie, false)
    const after = await authorize(current.principal, record.id)
    if (after.revision !== record.revision)
      throw new AppError('source-changed', 409)
    await index.stat(record)
    if (!image) throw new AppError('thumbnail-unavailable', 404)
    return c.body(image, 200, {
      'Content-Type': 'image/png',
      'X-Document-Revision': record.revision
    })
  })
  for (const endpoint of ['viewer', 'viewport'])
    app.get('/api/files/:id/' + endpoint, async (c) => {
      const cookie = getCookie(c, cookieName)
      const { principal } = await identify(cookie)
      const record = await authorize(principal, c.req.param('id') ?? '')
      if (record.kind !== 'file') throw new AppError('not-found', 404)
      const query = c.req.query()
      const { revision, ...viewportQuery } = query
      if (revision !== record.revision)
        throw new AppError('source-changed', 409)
      const view =
        endpoint === 'viewport' ? parseViewport(viewportQuery) : undefined
      const stat = async () => {
        if (bridge) await bridge.stat(principal, record)
        else if (authz.stat) await authz.stat(principal, record)
        else await index.stat(record)
      }
      await stat()
      const signal = AbortSignal.any([
        c.req.raw.signal,
        AbortSignal.timeout(60000)
      ])
      const source = () =>
        bridge
          ? bridge.open(principal, record, signal)
          : authz.open
            ? authz.open(principal, record, signal)
            : index.open(record, signal)
      const result = await viewer.run(
        record.id + ':' + record.revision,
        source,
        record.size,
        signal,
        view
      )
      const current = await identify(cookie)
      await authorize(current.principal, record.id)
      await stat()
      signal.throwIfAborted()
      state.audit(principal.key, record.id, 'read')
      c.header('X-Document-Revision', record.revision)
      c.header('X-Viewer-Cache', result.cached ? 'hit' : 'miss')
      if (result.manifest) {
        const json = JSON.stringify(result.manifest)
        if (Buffer.byteLength(json) > 2097152)
          throw new AppError('viewer-manifest-limit', 413)
        c.header('Content-Length', String(Buffer.byteLength(json)))
        return c.body(json, 200, {
          'Content-Type': 'application/json; charset=utf-8'
        })
      }
      if (!result.image) throw new AppError('viewer-render-failed', 422)
      return new Response(result.image, {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': String(result.image.length),
          'Cache-Control': 'no-store',
          'X-Document-Revision': record.revision,
          'X-Viewer-Cache': result.cached ? 'hit' : 'miss'
        }
      })
    })
  app.get('/api/files/:id/scene', async (c) => {
    const { principal } = await identify(getCookie(c, cookieName))
    const record = await authorize(principal, c.req.param('id'))
    if (config.environment === 'production' || config.viewerMode === 'selkies')
      throw new AppError('full-scene-disabled', 410)
    if (record.kind !== 'file') throw new AppError('not-found', 404)
    const stat = async () => {
      if (bridge) await bridge.stat(principal, record)
      else if (authz.stat) await authz.stat(principal, record)
      else await index.stat(record)
    }
    await stat()
    const key = record.id + ':' + record.revision
    let packed = scenes.get(key)
    const cached = Boolean(packed)
    if (!packed) {
      if (parsing) throw new AppError('scene-busy', 429)
      parsing = true
      const signal = AbortSignal.any([
        c.req.raw.signal,
        AbortSignal.timeout(60000)
      ])
      try {
        const source = bridge
          ? await bridge.open(principal, record, signal)
          : authz.open
            ? await authz.open(principal, record, signal)
            : await index.open(record, signal)
        packed = await parseScene(source, record.size, signal)
        // No cache or result after a changed source, expired identity or revoked permission.
        const current = await identify(getCookie(c, cookieName))
        await authorize(current.principal, record.id)
        await stat()
        signal.throwIfAborted()
        scenes.put(key, packed)
      } finally {
        parsing = false
      }
    }
    state.audit(principal.key, record.id, 'read')
    return new Response(packed, {
      headers: {
        'Content-Type': SCENE_TYPE,
        'Content-Length': String(packed.length),
        'Cache-Control': 'no-store',
        'X-Document-Revision': record.revision,
        'X-Scene-Cache': cached ? 'hit' : 'miss'
      }
    })
  })
  app.on(['GET', 'HEAD'], '/api/files/:id/content', async (c) => {
    const { principal } = await identify(getCookie(c, cookieName))
    const record = await authorize(principal, c.req.param('id'))
    // Raw transport remains solely for existing development confinement probes.
    if (config.environment === 'production' || config.viewerMode === 'selkies')
      throw new AppError('raw-content-disabled', 410)
    if (record.kind !== 'file') throw new AppError('not-found', 404)
    if (c.req.method === 'HEAD') {
      if (bridge) await bridge.stat(principal, record)
      else if (authz.stat) await authz.stat(principal, record)
      else await index.stat(record)
      return new Response(null, {
        headers: {
          'Content-Length': String(record.size),
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-store'
        }
      })
    }
    if (c.req.header('Range')) throw new AppError('range-not-supported', 416)
    const active = principalDownloads.get(principal.key) ?? 0
    if (downloads >= config.maxDownloads || active >= 1)
      throw new AppError('download-busy', 429)
    downloads++
    principalDownloads.set(principal.key, active + 1)
    const cancel = new AbortController()
    const requestAbort = () => cancel.abort()
    c.req.raw.signal.addEventListener('abort', requestAbort, { once: true })
    try {
      const source = bridge
        ? await bridge.open(principal, record, cancel.signal)
        : authz.open
          ? await authz.open(principal, record, cancel.signal)
          : await index.open(record, cancel.signal)
      const stream = Readable.toWeb(source) as ReadableStream<Uint8Array>
      const reader = stream.getReader()
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        downloads--
        principalDownloads.set(
          principal.key,
          (principalDownloads.get(principal.key) ?? 1) - 1
        )
        cancel.abort()
        c.req.raw.signal.removeEventListener('abort', requestAbort)
      }
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const part = await reader.read()
            if (part.done) {
              finish()
              controller.close()
            } else controller.enqueue(part.value)
          } catch {
            finish()
            controller.error(new Error('source-changed-or-unavailable'))
          }
        },
        async cancel() {
          finish()
          await reader.cancel()
        }
      })
      state.audit(principal.key, record.id, 'read')
      return new Response(body, {
        headers: {
          'Content-Length': String(record.size),
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-store',
          'X-Document-Revision': record.revision,
          ETag: 'W/"' + record.revision + '"'
        }
      })
    } catch (error) {
      downloads--
      principalDownloads.set(principal.key, active)
      cancel.abort()
      c.req.raw.signal.removeEventListener('abort', requestAbort)
      throw error
    }
  })
  app.all('/api/*', () => {
    throw new AppError('not-found', 404)
  })
  app.use('/*', serveStatic({ root: config.webPath }))
  app.get('/*', serveStatic({ path: config.webPath + '/index.html' }))
  return {
    app,
    state,
    index,
    authz,
    remote,
    internalApp,
    async remoteConnection(
      cookie: string,
      id: string,
      credential: string | undefined,
      origin: string | undefined
    ) {
      requireOrigin(origin)
      const { session } = await identify(cookie, false)
      if (!remote) throw new AppError('remote-disabled', 404)
      return remote.access(id, session.id, credential)
    },
    async scan() {
      const before = new Map(
        config.roots.map((root) => [
          root.id,
          index.online.get(root.id) ? 'online' : index.errors.get(root.id)
        ])
      )
      await index.scan()
      for (const root of config.roots) {
        const status = index.online.get(root.id)
          ? 'online'
          : index.errors.get(root.id)
        if (before.get(root.id) !== status)
          console.log(
            JSON.stringify({
              event: 'source-index',
              root: root.id,
              status,
              files: [...index.records.values()].filter(
                (r) => r.rootId === root.id && r.kind === 'file'
              ).length
            })
          )
      }
      state.saveIndex(
        index.records.values(),
        config.roots.flatMap((root) => {
          const identity = index.identities.get(root.id)
          return identity
            ? [
                {
                  ...root,
                  identity,
                  sourceIdentity: index.sourceIdentities.get(root.id)
                }
              ]
            : []
        })
      )
    },
    close() {
      void remote?.close()
      void thumbnails.close()
      viewer.close()
      state.close()
    }
  }
}
