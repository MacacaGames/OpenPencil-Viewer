// Run each revision in its own process with only the newly generated public FIG.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseFigFile } from '@open-pencil/core/io/formats/fig'

const output = resolve(process.argv[2])
const manifest = JSON.parse(
  await readFile(resolve(output, 'manifest.json'), 'utf8')
)
const sources = JSON.parse(
  await readFile(resolve(output, 'sources.json'), 'utf8')
)
const bytes = await readFile(resolve(output, manifest.filename))
const graph = await parseFigFile(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  { populate: 'all' }
)
const nodes = [...graph.getAllNodes()]
const refs = new Set(
  nodes.flatMap((node) =>
    node.fills.flatMap((fill) =>
      fill.type === 'IMAGE' && fill.imageHash ? [fill.imageHash] : []
    )
  )
)
if (
  createHash('sha256').update(bytes).digest('hex') !== manifest.sha256 ||
  graph.getPages().length !== manifest.pages ||
  graph.images.size !== manifest.uniqueReferencedImages ||
  refs.size !== manifest.uniqueReferencedImages ||
  nodes.filter((n) => n.type === 'RECTANGLE').length !== manifest.imageNodes ||
  nodes.some((n) => n.text || n.type === 'TEXT')
)
  throw new Error('Public FIG structure mismatch')
for (const asset of sources.assets) {
  const image = graph.images.get(asset.sha1)
  if (
    !image ||
    !refs.has(asset.sha1) ||
    createHash('sha256').update(image).digest('hex') !== asset.sha256
  )
    throw new Error('Public FIG image mismatch: ' + asset.sha1)
}
console.log(
  JSON.stringify(
    {
      result: 'PASS',
      filename: manifest.filename,
      bytes: bytes.length,
      sha256: manifest.sha256,
      pages: graph.getPages().length,
      nodes: nodes.length,
      referencedImages: refs.size,
      textNodes: 0,
      imageHashes: 'Every embedded image matches the public CC0 inventory',
      maxRssBytes: process.resourceUsage().maxRSS * 1024
    },
    null,
    2
  )
)
