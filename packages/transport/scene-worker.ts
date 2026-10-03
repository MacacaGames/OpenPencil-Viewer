import { decodeScene } from './scene-wire'
self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    self.postMessage({ scene: decodeScene(new Uint8Array(event.data)) })
  } catch {
    self.postMessage({ error: true })
  }
}
