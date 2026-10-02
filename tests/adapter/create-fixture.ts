import { SceneGraph } from '@open-pencil/scene-graph'
import { exportFigFile } from './packages/core/src/io/formats/fig'
const graph = new SceneGraph(),
  first = graph.getPages()[0]
graph.createNode('RECTANGLE', first.id, {
  name: 'LAN fixture rectangle',
  x: 40,
  y: 60,
  width: 180,
  height: 120,
  fills: [
    {
      type: 'SOLID',
      color: { r: 0.2, g: 0.4, b: 0.8, a: 1 },
      opacity: 1,
      visible: true
    }
  ]
})
const second = graph.addPage('Page 2')
graph.createNode('ELLIPSE', second.id, {
  name: 'LAN fixture circle',
  x: 100,
  y: 80,
  width: 100,
  height: 100,
  fills: [
    {
      type: 'SOLID',
      color: { r: 0.8, g: 0.3, b: 0.2, a: 1 },
      opacity: 1,
      visible: true
    }
  ]
})
await Bun.write('../../tests/fixtures/basic.fig', await exportFigFile(graph))
