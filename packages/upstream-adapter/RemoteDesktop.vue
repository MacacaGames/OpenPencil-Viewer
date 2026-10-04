<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { createTab } from '@/app/tabs'
import { useKeyboard } from '@/app/shell/keyboard/use'
import EditorWorkspace from '@/components/editor/EditorWorkspace.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import { loadScene } from './editor'
import { readDownload } from '../transport/download'
import { MAX_SCENE_BYTES, SCENE_TYPE } from '../transport/scene-wire'
import type { RemoteDisplay } from '../contracts/remote-display'
const editor = createTab().store
useKeyboard()
const progress = ref('伺服器載入文件'),
  error = ref(''),
  editable = ref(false)
const abort = new AbortController()
const ticket = new URLSearchParams(location.search).get('ticket') ?? ''
const path = '/_remote/' + encodeURIComponent(ticket)
const begin = performance.now()
const timings: Record<string, number> = {}
let display: RemoteDisplay | undefined,
  displayTimer: ReturnType<typeof setInterval> | undefined,
  appliedFontSize = 0
function applyDisplay() {
  if (!display) return
  const dpr = window.devicePixelRatio || 1
  // Size rem-based UI in client CSS pixels; CanvasKit still renders its native DPR.
  const density = Math.min(
    (innerWidth * dpr) / display.cssWidth,
    (innerHeight * dpr) / display.cssHeight
  )
  const fontSize = (16 * density * display.uiScale) / dpr
  if (Math.abs(fontSize - appliedFontSize) < 0.01) return
  appliedFontSize = fontSize
  document.documentElement.style.fontSize = `${fontSize}px`
  document.body.style.fontSize = `${(13 * fontSize) / 16}px`
  editor.requestRender()
}
async function syncDisplay() {
  try {
    const response = await fetch(path + '/display', {
      signal: abort.signal,
      cache: 'no-store'
    })
    if (!response.ok) return
    display = (await response.json()).display
    applyDisplay()
  } catch {}
}
onMounted(async () => {
  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error('內部會話無效')
    const metadataResponse = await fetch(path + '/metadata', {
      signal: abort.signal,
      cache: 'no-store'
    })
    if (!metadataResponse.ok) throw new Error('內部會話已結束')
    const metadata: {
      name: string
      revision: string
      mode: string
      display?: RemoteDisplay
    } = await metadataResponse.json()
    display = metadata.display
    applyDisplay()
    window.addEventListener('resize', applyDisplay)
    displayTimer = setInterval(() => void syncDisplay(), 1000)
    editable.value = metadata.mode === 'session-edit'
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
      },
      editable.value
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
  clearInterval(displayTimer)
  window.removeEventListener('resize', applyDisplay)
  document.documentElement.style.fontSize = ''
  document.body.style.fontSize = ''
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
    <div
      v-if="editable"
      class="shrink-0 border-b border-border px-4 py-2 text-xs"
      data-test-id="session-edit-notice"
    >
      會話編輯 · 不儲存原檔 · 關閉或登出後修改會清除
    </div>
    <div v-if="progress" role="status" class="shrink-0 px-4 py-2">
      {{ progress }}
    </div>
    <EditorWorkspace />
    <AppAlert v-if="error" heading="無法讀取" :description="error" />
  </div>
</template>
