import {
  extractFigThumbnailFromReader,
  type FigRangeReader
} from '@open-pencil/fig'

/** Embedded preview only: never parse/hydrate the document to build a file list. */
export async function extractThumbnail(reader: FigRangeReader) {
  const image = await extractFigThumbnailFromReader(reader, {
    maxTailBytes: 2 * 1024 * 1024,
    maxCompressedBytes: 2 * 1024 * 1024,
    maxOutputBytes: 2 * 1024 * 1024
  })
  if (!image || image.byteLength < 24) return null
  const header = new DataView(image.buffer, image.byteOffset, image.byteLength)
  if (header.getUint32(16) > 2048 || header.getUint32(20) > 2048) return null
  return image
}
