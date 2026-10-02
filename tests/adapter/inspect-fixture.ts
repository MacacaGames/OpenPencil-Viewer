// Operator-approved local fixtures only. Format/graph inspection, not NAS ACL or GPU acceptance.
import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parseFigFile } from '../../.work/editor/packages/core/src/io/formats/fig/read'
import { checkFigSafety } from '../../.work/editor/portal/transport/fig-safety'
import { lockGraph } from '../../.work/editor/portal/upstream-adapter/readonly'
const path = process.argv[2]
if (!path) throw new Error('Pass one approved local fixture path')
const before = statSync(path)
if (!before.isFile() || before.size > 536870912)
  throw new Error('Fixture size/type rejected')
const bytes = readFileSync(path),
  hash = createHash('sha256').update(bytes).digest('hex')
const start = performance.now()
try {
  checkFigSafety(bytes)
  const safetyMs = performance.now() - start
  const graph = await parseFigFile(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    { populate: 'all' }
  )
  const parseMs = performance.now() - start - safetyMs
  const pages = graph.getPages().length,
    nodes = graph.nodes.size
  lockGraph(graph)
  const after = statSync(path)
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    createHash('sha256').update(readFileSync(path)).digest('hex') !== hash
  )
    throw new Error('Source changed')
  console.log(
    JSON.stringify({
      kind: 'local-real-fig-format-graph-only',
      bytes: bytes.length,
      safetyMs: +safetyMs.toFixed(1),
      parseMs: +parseMs.toFixed(1),
      pages,
      nodes,
      readonlyLocked: true,
      sourceUnchanged: true,
      peakRSSMiB: +(process.resourceUsage().maxRSS / 1024).toFixed(1),
      notMeasured: ['browser layout/GPU', 'NAS ACL', 'NAS disk/LAN']
    })
  )
} catch (error) {
  console.log(
    JSON.stringify({
      kind: 'local-real-fig-format-graph-only',
      bytes: bytes.length,
      result: 'rejected',
      code:
        error && typeof error === 'object' && 'code' in error
          ? error.code
          : 'decode-failed',
      elapsedMs: +(performance.now() - start).toFixed(1)
    })
  )
  process.exitCode = 2
}
