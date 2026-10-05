import { parentPort } from 'node:worker_threads'
import { parseFigFile } from '@open-pencil/core/io/formats/fig'
import { serializeSceneGraph } from '@open-pencil/core/scene-transfer'
import { checkFigSafety } from '../transport/fig-safety'
import { encodeScene } from '../transport/scene-wire'

parentPort?.once('message', async (bytes: ArrayBuffer) => {
  try {
    checkFigSafety(new Uint8Array(bytes))
    const graph = await parseFigFile(bytes, { populate: 'all' })
    const data = serializeSceneGraph(graph)
    // Export-only archive schema and deferred original-source payload never cross HTTP.
    data.figSchemaDeflated = null
    data.figKiwiVersion = null
    const packed = encodeScene({ version: 1, graph: data })
    parentPort?.postMessage({ packed }, [packed.buffer])
  } catch {
    parentPort?.postMessage({ error: 'scene-parse-failed' })
  }
})
