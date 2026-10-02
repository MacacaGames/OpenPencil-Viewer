import { parseFigFile } from '@open-pencil/core/io/formats/fig'
import type { EditorStore } from '@/app/editor/session'
import { applyImportedDocument } from '@/app/document/io/imported-document'
import { lockGraph } from './readonly'
export async function loadBytes(
  editor: EditorStore,
  bytes: ArrayBuffer,
  name: string,
  signal: AbortSignal,
  progress: (phase: string) => void
) {
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(60000)])
  progress('安全檢查')
  await validateFig(bytes, timeout)
  progress('解析設計')
  const graph = await parseFigFile(bytes, {
    populate: 'all',
    allowMainThreadFallback: false,
    signal: timeout
  })
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
async function validateFig(bytes: ArrayBuffer, signal: AbortSignal) {
  const worker = new Worker(
    new URL('../transport/fig-safety-worker.ts', import.meta.url),
    { type: 'module' }
  )
  let abort: () => void = () => undefined
  try {
    await new Promise<void>((resolve, reject) => {
      signal.throwIfAborted()
      abort = () => reject(new DOMException('Aborted', 'AbortError'))
      signal.addEventListener('abort', abort, { once: true })
      worker.onmessage = (event: MessageEvent<{ ok: boolean }>) =>
        event.data.ok ? resolve() : reject(new Error('文件格式或資源限制'))
      worker.onerror = () => reject(new Error('安全檢查失敗'))
      const copy = bytes.slice(0)
      worker.postMessage({ bytes: copy, max: 512 * 1024 * 1024 }, [copy])
    })
  } finally {
    signal.removeEventListener('abort', abort)
    worker.terminate()
  }
}
