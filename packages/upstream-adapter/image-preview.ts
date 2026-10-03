import type { ImagePreview, ImagePreviewDecoder } from './image-memory'

export function createImagePreviewDecoder(): ImagePreviewDecoder {
  let worker: Worker | null = null
  let pending: {
    resolve: (preview: ImagePreview) => void
    reject: (error: Error) => void
  } | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  function stop() {
    clearTimeout(timer)
    worker?.terminate()
    worker = null
    pending?.reject(new Error('Image preview stopped'))
    pending = null
  }
  return {
    decode(source, edge) {
      if (pending) return Promise.reject(new Error('Image decoder busy'))
      worker ??= new Worker(
        new URL('./image-preview-worker.ts', import.meta.url),
        { type: 'module' }
      )
      return new Promise<ImagePreview>((resolve, reject) => {
        pending = { resolve, reject }
        timer = setTimeout(stop, 30000)
        const current = worker
        if (!current) return stop()
        current.onmessage = (
          event: MessageEvent<{ preview?: ImagePreview }>
        ) => {
          if (worker !== current) return
          const waiter = pending
          pending = null
          clearTimeout(timer)
          if (event.data.preview) waiter?.resolve(event.data.preview)
          else waiter?.reject(new Error('Image preview failed'))
        }
        current.onerror = () => {
          if (worker === current) stop()
        }
        // Blob owns a copy; never transfer or detach the readonly graph's bytes.
        const data =
          source.buffer instanceof ArrayBuffer
            ? new Uint8Array(
                source.buffer,
                source.byteOffset,
                source.byteLength
              )
            : source.slice()
        current.postMessage({ source: new Blob([data]), edge })
      })
    },
    destroy: stop
  }
}
