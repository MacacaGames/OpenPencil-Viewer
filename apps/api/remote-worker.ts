import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, rm, readFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { AppError } from '../../packages/contracts/index.ts'
import type { Config } from './config.ts'
import {
  remoteErrorCode,
  type RemoteLease,
  type RemoteWorker
} from './remote-sessions.ts'
const execute = promisify(execFile)
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Fixed local operations only: no command/URL/path comes from a browser. */
export class LocalRemoteWorker implements RemoteWorker {
  streamUrl: string
  corePath = '/usr/share/selkies/selkies-dashboard/src/selkies-core.js'
  private processes: ChildProcess[] = []
  private directory?: string
  private failure?: Error
  private starting?: Promise<void>
  private lease?: RemoteLease
  constructor(private config: Config) {
    this.streamUrl = `http://127.0.0.1:${config.remote!.streamPort}`
  }
  start(lease: RemoteLease) {
    this.lease = lease
    this.starting = this.startInternal(lease).finally(() => {
      this.starting = undefined
    })
    return this.starting
  }
  private async startInternal(lease: RemoteLease) {
    const check = () => {
      if (lease.abort.signal.aborted) throw new AppError('remote-expired', 401)
    }
    check()
    const settings = this.config.remote!
    if (process.platform !== 'linux' || process.getuid?.() === 0)
      throw new AppError('remote-requires-nonroot-linux', 503)
    if (this.processes.length)
      throw new AppError('remote-cleanup-required', 503)
    this.directory = resolve(settings.runtimePath, lease.id)
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await mkdir(this.directory + '/runtime', { mode: 0o700 })
    check()
    const { stdout } = await execute(
      'python3',
      ['/app/tools/remote/gpu.py', '--select'],
      { timeout: 30000, maxBuffer: 1048576 }
    )
    const plan = JSON.parse(stdout)
    check()
    lease.encoderMode = plan.requestedEncoder
    console.log(JSON.stringify({ event: 'remote-device-plan', ...plan }))
    const env = {
      ...process.env,
      HOME: this.directory,
      XDG_RUNTIME_DIR: this.directory + '/runtime',
      DISPLAY: ':1',
      AUTO_GPU: 'false',
      DRI_NODE: plan.encodeNode || '',
      DRINODE: plan.renderNode || '',
      LIBGL_ALWAYS_SOFTWARE: plan.renderNode ? '0' : '1',
      SELKIES_FILE_TRANSFERS: 'none',
      SELKIES_ENABLE_CLIPBOARD: 'false',
      SELKIES_COMMAND_ENABLED: 'false|locked',
      SELKIES_PRINTING_ENABLED: 'false|locked',
      SELKIES_AUDIO_ENABLED: 'false|locked',
      SELKIES_MICROPHONE_ENABLED: 'false|locked',
      SELKIES_GAMEPAD_ENABLED: 'false|locked',
      SELKIES_WEBCAM_ENABLED: 'false|locked',
      SELKIES_SECOND_SCREEN: 'false|locked',
      SELKIES_ENABLE_BINARY_CLIPBOARD: 'false|locked',
      SELKIES_CLIPBOARD_SEAMLESS: 'false|locked',
      SELKIES_USE_CSS_SCALING: 'false|locked',
      SELKIES_VIDEO_FULLCOLOR: 'false|locked',
      SELKIES_USE_CPU: `${plan.encoder === 'cpu'}|locked`,
      SELKIES_FRAMERATE: '30-30',
      SELKIES_ENCODER: 'h264enc',
      SELKIES_MODE: 'websockets',
      SELKIES_ENABLE_DUAL_MODE: 'false|locked',
      SELKIES_VIDEO_STREAMING_MODE: 'false|locked',
      SELKIES_USE_PAINT_OVER_QUALITY: 'true|locked',
      SELKIES_ENABLE_RESIZE: 'true|locked',
      SELKIES_ALLOWED_ORIGINS: this.config.origin,
      SELKIES_MASTER_TOKEN: '',
      FILE_MANAGER_PATH: this.directory + '/empty',
      PIXELFLUX_WAYLAND: 'false',
      PIXELFLUX_RECORDING_SOCKET: '',
      PIXELFLUX_CU: '',
      FONTCONFIG_PATH: '/etc/fonts',
      FONTCONFIG_FILE: '/etc/fonts/fonts.conf',
      // Avoid inherited generic-image/administrator hooks.
      SELKIES_RUN_AFTER_CONNECT: '',
      SELKIES_RUN_AFTER_DISCONNECT: ''
    }
    this.failure = undefined
    const start = (command: string, args: string[]) => {
      check()
      const child = spawn(command, args, {
        env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      this.processes.push(child)
      const log = (bytes: Buffer) => {
        const message = bytes
          .toString()
          .replaceAll(lease.ticket, '[internal-ticket]')
          .replaceAll(lease.credential, '[stream-credential]')
          .replaceAll(lease.cookie, '[portal-cookie]')
        process.stdout.write(`[remote:${command.split('/').pop()}] ${message}`)
      }
      child.stdout?.on('data', log)
      child.stderr?.on('data', log)
      child.on('error', (e) => {
        this.failure = e
        console.log(
          JSON.stringify({
            event: 'remote-process-error',
            lease: lease.id,
            component: command.split('/').pop(),
            errorCode: remoteErrorCode(e, 'process-start-failed')
          })
        )
      })
      child.on('exit', (code, signal) => {
        if (this.processes.includes(child)) {
          this.failure = new Error(`remote process exited ${code ?? signal}`)
          console.log(
            JSON.stringify({
              event: 'remote-process-exit',
              lease: lease.id,
              component: command.split('/').pop(),
              code,
              signal
            })
          )
        }
      })
      return child
    }
    const displayArgs = [
      ':1',
      '-screen',
      '0',
      `${lease.display?.width ?? 1920}x${lease.display?.height ?? 1080}x24`,
      '-dpi',
      '96',
      '-nolisten',
      'tcp',
      '-ac',
      '+extension',
      'RANDR',
      '+extension',
      'GLX',
      '+extension',
      'XTEST'
    ]
    if (
      await access('/tmp/.X11-unix/X1').then(
        () => true,
        () => false
      )
    )
      throw new AppError('remote-display-already-in-use', 503)
    let display = start('/usr/bin/Xvfb', [
      ...displayArgs,
      ...(plan.renderNode ? ['-glamor', '-dri', plan.renderNode] : [])
    ])
    const waitDisplay = async () => {
      for (let i = 0; i < 100; i++) {
        check()
        if (this.failure) throw new AppError('remote-display-failed', 503)
        if (
          await access('/tmp/.X11-unix/X1').then(
            () => true,
            () => false
          )
        )
          return
        await delay(100)
      }
      throw new AppError('remote-display-timeout', 503)
    }
    try {
      await waitDisplay()
    } catch (error) {
      check()
      if (!plan.renderNode) throw error
      this.processes = this.processes.filter((child) => child !== display)
      await this.terminate(display)
      this.failure = undefined
      env.LIBGL_ALWAYS_SOFTWARE = '1'
      console.log(
        JSON.stringify({
          event: 'remote-renderer-fallback',
          reason: 'selected-gpu-x11-display-failed',
          renderNode: plan.renderNode
        })
      )
      display = start('/usr/bin/Xvfb', displayArgs)
      await waitDisplay()
    }
    const gl = await execute('glxinfo', ['-B'], {
      env,
      timeout: 15000,
      maxBuffer: 65536
    }).catch(() => ({ stdout: 'OpenGL probe failed; renderer unverified' }))
    console.log(
      JSON.stringify({
        event: 'remote-renderer',
        software: /probe failed/i.test(gl.stdout)
          ? null
          : /llvmpipe|softpipe|swrast/i.test(gl.stdout),
        actual: gl.stdout,
        zeroCopy: 'unverified'
      })
    )
    check()
    start('/usr/bin/openbox', [
      '--config-file',
      '/app/tools/remote/openbox.xml'
    ])
    start('/lsiopy/bin/selkies', [
      '--addr',
      '127.0.0.1',
      '--port',
      String(settings.streamPort),
      '--web-root',
      '/app/tools/remote/empty'
    ])
    // Direct binary, not LSIO's wrapper. No --no-sandbox or sandbox-disabling flags.
    start('/usr/lib/chromium/chromium', [
      '--kiosk',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-domain-reliability',
      '--disable-extensions',
      '--disable-session-crashed-bubble',
      '--disable-features=MediaRouter',
      '--disable-breakpad',
      '--password-store=basic',
      '--force-device-scale-factor=' +
        Math.max(
          0.25,
          (lease.display?.density ?? 1) * (lease.display?.uiScale ?? 1.25)
        ),
      '--use-gl=angle',
      '--use-angle=gl',
      '--ignore-gpu-blocklist',
      '--user-data-dir=' + this.directory + '/profile',
      '--disk-cache-size=1',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      `http://127.0.0.1:${settings.appPort}/remote-desktop?ticket=${lease.ticket}`
    ])
    // Ready is written only after native graph hydration and a presented frame.
    for (let i = 0; i < 1400; i++) {
      check()
      if (this.failure) throw new AppError('remote-process-failed', 503)
      try {
        const ready = JSON.parse(
          await readFile(this.directory + '/ready.json', 'utf8')
        )
        if (ready.ready === true) return
        throw new AppError('remote-document-failed', 422)
      } catch (error) {
        if (error instanceof AppError) throw error
      }
      await delay(100)
    }
    throw new AppError('remote-document-timeout', 504)
  }
  alive() {
    return !this.failure && this.processes.length > 0
  }
  async stop(_id: string) {
    this.lease?.abort.abort()
    await this.starting?.catch(() => undefined)
    const processes = this.processes.splice(0)
    await Promise.all(processes.map((child) => this.terminate(child)))
    if (this.directory)
      await rm(this.directory, { recursive: true, force: true })
    this.directory = undefined
    this.lease = undefined
  }
  private async terminate(child: ChildProcess) {
    if (!child.pid) return
    const exited = () => child.exitCode !== null || child.signalCode !== null
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {}
    if (!exited())
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        delay(2000)
      ])
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
    if (!exited())
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        delay(1000)
      ])
    if (!exited()) throw new AppError('remote-cleanup-failed', 503)
  }
}
