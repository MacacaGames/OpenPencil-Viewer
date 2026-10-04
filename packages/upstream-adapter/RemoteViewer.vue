<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
const props = defineProps<{
  documentId: string
  csrf: string
  editable: boolean
}>()
const frame = ref<HTMLIFrameElement | null>(null),
  url = ref(''),
  error = ref(''),
  progress = ref('伺服器準備會話')
let lease = '',
  timer: ReturnType<typeof setInterval> | undefined,
  disposed = false
const abort = new AbortController()
async function action(name: string, keepalive = false) {
  return fetch(`/api/remote/${lease}/${name}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': props.csrf },
    keepalive
  })
}
function dispose() {
  if (disposed) return
  disposed = true
  abort.abort()
  clearInterval(timer)
  url.value = ''
  frame.value?.remove()
  if (lease) void action('stop', true).catch(() => undefined)
}
function fullscreen() {
  void frame.value?.requestFullscreen()
}
onMounted(async () => {
  window.addEventListener('pagehide', dispose)
  try {
    const response = await fetch(
      `/api/files/${encodeURIComponent(props.documentId)}/remote`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': props.csrf },
        signal: abort.signal
      }
    )
    if (!response.ok) {
      const body = await response.json()
      throw new Error(
        body.error === 'remote-busy'
          ? '目前已有使用者使用遠端畫面，請稍後再試。'
          : '遠端會話無法啟動，請查看伺服器日誌。'
      )
    }
    const result: { id: string; url: string } = await response.json()
    lease = result.id
    if (disposed) {
      void action('stop')
      return
    }
    url.value = result.url
    progress.value = ''
    timer = setInterval(async () => {
      try {
        if (!(await action('renew')).ok) throw new Error('expired')
      } catch {
        error.value = '會話已到期或來源不可用，請重新開啟文件。'
        dispose()
      }
    }, 30000)
  } catch (cause) {
    if (!disposed) {
      progress.value = ''
      error.value = cause instanceof Error ? cause.message : '無法開啟'
    }
  }
})
onUnmounted(() => {
  window.removeEventListener('pagehide', dispose)
  dispose()
})
</script>
<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex shrink-0 items-center gap-3 px-4 py-2">
      <span role="status">{{
        progress ||
        (props.editable ? '遠端會話編輯 · 修改不儲存' : '伺服器唯讀畫面')
      }}</span>
      <button
        v-if="url"
        class="rounded border border-border px-3 py-1"
        @click="fullscreen"
      >
        全螢幕
      </button>
    </div>
    <iframe
      v-if="url"
      ref="frame"
      :src="url"
      title="OpenPencil 遠端畫面"
      class="min-h-0 w-full flex-1 border-0"
      allow="fullscreen"
    />
    <AppAlert
      v-if="error"
      heading="遠端會話"
      :description="error"
      class="m-4"
    />
  </div>
</template>
