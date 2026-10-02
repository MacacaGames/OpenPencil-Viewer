import { checkFigSafety } from './fig-safety'
self.onmessage = (event: MessageEvent<{ bytes: ArrayBuffer; max: number }>) => {
  try {
    checkFigSafety(new Uint8Array(event.data.bytes), event.data.max)
    self.postMessage({ ok: true })
  } catch {
    self.postMessage({ ok: false })
  }
}
