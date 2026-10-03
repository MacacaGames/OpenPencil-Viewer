import { SceneGraph } from '@open-pencil/scene-graph'
import { getCanvasKit } from './packages/core/src/canvaskit'
import { serializeSceneGraph } from './packages/core/src/kiwi/fig/parse/transfer'
import { encodeScene } from './portal/transport/scene-wire'

const ck = await getCanvasKit()
const surface = ck.MakeSurface(512, 256)
if (!surface) throw new Error('Synthetic image surface unavailable')
const paint = new ck.Paint()
const canvas = surface.getCanvas()
for (const [x, y, color] of [
  [0, 0, [1, 0, 0, 1]],
  [256, 0, [0, 1, 0, 1]],
  [0, 128, [0, 0, 1, 1]],
  [256, 128, [1, 0.5, 0, 1]]
] as const) {
  paint.setColor(ck.Color4f(...color))
  canvas.drawRect(ck.XYWHRect(x, y, 256, 128), paint)
}
surface.flush()
const image = surface.makeImageSnapshot()
const bytes = image.encodeToBytes()
if (!bytes) throw new Error('Synthetic image encode failed')
image.delete()
paint.delete()
surface.delete()
const graph = new SceneGraph()
// Unique resource IDs cross the large-document threshold without private fixtures.
for (let n = 0; n < 129; n++) graph.images.set('image-' + n, bytes)
function rectangle(
  page: string,
  name: string,
  x: number,
  scaleMode: 'FIT' | 'TILE'
) {
  graph.createNode('RECTANGLE', page, {
    name,
    x,
    y: 60,
    width: 600,
    height: 300,
    fills: [
      {
        type: 'IMAGE',
        imageHash: 'image-0',
        imageScaleMode: scaleMode,
        opacity: 1,
        visible: true
      }
    ]
  })
}
rectangle(graph.getPages()[0].id, 'Image fit', 40, 'FIT')
rectangle(graph.getPages()[0].id, 'Image tile', 680, 'TILE')
rectangle(graph.addPage('Image page 2').id, 'Image second page', 40, 'FIT')
await Bun.write(
  '../viewport-images.scene',
  encodeScene({ version: 1, graph: serializeSceneGraph(graph) })
)
