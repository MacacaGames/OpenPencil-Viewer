import {
  Unzip,
  UnzipInflate,
  zipSync,
  strToU8,
  strFromU8,
  type Zippable
} from 'fflate'

export const SCENE_TYPE = 'application/vnd.openpencil.scene+zip'
export const MAX_SCENE_BYTES = 512 * 1024 * 1024
const TAG = '$portalScene'

// Binary resources stay binary; JSON object-number expansion would dwarf a FIG.
export function encodeScene(value: unknown): Uint8Array {
  const files: Record<string, Uint8Array> = Object.create(null)
  let resources = 0
  const candidates = new Map<string, string[]>()
  files['scene.json'] = strToU8(
    JSON.stringify(value, (_key, part: unknown) => {
      if (part instanceof Uint8Array) {
        const signature = [
          part.length,
          part[0],
          part[part.length >> 1],
          part[part.length - 1]
        ].join(':')
        const bucket = candidates.get(signature) ?? []
        for (const prior of bucket) {
          const bytes = files[prior]
          if (bytes.every((byte, i) => byte === part[i]))
            return { [TAG]: 'bytes', value: prior }
        }
        const name = 'bytes/' + resources++
        files[name] = part
        bucket.push(name)
        candidates.set(signature, bucket)
        return { [TAG]: 'bytes', value: name }
      }
      if (part instanceof Map) return { [TAG]: 'map', value: [...part] }
      if (part instanceof Set) return { [TAG]: 'set', value: [...part] }
      return part
    })
  )
  if (Object.values(files).reduce((n, b) => n + b.length, 0) > MAX_SCENE_BYTES)
    throw new Error('scene-limit')
  const archive: Zippable = Object.create(null)
  for (const [name, bytes] of Object.entries(files)) {
    // Re-deflating PNG/JPEG/WebP costs CPU without useful transfer savings.
    const compressedImage =
      (bytes[0] === 137 &&
        bytes[1] === 80 &&
        bytes[2] === 78 &&
        bytes[3] === 71) ||
      (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
      (strFromU8(bytes.subarray(0, 4)) === 'RIFF' &&
        strFromU8(bytes.subarray(8, 12)) === 'WEBP')
    archive[name] = compressedImage ? [bytes, { level: 0 }] : bytes
  }
  const packed = zipSync(archive, { level: 6 })
  if (packed.length > MAX_SCENE_BYTES) throw new Error('scene-limit')
  return packed
}

export function decodeScene(bytes: Uint8Array): unknown {
  if (bytes.length > MAX_SCENE_BYTES) throw new Error('scene-limit')
  const files = new Map<string, Uint8Array>()
  const complete = new Set<string>()
  let total = 0,
    count = 0
  const unzip = new Unzip((file) => {
    if (
      ++count > 100000 ||
      files.has(file.name) ||
      (file.name !== 'scene.json' && !/^bytes\/\d+$/.test(file.name))
    )
      throw new Error('scene-invalid')
    files.set(file.name, new Uint8Array())
    const chunks: Uint8Array[] = []
    let length = 0
    file.ondata = (error, chunk, final) => {
      if (error) throw error
      total += chunk.length
      length += chunk.length
      if (total > MAX_SCENE_BYTES) throw new Error('scene-limit')
      chunks.push(chunk.slice())
      if (final) {
        const result = new Uint8Array(length)
        let offset = 0
        for (const part of chunks) {
          result.set(part, offset)
          offset += part.length
        }
        files.set(file.name, result)
        complete.add(file.name)
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
  const json = files.get('scene.json')
  if (!json || complete.size !== files.size) throw new Error('scene-invalid')
  const result: unknown = JSON.parse(strFromU8(json), (key, part: unknown) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype')
      throw new Error('scene-invalid')
    if (!part || typeof part !== 'object' || !(TAG in part)) return part
    const tagged = part as Record<string, unknown>
    if (tagged[TAG] === 'bytes' && typeof tagged.value === 'string') {
      const resource = files.get(tagged.value)
      if (!resource || !tagged.value.startsWith('bytes/'))
        throw new Error('scene-invalid')
      return resource
    }
    if (!Array.isArray(tagged.value)) throw new Error('scene-invalid')
    if (tagged[TAG] === 'map') return new Map(tagged.value)
    if (tagged[TAG] === 'set') return new Set(tagged.value)
    throw new Error('scene-invalid')
  })
  if (
    !result ||
    typeof result !== 'object' ||
    !('version' in result) ||
    result.version !== 1
  )
    throw new Error('scene-version')
  return result
}
