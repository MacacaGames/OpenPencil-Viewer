import type { Server } from 'node:http'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import type { Config } from './config.ts'
import type { createPortal } from './app.ts'
import { createRemoteInput } from './remote-protocol.ts'
import { remoteErrorCode } from './remote-sessions.ts'

export function attachRemoteStream(
  server: Server,
  portal: ReturnType<typeof createPortal>,
  config: Config
) {
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 16384,
    perMessageDeflate: false,
    clientTracking: false
  })
  server.on('upgrade', async (request, socket, head) => {
    const denied = () => {
      if (!socket.destroyed)
        socket.end(
          'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'
        )
    }
    let upstream: WebSocket | undefined
    let leaseId: string | undefined,
      stage = 'request'
    try {
      const url = new URL(request.url ?? '/', config.origin)
      const match = /^\/stream\/([A-Za-z0-9_-]{43})\/api\/websockets$/.exec(
        url.pathname
      )
      if (!match || url.search || !portal.remote || !config.remote)
        return denied()
      leaseId = match[1]
      stage = 'authorization'
      console.log(
        JSON.stringify({ event: 'remote-stream-attempt', lease: leaseId })
      )
      const cookies = Object.fromEntries(
        (request.headers.cookie ?? '').split(';').map((part) => {
          const index = part.indexOf('=')
          return [
            part.slice(0, index).trim(),
            decodeURIComponent(part.slice(index + 1))
          ]
        })
      )
      const cookie =
        cookies[config.origin.startsWith('https:') ? '__Host-portal' : 'portal']
      const credential =
        cookies[
          config.origin.startsWith('https:')
            ? '__Host-portal-stream'
            : 'portal-stream'
        ]
      const lease = await portal.remoteConnection(
        cookie,
        match[1],
        credential,
        request.headers.origin
      )
      stage = 'upstream-connect'
      upstream = new WebSocket(
        portal.remote.workerFor(lease).streamUrl.replace(/^http/, 'ws') +
          '/api/websockets',
        {
          origin: config.origin,
          maxPayload: 16 * 1024 * 1024,
          perMessageDeflate: false,
          handshakeTimeout: 5000
        }
      )
      // Selkies sends role/settings immediately on connection. Preserve them
      // while the second owner/source validation completes, before the bridge exists.
      const pending: [RawData, boolean][] = []
      let pendingBytes = 0,
        overflow = false
      const size = (data: RawData) =>
        Array.isArray(data)
          ? data.reduce((sum, part) => sum + part.length, 0)
          : data.byteLength
      const buffer = (data: RawData, binary: boolean) => {
        pendingBytes += size(data)
        if (pendingBytes > 16 * 1024 * 1024 || pending.length >= 64) {
          overflow = true
          upstream?.terminate()
        } else pending.push([data, binary])
      }
      upstream.on('message', buffer)
      await new Promise<void>((resolve, reject) => {
        upstream!.once('open', resolve)
        upstream!.once('error', reject)
      })
      stage = 'revalidation'
      await portal.remoteConnection(
        cookie,
        match[1],
        credential,
        request.headers.origin
      )
      if (overflow || upstream.readyState !== WebSocket.OPEN)
        throw new Error('remote-stream-not-ready')
      const source = upstream
      stage = 'upgrade'
      sockets.handleUpgrade(request, socket, head, (client) => {
        console.log(
          JSON.stringify({ event: 'remote-stream-connected', lease: lease.id })
        )
        let hardwareVerified = lease.encoderMode !== 'vaapi'
        const verifyTimer = setTimeout(() => {
          if (!hardwareVerified) {
            console.error('remote-forced-vaapi-unverified')
            void portal.remote?.stop(lease.id, 'forced-vaapi-unverified')
          }
        }, 10000)
        verifyTimer.unref()
        let transferred = 0,
          lastStats = 0
        const connectedAt = performance.now()
        let firstPacket = false
        let closed = false
        const close = (reason = 'session-stopped') => {
          if (closed) return
          closed = true
          console.log(
            JSON.stringify({
              event: 'remote-stream-closed',
              lease: lease.id,
              reason,
              firstPacket,
              transferredBytes: transferred
            })
          )
          clearTimeout(verifyTimer)
          client.terminate()
          source.terminate()
          portal.remote?.connectionsFor(lease)?.delete(close)
          portal.remote?.disconnected(lease)
        }
        portal.remote!.connectionsFor(lease)!.add(close)
        portal.remote!.connected(lease)
        if (!portal.remote!.has(lease)) return close()
        const inputFilter = createRemoteInput(
          config.remote!,
          config.mode === 'session-edit'
        )
        client.on('message', (bytes, binary) => {
          if (binary) return // Audio, webcam and binary upload have no role in this viewer.
          const input = inputFilter(bytes.toString())
          if (
            input &&
            source.readyState === WebSocket.OPEN &&
            source.bufferedAmount < 65536
          )
            source.send(input)
        })
        const forward = (bytes: RawData, binary: boolean) => {
          if (client.readyState !== WebSocket.OPEN) return
          if (!binary) {
            try {
              const message = JSON.parse(bytes.toString())
              if (message.type === 'stream_info' && message.info) {
                console.log(
                  JSON.stringify({
                    event: 'remote-stream-info',
                    lease: lease.id,
                    info: message.info
                  })
                )
                if (
                  lease.encoderMode === 'vaapi' &&
                  (message.info.hardware !== true ||
                    !/vaapi/i.test(message.info.encoder ?? ''))
                ) {
                  console.error('remote-forced-vaapi-fallback-rejected')
                  void portal.remote?.stop(lease.id, 'forced-vaapi-fallback')
                  return close('forced-vaapi-fallback')
                }
                hardwareVerified = true
              }
              if (
                message.type === 'stream_stats' &&
                Date.now() - lastStats > 5000
              ) {
                lastStats = Date.now()
                console.log(
                  JSON.stringify({
                    event: 'remote-stream-stats',
                    lease: lease.id,
                    transferredBytes: transferred,
                    stats: message.stats
                  })
                )
              }
            } catch {
              /* Ordinary non-JSON Selkies control messages. */
            }
          }
          if (binary && !hardwareVerified) return
          if (binary && !firstPacket) {
            firstPacket = true
            console.log(
              JSON.stringify({
                event: 'remote-first-stream-packet',
                lease: lease.id,
                elapsedMs: performance.now() - connectedAt
              })
            )
          }
          transferred += size(bytes)
          if (client.bufferedAmount > 16 * 1024 * 1024)
            return close('browser-backpressure')
          client.send(bytes, { binary })
        }
        source.on('message', forward)
        client.on('close', () => close('browser-closed'))
        client.on('error', () => close('browser-error'))
        source.on('close', () => close('upstream-closed'))
        source.on('error', () => close('upstream-error'))
        source.off('message', buffer)
        for (const [data, binary] of pending) forward(data, binary)
        pending.length = 0
        source.send('_stats,1')
      })
    } catch (error) {
      console.log(
        JSON.stringify({
          event: 'remote-stream-rejected',
          lease: leaseId,
          stage,
          errorCode: remoteErrorCode(error, 'stream-handshake-failed')
        })
      )
      upstream?.terminate()
      denied()
    }
  })
  server.once('close', () => sockets.close())
}
