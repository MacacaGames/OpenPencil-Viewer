// Run in a disposable, built OpenPencil checkout. Input is a public-image
// sources.json inventory; no existing design file is accepted or read.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { unzipSync, zipSync, strToU8 } from 'fflate'
import { SceneGraph } from '@open-pencil/scene-graph'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'

type Asset = {
  sha1: string
  bytes: number
  width: number
  height: number
  isPublicDomain: boolean
  license: string
}
type Sources = {
  assets: Asset[]
  encodedImageBytes: number
  uniqueImages: number
}

const sourcePath = process.argv[2]
const outputPath = process.argv[3]
if (!sourcePath || !outputPath)
  throw new Error(
    'Usage: generate-image-heavy.ts /public/sources.json /output-directory'
  )
const sources: Sources = JSON.parse(await readFile(resolve(sourcePath), 'utf8'))
const output = resolve(outputPath)
await mkdir(output, { recursive: true })
const hashes = new Set(sources.assets.map((a) => a.sha1))
if (
  hashes.size !== sources.assets.length ||
  hashes.size !== sources.uniqueImages ||
  sources.assets.some(
    (a) =>
      !/^[a-f0-9]{40}$/.test(a.sha1) ||
      !a.isPublicDomain ||
      a.license !== 'CC0-1.0'
  )
)
  throw new Error(
    'Inventory must contain distinct, verified public-domain CC0 assets'
  )

const graph = new SceneGraph()
const pages = [
  graph.getPages()[0],
  graph.addPage('Public images 2'),
  graph.addPage('Public images 3')
]
graph.updateNode(pages[0].id, { name: 'Public images 1' })
const perPage = Math.ceil(sources.assets.length / pages.length)
for (const [n, asset] of sources.assets.entries()) {
  const index = n % perPage
  graph.createNode('RECTANGLE', pages[Math.floor(n / perPage)].id, {
    name: `Public CC0 image ${String(n + 1).padStart(4, '0')}`,
    x: (index % 12) * 220,
    y: Math.floor(index / 12) * 160,
    width: 200,
    height: 140,
    fills: [
      {
        type: 'IMAGE',
        imageHash: asset.sha1,
        color: { r: 0, g: 0, b: 0, a: 1 },
        imageScaleMode: 'FIT',
        opacity: 1,
        visible: true
      }
    ]
  })
}
// Serialize the new graph only. Python then streams original JPEGs into the
// archive, avoiding several unnecessary 400-MiB copies during generation.
const archive = unzipSync(await exportFigFile(graph))
archive['meta.json'] = strToU8(
  JSON.stringify({ version: 1, app: 'OpenPencil public CC0 reproduction' })
)
for (const name of Object.keys(archive))
  if (!['canvas.fig', 'meta.json', 'thumbnail.png'].includes(name))
    throw new Error(`Unexpected graph scaffold entry: ${name}`)
const bytes = zipSync(archive, {
  level: 0,
  mtime: new Date('2020-01-01T00:00:00Z')
})
await writeFile(resolve(output, 'image-heavy-scaffold.fig'), bytes)
await writeFile(
  resolve(output, 'layout.json'),
  JSON.stringify(
    {
      pages: pages.length,
      imageNodes: sources.assets.length,
      imagesPerPage: pages.map((_, n) =>
        Math.min(perPage, sources.assets.length - n * perPage)
      ),
      displayWidth: 200,
      displayHeight: 140,
      columns: 12,
      decodedRgbaBytesEstimate: sources.assets.reduce(
        (n, a) => n + a.width * a.height * 4,
        0
      ),
      decodedRgbaWithMipmapsBytesEstimate: Math.ceil(
        sources.assets.reduce((n, a) => n + a.width * a.height * 4, 0) * (4 / 3)
      ),
      scaffoldSha256: createHash('sha256').update(bytes).digest('hex'),
      provenance:
        'New SceneGraph; only the public CC0 asset inventory supplies image hashes.'
    },
    null,
    2
  ) + '\n'
)
console.log(
  `Generated scaffold: ${sources.assets.length} distinct image nodes, ${pages.length} pages`
)
