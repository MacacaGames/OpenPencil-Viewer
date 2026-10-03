import {
  deserializeSceneGraph,
  type SerializedSceneGraph
} from '@open-pencil/core/scene-transfer'
import type { EditorStore } from '@/app/editor/session'
import { applyImportedDocument } from '@/app/document/io/imported-document'
import { lockGraph } from './readonly'
export async function loadScene(
  editor: EditorStore,
  bytes: ArrayBuffer,
  name: string,
  signal: AbortSignal,
  progress: (phase: string) => void
) {
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(60000)])
  progress('載入場景')
  const data = await unpackScene(bytes, timeout)
  const graph = deserializeSceneGraph(data)
  const load = editor.preparationController.begin({
    kind: 'storage-open',
    phase: 'materializing',
    subject: name
  })
  const stop = () => load.cancel('tab-closed')
  timeout.addEventListener('abort', stop, { once: true })
  try {
    await applyImportedDocument(editor, graph, load)
    // Materialize and layout all pages before immutability; page navigation changes only view state.
    for (const page of graph.getPages()) {
      timeout.throwIfAborted()
      await editor.preparePage(page.id, { signal: timeout })
    }
    editor.state.documentName = name
    editor.state.autosaveEnabled = false
    lockGraph(graph)
    await editor.fitCurrentPageToViewport()
    load.update({ phase: 'preparing-render' })
    editor.requestRender()
    await editor.preparationController.waitForPresentation(
      load.id,
      editor.state.sceneVersion
    )
    timeout.throwIfAborted()
    load.complete()
  } catch (error) {
    if (!load.signal.aborted)
      load.fail({
        code: 'decode-failed',
        message: '文件無法安全載入',
        retryable: true
      })
    throw error
  } finally {
    timeout.removeEventListener('abort', stop)
  }
}
async function unpackScene(
  bytes: ArrayBuffer,
  signal: AbortSignal
): Promise<SerializedSceneGraph> {
  const worker = new Worker(
    new URL('../transport/scene-worker.ts', import.meta.url),
    { type: 'module' }
  )
  let abort: () => void = () => undefined
  try {
    return await new Promise((resolve, reject) => {
      signal.throwIfAborted()
      abort = () => reject(new DOMException('Aborted', 'AbortError'))
      signal.addEventListener('abort', abort, { once: true })
      worker.onmessage = (
        event: MessageEvent<{
          scene?: { version: number; graph: SerializedSceneGraph }
          error?: boolean
        }>
      ) => {
        const scene = event.data.scene
        if (
          event.data.error ||
          !scene ||
          scene.version !== 1 ||
          !Array.isArray(scene.graph?.nodes)
        )
          reject(new Error('場景格式或資源限制'))
        else resolve(scene.graph)
      }
      worker.onerror = () => reject(new Error('場景載入失敗'))
      worker.postMessage(bytes, [bytes])
    })
  } finally {
    signal.removeEventListener('abort', abort)
    worker.terminate()
  }
}
