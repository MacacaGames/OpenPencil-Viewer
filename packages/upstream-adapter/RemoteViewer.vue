<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import type { RemoteDisplay } from '../contracts/remote-display'
import { nextTabRequest } from './browser-tab'
const props = defineProps<{
  documentId: string
  csrf: string
  editable: boolean
  tab: string
}>()
const frame = ref<HTMLIFrameElement | null>(null),
  container = ref<HTMLDivElement | null>(null),
  viewport = ref<HTMLDivElement | null>(null),
  uiScale = ref(1.25),
  url = ref(''),
  error = ref(''),
  progress = ref('伺服器準備會話')
let lease = '',
  timer: ReturnType<typeof setInterval> | undefined,
  disposed = false
let request = 0,
  opening = false
let observer: ResizeObserver | undefined,
  resizeTimer: ReturnType<typeof setTimeout> | undefined,
  display: RemoteDisplay | undefined,
  updating = false,
  dirty = false
try {
  const saved = Number(localStorage.getItem('portal.remoteUiScale'))
  if ([1, 1.25, 1.5, 1.75].includes(saved)) uiScale.value = saved
} catch {}
const abort = new AbortController()
async function action(name: string, keepalive = false) {
  return fetch(`/api/remote/${lease}/${name}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': props.csrf },
    keepalive
  })
}
function release(sequence: number, keepalive = false) {
  return fetch(`/api/remote-tab/${props.tab}/stop`, {
    method: 'POST',
    credentials: 'same-origin',
    keepalive,
    headers: { 'X-CSRF-Token': props.csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ request: sequence })
  }).catch(() => undefined)
}
function dispose() {
  if (disposed) return
  disposed = true
  abort.abort()
  clearInterval(timer)
  clearTimeout(resizeTimer)
  observer?.disconnect()
  url.value = ''
  frame.value?.remove()
  if (request) void release(request, true)
}
function fullscreen() {
  void container.value?.requestFullscreen()
}
function requestedDisplay() {
  const size = viewport.value?.getBoundingClientRect()
  return {
    width: Math.max(64, Math.min(8192, Math.round(size?.width ?? innerWidth))),
    height: Math.max(
      64,
      Math.min(8192, Math.round(size?.height ?? innerHeight))
    ),
    dpr: Math.max(0.5, Math.min(4, window.devicePixelRatio || 1)),
    uiScale: uiScale.value
  }
}
function fitScreen() {
  if (!display || !frame.value?.contentWindow) return
  const send = (value: object) =>
    frame.value?.contentWindow?.postMessage(value, location.origin)
  send({ type: 'setUseCssScaling', value: false, persist: false })
  // Portal drives this size from the live viewport; Selkies never stretches a fixed desktop.
  send({
    type: 'setManualResolution',
    width: display.width,
    height: display.height
  })
  send({ type: 'settings', settings: { scaling_dpi: display.dpi } })
}
async function syncDisplay() {
  if (!lease || disposed || opening) return
  const size = viewport.value?.getBoundingClientRect()
  // The file list hides this retained stream; keep its native canvas renderable.
  if (!size || size.width < 64 || size.height < 64) return
  if (updating) {
    dirty = true
    return
  }
  updating = true
  try {
    const response = await fetch(`/api/remote/${lease}/display`, {
      method: 'POST',
      credentials: 'same-origin',
      signal: abort.signal,
      headers: {
        'X-CSRF-Token': props.csrf,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestedDisplay())
    })
    if (!response.ok) throw new Error('display')
    display = (await response.json()).display
    fitScreen()
  } catch {
    if (!disposed) error.value = '無法調整遠端畫面，請重新開啟文件。'
  } finally {
    updating = false
    if (dirty) {
      dirty = false
      void syncDisplay()
    }
  }
}
function queueResize() {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => void syncDisplay(), 150)
}
function coreMessage(event: MessageEvent) {
  if (
    event.origin !== location.origin ||
    event.source !== frame.value?.contentWindow
  )
    return
  if (event.data?.type === 'portalStreamReady') fitScreen()
}
watch(uiScale, () => {
  try {
    localStorage.setItem('portal.remoteUiScale', String(uiScale.value))
  } catch {}
  queueResize()
})
onMounted(() => {
  window.addEventListener('pagehide', dispose)
  window.addEventListener('message', coreMessage)
  window.addEventListener('resize', queueResize)
  observer = new ResizeObserver(queueResize)
  if (viewport.value) observer.observe(viewport.value)
  void openDocument()
})
watch(
  () => props.documentId,
  () => void openDocument()
)
async function openDocument() {
  if (!props.documentId || disposed) return
  if (opening && request) void release(request)
  const sequence = nextTabRequest(props.tab, request)
  request = sequence
  opening = true
  clearInterval(timer)
  error.value = ''
  progress.value = lease ? '切換文件' : '伺服器準備會話'
  try {
    const response = await fetch(
      `/api/files/${encodeURIComponent(props.documentId)}/remote`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'X-CSRF-Token': props.csrf,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...requestedDisplay(),
          tab: props.tab,
          request: sequence
        })
      }
    )
    if (!response.ok) {
      const body = await response.json()
      throw new Error(
        body.error === 'remote-busy'
          ? '遠端會話已達上限，請關閉其他分頁的遠端會話後再試。'
          : '遠端會話無法啟動，請查看伺服器日誌。'
      )
    }
    const result: { id: string; url: string; display: RemoteDisplay } =
      await response.json()
    if (disposed || sequence !== request) {
      void release(sequence, true)
      return
    }
    lease = result.id
    display = result.display
    url.value = result.url
    queueResize()
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
    if (!disposed && sequence === request) {
      progress.value = ''
      error.value = cause instanceof Error ? cause.message : '無法開啟'
    }
  } finally {
    if (sequence === request) opening = false
  }
}
onUnmounted(() => {
  window.removeEventListener('pagehide', dispose)
  window.removeEventListener('message', coreMessage)
  window.removeEventListener('resize', queueResize)
  dispose()
})
</script>
<template>
  <div
    ref="container"
    class="flex min-h-0 flex-1 flex-col bg-panel text-surface"
  >
    <div class="flex shrink-0 flex-wrap items-center gap-3 px-4 py-2">
      <span role="status">{{
        progress ||
        (props.editable ? '遠端會話編輯 · 修改不儲存' : '伺服器唯讀畫面')
      }}</span>
      <label class="ml-auto flex items-center gap-2 text-sm"
        >文字大小
        <select
          v-model.number="uiScale"
          aria-label="遠端文字大小"
          class="rounded border border-border bg-panel px-2 py-1"
        >
          <option
            v-for="value in [1, 1.25, 1.5, 1.75]"
            :key="value"
            :value="value"
          >
            {{ Math.round(value * 100) }}%
          </option>
        </select>
      </label>
      <button
        v-if="url"
        class="rounded border border-border px-3 py-1"
        @click="syncDisplay"
      >
        符合視窗
      </button>
      <button
        v-if="url"
        class="rounded border border-border px-3 py-1"
        @click="fullscreen"
      >
        全螢幕
      </button>
    </div>
    <div ref="viewport" class="min-h-0 flex-1">
      <iframe
        v-if="url"
        ref="frame"
        :src="url"
        title="OpenPencil 遠端畫面"
        class="h-full w-full border-0"
        allow="fullscreen"
        @load="fitScreen"
      />
    </div>
    <AppAlert
      v-if="error"
      heading="遠端會話"
      :description="error"
      class="m-4"
    />
  </div>
</template>
