import { test, expect } from 'bun:test'
import { createEditor } from '@open-pencil/core/editor'
import { SceneGraph } from '@open-pencil/scene-graph'
import { guardAppEditor } from '../../.work/editor/portal/upstream-adapter/app-guard'

test('Mutable remote editor supports property/page/undo edits without persistence or export capabilities', async () => {
  const graph = new SceneGraph()
  const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, {
    width: 100
  })
  let egress = 0
  const forbidden = async () => {
    egress++
    return true
  }
  const editor = guardAppEditor({
    ...createEditor({
      graph,
      skipInitialGraphSetup: true,
      loadFont: async () => null
    }),
    saveFigFile: forbidden,
    saveFigFileAs: forbidden,
    saveFigFileToPath: forbidden,
    openFigFile: forbidden,
    setDocumentSource: forbidden,
    setStorageDocumentSource: forbidden,
    persistRecoveryNow: forbidden,
    exportTarget: forbidden,
    exportTargets: forbidden,
    exportSelection: forbidden
  })
  try {
    editor.select([node.id])
    editor.updateNodeWithUndo(node.id, { width: 200 })
    expect(graph.getNode(node.id)?.width).toBe(200)
    editor.undoAction()
    expect(graph.getNode(node.id)?.width).toBe(100)
    editor.redoAction()
    expect(graph.getNode(node.id)?.width).toBe(200)
    editor.addPage('Session page')
    expect(graph.getPages()).toHaveLength(2)
    editor.setTool('RECTANGLE')
    expect(editor.state.activeTool).toBe('RECTANGLE')
    for (const action of [
      editor.saveFigFile,
      editor.saveFigFileAs,
      editor.saveFigFileToPath,
      editor.openFigFile,
      editor.setDocumentSource,
      editor.setStorageDocumentSource,
      editor.persistRecoveryNow,
      editor.exportTarget,
      editor.exportTargets,
      editor.exportSelection
    ])
      expect(await action()).toBe(false)
    expect(egress).toBe(0)
  } finally {
    editor.dispose()
  }
})
