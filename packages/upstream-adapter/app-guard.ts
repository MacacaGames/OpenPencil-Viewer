import { guardEditor } from './readonly'
export function guardAppEditor<T extends { graph: object }>(editor: T): T {
  // App-specific view/preparation functions remain usable, while import/save/pen/vector actions are denied after graph lock.
  const view = new Set([
    'fitCurrentPageToViewport',
    'markCanvasReady',
    'onPreparationEvent',
    'getPaneRenderState',
    'setActivePane',
    'splitPane',
    'closePane',
    'resizePane',
    'setSplitSizes',
    'setViewportSize',
    'getDocumentFilePath',
    'getSourceIdentity',
    'getStorageBinding',
    'getRecoveryId',
    'hasUnsavedChanges',
    'persistRecoveryNow',
    'discardRecovery'
  ])
  const saved = new Map<string, PropertyDescriptor>()
  for (const name of view) {
    const d = Object.getOwnPropertyDescriptor(editor, name)
    if (d) saved.set(name, d)
  }
  guardEditor(editor, () => editor.graph)
  for (const [name, descriptor] of saved)
    Object.defineProperty(editor, name, descriptor)
  return editor
}
