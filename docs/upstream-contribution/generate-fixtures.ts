// Run from a disposable OpenPencil checkout after building its packages.
// This generator has no input-file option and uses only procedural pixels.
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { zlibSync, unzipSync, zipSync, strToU8 } from 'fflate'
import { SceneGraph } from '@open-pencil/scene-graph'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'

const output = resolve(process.argv[2] ?? 'scratch/public-repro')
await mkdir(output, { recursive: true })

function chunk(name: string, data: Uint8Array) {
  const type = strToU8(name)
  const result = new Uint8Array(data.length + 12)
  const view = new DataView(result.buffer)
  view.setUint32(0, data.length)
  result.set(type, 4)
  result.set(data, 8)
  let crc = 0xffffffff
  for (const byte of result.subarray(4, result.length - 4)) {
    crc ^= byte
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0)
  return result
}

function png(edge: number, seed: number) {
  const stride = edge * 4 + 1
  const pixels = new Uint8Array(edge * stride)
  for (let y = 0; y < edge; y++) {
    for (let x = 0; x < edge; x++) {
      const p = y * stride + 1 + x * 4
      pixels[p] = (seed * 37 + Math.floor(x / 64) * 17) % 256
      pixels[p + 1] = (seed * 71 + Math.floor(y / 64) * 23) % 256
      pixels[p + 2] = (seed * 13 + (x < edge / 2 ? 50 : 180)) % 256
      pixels[p + 3] = 255
    }
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, edge)
  view.setUint32(4, edge)
  header.set([8, 6, 0, 0, 0], 8)
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlibSync(pixels, { level: 6 })),
    chunk('IEND', new Uint8Array())
  ]
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

const profiles = [
  { name: 'repaint-fit-tile', count: 1, edge: 512, nodes: 32 },
  { name: 'many-images', count: 129, edge: 512, nodes: 129 },
  { name: 'large-images', count: 16, edge: 4096, nodes: 16 }
]
const manifest = []
for (const profile of profiles) {
  const graph = new SceneGraph()
  const pages = [graph.getPages()[0], graph.addPage('Synthetic page 2')]
  graph.updateNode(pages[0].id, { name: 'Synthetic page 1' })
  const hashes: string[] = []
  let encodedImageBytes = 0
  for (let n = 0; n < profile.count; n++) {
    const bytes = png(profile.edge, n + 1)
    const hash = createHash('sha1').update(bytes).digest('hex')
    hashes.push(hash)
    graph.images.set(hash, bytes)
    encodedImageBytes += bytes.length
  }
  const perPage = Math.ceil(profile.nodes / 2)
  for (let n = 0; n < profile.nodes; n++) {
    const index = n % perPage
    graph.createNode('RECTANGLE', pages[Math.floor(n / perPage)].id, {
      name: `Synthetic image ${n + 1}`,
      x: (index % 4) * 300,
      y: Math.floor(index / 4) * 220,
      width: 256,
      height: 176,
      fills: [
        {
          type: 'IMAGE',
          imageHash: hashes[n % hashes.length],
          color: { r: 0, g: 0, b: 0, a: 1 },
          imageScaleMode: n % 2 ? 'TILE' : 'FIT',
          opacity: 1,
          visible: true
        }
      ]
    })
  }
  const archive = unzipSync(await exportFigFile(graph))
  // Remove variable timestamps. Only known, freshly generated ZIP entries survive.
  archive['meta.json'] = strToU8(
    JSON.stringify({ version: 1, app: 'OpenPencil synthetic reproduction' })
  )
  const allowed = (name: string) =>
    ['canvas.fig', 'meta.json', 'thumbnail.png'].includes(name) ||
    /^images\/[a-f0-9]{40}$/.test(name)
  for (const name of Object.keys(archive))
    if (!allowed(name)) throw new Error(`Unexpected synthetic entry: ${name}`)
  const bytes = zipSync(archive, {
    level: 0,
    mtime: new Date('2020-01-01T00:00:00Z')
  })
  const imported = await parseFigFile(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    { populate: 'all' }
  )
  const referenced = new Set(
    [...imported.getAllNodes()].flatMap((node) =>
      node.fills.flatMap((fill) =>
        fill.type === 'IMAGE' && fill.imageHash ? [fill.imageHash] : []
      )
    )
  )
  if (
    imported.getPages().length !== 2 ||
    imported.images.size !== profile.count ||
    referenced.size !== profile.count
  )
    throw new Error(`Synthetic round-trip mismatch: ${profile.name}`)
  const filename = profile.name + '.fig'
  await writeFile(resolve(output, filename), bytes)
  manifest.push({
    filename,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    pages: 2,
    imageNodes: profile.nodes,
    uniqueReferencedImages: profile.count,
    sourceImageWidth: profile.edge,
    sourceImageHeight: profile.edge,
    encodedImageBytes,
    decodedRgbaWithMipmapsEstimate: Math.ceil(
      (profile.count * profile.edge ** 2 * 4 * 4) / 3
    ),
    provenance:
      'Procedural pixels and a new SceneGraph; no input document, text, font, URL, or imported metadata.',
    validation:
      'OpenPencil export/import and every image referenced; Figma import and hardware OOM reproduction not yet run.'
  })
}
await writeFile(
  resolve(output, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n'
)
console.log(JSON.stringify(manifest, null, 2))
