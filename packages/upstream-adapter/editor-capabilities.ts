import { computed } from 'vue'
import { isReadonlyGraph } from './readonly'

export function useDocumentReadonly(editor: {
  graph: object
  state: { sceneVersion: number }
}) {
  return computed(() => {
    void editor.state.sceneVersion
    return isReadonlyGraph(editor.graph)
  })
}
