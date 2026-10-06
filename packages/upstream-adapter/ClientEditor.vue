<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { closeTab, createTab } from '@/app/tabs'
import { useKeyboard } from '@/app/shell/keyboard/use'
import EditorWorkspace from '@/components/editor/EditorWorkspace.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import type { FileRecord } from '../contracts/index'
import { readDownload } from '../transport/download'
import { loadFig } from './editor'

const props = defineProps<{ document: FileRecord; maxFileBytes: number }>()
const tab = createTab(),
  editor = tab.store
// Bind commands to this editor; the portal's hidden store has no listeners.
useKeyboard()
const abort = new AbortController()
const progress = ref('下載 .fig 至瀏覽器'),
  error = ref(''),
  ready = ref(false)
let disposed = false
function dispose() {
  if (disposed) return
  disposed = true
  abort.abort()
  void closeTab(tab.id, 'discard')
}
onMounted(async () => {
  window.addEventListener('pagehide', dispose)
  try {
    const response = await fetch(
      `/api/files/${encodeURIComponent(props.document.id)}/client-content?revision=${encodeURIComponent(props.document.revision)}`,
      {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: abort.signal
      }
    )
    if (response.headers.get('X-Document-Revision') !== props.document.revision)
      throw new Error('文件不可讀或來源已變更')
    const bytes = await readDownload(
      response,
      props.document.size,
      props.maxFileBytes,
      abort.signal,
      (read, total) => {
        progress.value = `下載 .fig · ${Math.round((read / total) * 100)}%`
      }
    )
    await loadFig(editor, bytes, props.document.name, abort.signal, (phase) => {
      progress.value = phase
    })
    ready.value = true
    progress.value = ''
  } catch (cause) {
    if (!abort.signal.aborted)
      error.value = cause instanceof Error ? cause.message : '無法開啟'
    progress.value = ''
  }
})
onUnmounted(() => {
  window.removeEventListener('pagehide', dispose)
  dispose()
})
</script>
<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <p v-if="progress" role="status" class="px-4 py-2">{{ progress }}</p>
    <p
      v-if="ready"
      data-test-id="client-edit-notice"
      class="px-4 py-2 text-sm text-muted"
    >
      瀏覽器編輯 · 修改只在記憶體，關閉後清除
    </p>
    <EditorWorkspace />
    <AppAlert
      v-if="error"
      heading="瀏覽器編輯器"
      :description="error"
      class="m-4"
    />
  </div>
</template>
