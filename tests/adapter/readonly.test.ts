import { test, expect } from 'bun:test'
import { createEditor } from '@open-pencil/core/editor'
import { SceneGraph } from '@open-pencil/scene-graph'
import { lockGraph } from '../../.work/editor/portal/upstream-adapter/readonly'
import { createSSRApp, effectScope, nextTick } from 'vue'
import { EDITOR_KEY } from '../../.work/editor/packages/vue/src/editor/context/index'
import { useEditorCommands } from '../../.work/editor/packages/vue/src/editor/commands/use'
import { createSelectedNodeState } from '../../.work/editor/packages/vue/src/editor/selection-state/nodes'
import { useVariables } from '../../.work/editor/packages/vue/src/variables/use'
function snapshot(graph: SceneGraph) {
  return JSON.stringify(
    [...graph.nodes].map(([id, node]) => [
      id,
      { ...node, textPicture: null, expanded: false }
    ])
  )
}
test('native variable queries and reactive panel survive readonly lock while values remain immutable', async () => {
  const graph = new SceneGraph()
  const collection = graph.createCollection('Tokens')
  const variable = graph.createVariable('Spacing', 'FLOAT', collection.id, 8)
  const editor = createEditor({
    graph,
    skipInitialGraphSetup: true,
    loadFont: async () => null
  })
  lockGraph(graph)
  const before = JSON.stringify([
    ...graph.variableCollections,
    ...graph.variables
  ])
  expect(editor.getCollections()).toHaveLength(1)
  expect(editor.getCollectionCount()).toBe(1)
  expect(editor.getVariableCount()).toBe(1)
  expect(editor.getVariablesForCollection(collection.id)).toHaveLength(1)
  expect(editor.getVariablesByType('FLOAT')).toHaveLength(1)
  expect(editor.getVariable(variable.id)?.name).toBe('Spacing')
  const app = createSSRApp({})
  app.provide(EDITOR_KEY, editor)
  const scope = effectScope()
  try {
    const panel = app.runWithContext(() => scope.run(() => useVariables()))!
    expect(panel.collections.value[0].name).toBe('Tokens')
    expect(panel.variables.value[0].name).toBe('Spacing')
    editor.requestRender()
    await nextTick()
    expect(panel.collections.value).toHaveLength(1)
    expect(panel.variables.value).toHaveLength(1)
    editor.renameCollection(collection.id, 'Changed')
    editor.updateVariableValue(variable.id, collection.defaultModeId, 99)
    editor.removeCollection(collection.id)
    const exposed = editor.getCollection(collection.id)!
    exposed.name = 'direct change'
    exposed.modes[0].name = 'direct mode change'
    expect(
      JSON.stringify([...graph.variableCollections, ...graph.variables])
    ).toBe(before)
  } finally {
    scope.stop()
    editor.dispose()
  }
})
test('core actions, direct graph mutation, nested property/paste/delete/undo are blocked; selection/zoom/pages survive', async () => {
  const graph = new SceneGraph()
  const first = graph.getPages()[0]
  const node = graph.createNode('RECTANGLE', first.id, {
    name: 'Rectangle',
    width: 100,
    height: 80,
    x: 40,
    y: 60
  })
  const second = graph.addPage('Page 2')
  const editor = createEditor({
    graph,
    skipInitialGraphSetup: true,
    loadFont: async () => null
  })
  const before = snapshot(graph)
  lockGraph(graph)
  editor.select([node.id])
  expect([...editor.state.selectedIds]).toEqual([node.id])
  editor.zoomToLevel(2)
  expect(editor.state.zoom).toBe(2)
  editor.updateNode(node.id, { x: 999, name: 'changed' })
  editor.updateNodeWithUndo(node.id, { width: 999 })
  editor.deleteSelected()
  editor.duplicateSelected()
  editor.undoAction()
  editor.redoAction()
  editor.addPage('bad')
  editor.setTool('RECTANGLE')
  editor.startTextEditing(node.id)
  editor.setDocumentColorSpace('display-p3')
  editor.createShape('RECTANGLE', 0, 0, 10, 10)
  await editor.pasteFromHTML('<svg><rect width="20" height="20"/></svg>')
  node.x = 900
  node.name = 'pre-lock reference'
  graph.updateNode(node.id, { x: 500 })
  graph.deleteNode(node.id)
  const protectedNode = graph.getNode(node.id)
  if (protectedNode) {
    protectedNode.x = 800
    protectedNode.fills.push({
      type: 'SOLID',
      color: { r: 1, g: 0, b: 0, a: 1 },
      opacity: 1,
      visible: true
    })
  }
  expect(snapshot(graph)).toBe(before)
  expect(editor.state.activeTool).toBe('SELECT')
  await editor.switchPage(second.id)
  expect(editor.state.currentPageId).toBe(second.id)
  expect(snapshot(graph)).toBe(before)
  editor.dispose()
})
test('native Vue commands deny direct run, including delete/paste/undo; view commands remain enabled', () => {
  const graph = new SceneGraph(),
    page = graph.getPages()[0],
    node = graph.createNode('RECTANGLE', page.id, {
      name: 'Selected',
      width: 100,
      height: 80
    })
  const editor = createEditor({
    graph,
    skipInitialGraphSetup: true,
    loadFont: async () => null
  })
  editor.select([node.id])
  lockGraph(graph)
  const before = snapshot(graph)
  const selected = createSelectedNodeState(editor)
  expect(selected.node.value?.name).toBe('Selected')
  if (selected.node.value) selected.node.value.x = 999
  expect(graph.getNode(node.id)?.x).toBe(0)
  selected.dispose()
  const app = createSSRApp({})
  app.provide(EDITOR_KEY, editor)
  const scope = effectScope()
  try {
    app.runWithContext(() =>
      scope.run(() => {
        const { commands } = useEditorCommands()
        let denied = 0,
          views = 0
        for (const [id, command] of Object.entries(commands)) {
          if (id.startsWith('view.')) {
            views++
            continue
          }
          if (
            [
              'selection.selectAll',
              'selection.selectInverse',
              'selection.goToMainComponent'
            ].includes(id)
          )
            continue
          expect(command.enabled.value).toBe(false)
          command.run()
          denied++
        }
        expect(denied).toBeGreaterThan(20)
        expect(views).toBeGreaterThan(0)
        expect(snapshot(graph)).toBe(before)
      })
    )
  } finally {
    scope.stop()
    editor.dispose()
  }
})

test('imported page backgrounds survive readonly page switching without exposing graph values', async () => {
  const { getPageBackgrounds } =
    await import('../../.work/editor/packages/core/src/figma-api/page-backgrounds')
  const graph = new SceneGraph()
  const second = graph.addPage('Imported page')
  second.source.fig.rawNodeFields.backgroundColor = {
    r: 0.2,
    g: 0.4,
    b: 0.6,
    a: 1
  }
  const editor = createEditor({
    graph,
    skipInitialGraphSetup: true,
    loadFont: async () => null
  })
  lockGraph(graph)
  try {
    await editor.switchPage(second.id)
    expect(editor.state.currentPageId).toBe(second.id)
    expect(editor.state.pageColor).toEqual({ r: 0.2, g: 0.4, b: 0.6, a: 1 })
    const page = graph.getNode(second.id)
    if (!page) throw new Error('Imported page missing')
    const backgrounds = getPageBackgrounds(page)
    backgrounds[0].color.r = 0.9
    expect(getPageBackgrounds(page)[0].color.r).toBe(0.2)
  } finally {
    editor.dispose()
  }
})
