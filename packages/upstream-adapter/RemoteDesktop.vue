<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { createTab } from '@/app/tabs'
import { useKeyboard } from '@/app/shell/keyboard/use'
import EditorWorkspace from '@/components/editor/EditorWorkspace.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import { loadScene } from './editor'
import { readDownload } from '../transport/download'
import { MAX_SCENE_BYTES, SCENE_TYPE } from '../transport/scene-wire'
const editor = createTab().store
useKeyboard()
const progress = ref('伺服器載入文件'),
  error = ref('')
const abort = new AbortController()
const ticket = new URLSearchParams(location.search).get('ticket') ?? ''
const path = '/_remote/' + encodeURIComponent(ticket)
const begin = performance.now()
const timings: Record<string, number> = {}
onMounted(async () => {
  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error('內部會話無效')
    const metadataResponse = await fetch(path + '/metadata', {
      signal: abort.signal,
      cache: 'no-store'
    })
    if (!metadataResponse.ok) throw new Error('內部會話已結束')
    const metadata: { name: string; revision: string } =
      await metadataResponse.json()
    const response = await fetch(path + '/scene', {
      signal: abort.signal,
      cache: 'no-store'
    })
    if (
      response.headers.get('Content-Type') !== SCENE_TYPE ||
      response.headers.get('X-Document-Revision') !== metadata.revision
    )
      throw new Error('來源無法讀取')
    const bytes = await readDownload(
      response,
      Number(response.headers.get('Content-Length')),
      MAX_SCENE_BYTES,
      abort.signal,
      () => undefined
    )
    await loadScene(
      editor,
      bytes,
      metadata.name,
      abort.signal,
      (phase) => {
        progress.value = phase
      },
      (phase, elapsedMs) => {
        timings[phase] = elapsedMs
      }
    )
    progress.value = ''
    await fetch(path + '/ready', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ready: true,
        loadMs: performance.now() - begin,
        timings
      }),
      signal: abort.signal
    })
  } catch (cause) {
    if (abort.signal.aborted) return
    error.value = cause instanceof Error ? cause.message : '無法開啟'
    void fetch(path + '/ready', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ready: false })
    })
  }
})
onUnmounted(() => {
  abort.abort()
  editor.dispose()
})
</script>
<template>
  <div
    class="flex h-full min-h-0 flex-col bg-panel text-surface"
    @drop.capture.prevent.stop
    @dragover.prevent
  >
    <div v-if="progress" role="status" class="shrink-0 px-4 py-2">
      {{ progress }}
    </div>
    <EditorWorkspace />
    <AppAlert v-if="error" heading="無法讀取" :description="error" />
  </div>
</template>
