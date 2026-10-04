import { readFileSync } from 'node:fs'
import { zlibSync, unzipSync, zipSync } from 'fflate'
function chunk(type: string, data: Uint8Array) {
  const out = Buffer.alloc(data.length + 12)
  out.writeUInt32BE(data.length)
  out.write(type, 4)
  out.set(data, 8)
  let crc = 0xffffffff
  for (const byte of out.subarray(4, out.length - 4)) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4)
  return out
}
export function thumbnailPNG() {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(64)
  header.writeUInt32BE(40, 4)
  header[8] = 8
  header[9] = 2
  const pixels = Buffer.alloc(40 * (64 * 3 + 1))
  for (let y = 0; y < 40; y++)
    for (let x = 0; x < 64; x++) {
      const offset = y * (64 * 3 + 1) + 1 + x * 3
      pixels.set([50 + x * 2, 110 + y * 2, 170], offset)
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlibSync(pixels)),
    chunk('IEND', Buffer.alloc(0))
  ])
}
export function thumbnailFig(paddingBytes = 0) {
  const archive = unzipSync(readFileSync('tests/fixtures/basic.fig'))
  archive['thumbnail.png'] = thumbnailPNG()
  if (paddingBytes) archive['padding'] = new Uint8Array(paddingBytes)
  return zipSync(archive, paddingBytes ? { level: 0 } : {})
}
