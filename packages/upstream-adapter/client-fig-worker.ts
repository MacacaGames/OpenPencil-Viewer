import { parseFigFile } from '@open-pencil/core/io/formats/fig'
import { serializeSceneGraph } from '@open-pencil/core/scene-transfer'
import { checkFigSafety } from '../transport/fig-safety'

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    checkFigSafety(new Uint8Array(event.data))
    const graph = await parseFigFile(event.data, { populate: 'all' })
    const data = serializeSceneGraph(graph)
    data.figSchemaDeflated = null
    data.figKiwiVersion = null
    self.postMessage({ scene: { version: 1, graph: data } })
  } catch {
    self.postMessage({ error: true })
  }
}
// Yoga initializes asynchronously in this module worker. Do not lose early messages.
self.postMessage({ ready: true })
