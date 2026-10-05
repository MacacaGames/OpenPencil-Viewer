// The pinned Selkies core reports pipeline readiness to its own window.
// Relay only that fixed signal to the same-origin Portal, never arbitrary payloads.
window.addEventListener('message', (event: MessageEvent) => {
  if (
    event.origin === location.origin &&
    event.source === window &&
    window.parent !== window &&
    event.data?.type === 'pipelineStatusUpdate' &&
    event.data.video === true
  ) {
    bindCoreTransport()
    window.parent.postMessage({ type: 'portalStreamReady' }, location.origin)
  }
})

// WheelEvent carries modifiers even when keydown happened outside the iframe,
// or when a trackpad pinch generates Ctrl+wheel without a physical Ctrl key.
// The pinned core's wheel handler does not reconcile those modifiers. Use its
// existing socket and X11 pointer protocol for these navigation events only.
const NativeSocket = window.WebSocket
type InputTransport = {
  readyState: number
  send(data: Parameters<WebSocket['send']>[0]): void
}
let stream: InputTransport | undefined
const controls = new Set<number>()
function noteInput(data: string) {
  const [op, key] = data.split(',')
  if (op === 'kd' && [65507, 65508].includes(Number(key)))
    controls.add(Number(key))
  if (op === 'ku') controls.delete(Number(key))
  if (op === 'kr') controls.clear()
}
function bindCoreTransport() {
  // Pinned core normally owns the WebSocket in a worker. Its page-side
  // transport facade exposes the same ordered send/readyState contract.
  const value = Reflect.get(window, 'selkiesTransport')
  if (
    !value ||
    typeof value.send !== 'function' ||
    typeof value.readyState !== 'number' ||
    value === stream
  )
    return
  const transport = value as InputTransport
  const send = transport.send.bind(transport)
  controls.clear()
  transport.send = (data) => {
    if (typeof data === 'string') noteInput(data)
    send(data)
  }
  stream = transport
}
window.WebSocket = class extends NativeSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols)
    const expected = new URL('api/websockets', location.href)
    expected.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    if (this.url === expected.href) {
      stream = this
      controls.clear()
    }
  }
  send(data: Parameters<WebSocket['send']>[0]) {
    if (this === stream && typeof data === 'string') {
      noteInput(data)
    }
    super.send(data)
  }
}
window.addEventListener(
  'wheel',
  (event: WheelEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return
    const target = event.target
    if (!(target instanceof Element)) return
    if (
      target.id !== 'overlayInput' &&
      target.id !== 'keyboard-input-assist' &&
      target.closest('button,input,select,textarea,[role="dialog"]')
    )
      return
    // The core's rendered cursor/stream wrapper can be the wheel target. Hit-test
    // the displayed media rectangle instead of requiring a video DOM target.
    const media = [...document.querySelectorAll('video,canvas')].find(
      (element) => {
        const box = element.getBoundingClientRect()
        return (
          box.width > 0 &&
          box.height > 0 &&
          event.clientX >= box.left &&
          event.clientX < box.right &&
          event.clientY >= box.top &&
          event.clientY < box.bottom
        )
      }
    )
    if (
      !(media instanceof HTMLVideoElement || media instanceof HTMLCanvasElement)
    )
      return
    event.preventDefault()
    event.stopImmediatePropagation()
    bindCoreTransport()
    const socket = stream
    if (!socket || socket.readyState !== NativeSocket.OPEN || !event.deltaY)
      return
    const width =
      media instanceof HTMLVideoElement ? media.videoWidth : media.width
    const height =
      media instanceof HTMLVideoElement ? media.videoHeight : media.height
    if (!width || !height) return
    const box = media.getBoundingClientRect()
    const scale = Math.min(box.width / width, box.height / height)
    if (!scale) return
    const x = Math.max(
      0,
      Math.min(
        width - 1,
        Math.round(
          (event.clientX - box.left - (box.width - width * scale) / 2) / scale
        )
      )
    )
    const y = Math.max(
      0,
      Math.min(
        height - 1,
        Math.round(
          (event.clientY - box.top - (box.height - height * scale) / 2) / scale
        )
      )
    )
    const magnitude = Math.max(
      1,
      Math.min(
        8,
        Math.round(
          (Math.abs(event.deltaY) *
            (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1)) /
            100
        )
      )
    )
    const injected = controls.size === 0
    if (injected) socket.send('kd,65507')
    // Pinned Selkies X11 uses bit4 for wheel-up and bit3 for wheel-down.
    socket.send(`m,${x},${y},${event.deltaY < 0 ? 16 : 8},${magnitude}`)
    socket.send(`m,${x},${y},0,0`)
    if (injected) socket.send('ku,65507')
  },
  { capture: true, passive: false }
)
