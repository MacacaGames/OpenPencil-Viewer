import type { ImagePreview } from './image-memory'

self.onmessage = async (
  event: MessageEvent<{ source: Blob; edge: number }>
) => {
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(event.data.source)
    const originalWidth = bitmap.width,
      originalHeight = bitmap.height
    const scale = Math.min(
      1,
      event.data.edge / Math.max(originalWidth, originalHeight)
    )
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(originalWidth * scale)),
      Math.max(1, Math.round(originalHeight * scale))
    )
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image preview canvas unavailable')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    bitmap = null
    const bytes = new Uint8Array(
      await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()
    )
    const preview: ImagePreview = { bytes, originalWidth, originalHeight }
    self.postMessage({ preview }, [bytes.buffer])
  } catch {
    self.postMessage({ error: true })
  } finally {
    bitmap?.close()
  }
}
