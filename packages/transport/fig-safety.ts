import { Inflate, Unzip, UnzipInflate } from 'fflate'
import { Decompress } from 'fzstd'
import { AppError } from '../contracts/index'
function boundedInflate(bytes: Uint8Array, max: number, zstd = false) {
  let produced = 0
  const count = (part: Uint8Array) => {
    produced += part.length
    if (produced > max) throw new AppError('fig-inflated-limit', 413)
  }
  const stream = zstd ? new Decompress(count) : new Inflate(count)
  for (let start = 0; start < bytes.length; start += 4096)
    stream.push(
      bytes.subarray(start, start + 4096),
      start + 4096 >= bytes.length
    )
  return produced
}
// Validate every Zstandard frame/window before the dependency allocates its window.
// Zstandard frame descriptor and block header semantics: RFC 8878 sections 3.1.1/3.1.2.
function checkZstdFrames(bytes: Uint8Array, max: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 0
  while (pos < bytes.length) {
    if (pos + 5 > bytes.length || view.getUint32(pos, true) !== 0xfd2fb528)
      throw new AppError('fig-zstd-frame', 400)
    const descriptor = bytes[pos + 4] ?? 0
    const single = Boolean(descriptor & 32)
    if (descriptor & 24) throw new AppError('fig-zstd-frame', 400)
    let cursor = pos + 5
    let window = 0
    if (!single) {
      const wd = bytes[cursor++]
      if (wd === undefined) throw new AppError('fig-zstd-frame', 400)
      const base = 2 ** (10 + (wd >> 3))
      window = base + (base / 8) * (wd & 7)
    }
    const dict = descriptor & 3
    cursor += [0, 1, 2, 4][dict] ?? 0
    const fcf = descriptor >> 6
    const sizeBytes = fcf === 0 ? (single ? 1 : 0) : 2 ** fcf
    if (cursor + sizeBytes > bytes.length)
      throw new AppError('fig-zstd-frame', 400)
    let size = 0n
    for (let i = 0; i < sizeBytes; i++)
      size |= BigInt(bytes[cursor + i] ?? 0) << (8n * BigInt(i))
    if (fcf === 1) size += 256n
    if (size > BigInt(max)) throw new AppError('fig-inflated-limit', 413)
    if (single) window = Number(size)
    if (window > max) throw new AppError('fig-inflated-limit', 413)
    cursor += sizeBytes
    while (true) {
      if (cursor + 3 > bytes.length) throw new AppError('fig-zstd-frame', 400)
      const header =
        (bytes[cursor] ?? 0) |
        ((bytes[cursor + 1] ?? 0) << 8) |
        ((bytes[cursor + 2] ?? 0) << 16)
      cursor += 3
      const kind = (header >> 1) & 3
      if (kind === 3) throw new AppError('fig-zstd-frame', 400)
      cursor += kind === 1 ? 1 : header >> 3
      if (cursor > bytes.length) throw new AppError('fig-zstd-frame', 400)
      if (header & 1) break
    }
    if (descriptor & 4) cursor += 4
    if (cursor > bytes.length) throw new AppError('fig-zstd-frame', 400)
    pos = cursor
  }
}
function checkKiwi(bytes: Uint8Array, max: number) {
  if (
    new TextDecoder().decode(bytes.subarray(0, 8)) !== 'fig-kiwi' ||
    bytes.length < 20
  )
    throw new AppError('fig-invalid', 400)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let position = 12
  let index = 0,
    total = 0
  while (position < bytes.length) {
    if (position + 4 > bytes.length) throw new AppError('fig-invalid', 400)
    const length = view.getUint32(position, true)
    position += 4
    if (position + length > bytes.length) throw new AppError('fig-invalid', 400)
    const compressed = bytes.subarray(position, position + length)
    if (index < 2) {
      const zstd =
        compressed.length >= 4 &&
        new DataView(
          compressed.buffer,
          compressed.byteOffset,
          compressed.length
        ).getUint32(0, true) === 0xfd2fb528
      const limit = index === 0 ? Math.min(max, 4 * 1024 * 1024) : max - total
      if (zstd) checkZstdFrames(compressed, limit)
      total += boundedInflate(compressed, limit, zstd)
    }
    position += length
    index++
  }
  if (index < 2) throw new AppError('fig-invalid', 400)
}
export function checkFigSafety(
  bytes: Uint8Array,
  maxInflated = 512 * 1024 * 1024
) {
  if (new TextDecoder().decode(bytes.subarray(0, 8)) === 'fig-kiwi') {
    checkKiwi(bytes, maxInflated)
    return
  }
  let total = 0,
    count = 0
  let canvas: Uint8Array | undefined
  const names = new Set<string>()
  const parts: Uint8Array[] = []
  const unzip = new Unzip((file) => {
    if (++count > 100000 || names.has(file.name) || file.name.includes('..'))
      throw new AppError('fig-archive-invalid', 400)
    names.add(file.name)
    if (file.originalSize !== undefined && file.originalSize > maxInflated)
      throw new AppError('fig-inflated-limit', 413)
    let size = 0
    const isCanvas = file.name === 'canvas.fig' || file.name === 'canvas'
    file.ondata = (error, data, final) => {
      if (error) throw new AppError('fig-archive-invalid', 400)
      total += data.length
      size += data.length
      if (total > maxInflated) throw new AppError('fig-inflated-limit', 413)
      if (isCanvas) parts.push(data.slice())
      if (final && isCanvas) {
        canvas = new Uint8Array(size)
        let offset = 0
        for (const part of parts) {
          canvas.set(part, offset)
          offset += part.length
        }
        parts.length = 0
      }
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  for (let offset = 0; offset < bytes.length; offset += 4096)
    unzip.push(
      bytes.subarray(offset, offset + 4096),
      offset + 4096 >= bytes.length
    )
  if (!canvas) throw new AppError('fig-invalid', 400)
  checkKiwi(canvas, maxInflated)
}
