<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import type { ViewerManifest } from '../contracts/viewer'
import { MAX_VIEWPORT_BYTES } from '../contracts/viewer'
import { readDownload } from '../transport/download'
const props = defineProps<{
  manifest: ViewerManifest
  documentId: string
  revision: string
}>()
const viewport = ref<HTMLElement | null>(null)
const page = ref(props.manifest.pages[0]?.id ?? '')
const x = ref(0),
  y = ref(0),
  scale = ref(1)
const size = ref({ width: 1, height: 1 })
const image = ref(''),
  loading = ref(true),
  error = ref('')
const frame = ref({ x: 0, y: 0, scale: 1 })
const imageStyle = computed(() => ({
  width: size.value.width + 'px',
  height: size.value.height + 'px',
  transformOrigin: '0 0',
  transform: `translate(${(frame.value.x - x.value) * scale.value}px, ${(frame.value.y - y.value) * scale.value}px) scale(${scale.value / frame.value.scale})`
}))
const abort = new AbortController()
let observer: ResizeObserver | undefined,
  timer: ReturnType<typeof setTimeout> | undefined
let busy = false,
  queued = false,
  generation = 0,
  disposed = false
let drag:
  | { id: number; px: number; py: number; x: number; y: number }
  | undefined
function schedule() {
  loading.value = true
  generation++
  queued = true
  clearTimeout(timer)
  timer = setTimeout(() => void draw(), 150)
}
async function draw() {
  if (disposed || busy || !queued || !page.value) return
  busy = true
  queued = false
  loading.value = true
  const version = generation,
    selectedPage = page.value
  const current = { x: x.value, y: y.value, scale: scale.value }
  const width = size.value.width,
    height = size.value.height
  const ratio = Math.min(
    1,
    1536 / width,
    1536 / height,
    Math.sqrt(2097152 / (width * height))
  )
  try {
    const query = new URLSearchParams({
      revision: props.revision,
      page: selectedPage,
      x: String(current.x),
      y: String(current.y),
      scale: String(current.scale * ratio),
      width: String(Math.max(1, Math.floor(width * ratio))),
      height: String(Math.max(1, Math.floor(height * ratio)))
    })
    const response = await fetch(
      '/api/files/' +
        encodeURIComponent(props.documentId) +
        '/viewport?' +
        query,
      { credentials: 'same-origin', cache: 'no-store', signal: abort.signal }
    )
    if (response.status === 429) {
      queued = true
      timer = setTimeout(() => void draw(), 800)
      return
    }
    if (!response.ok || response.headers.get('Content-Type') !== 'image/webp')
      throw new Error('預覽不可用、登入已失效或來源已變更')
    if (response.headers.get('X-Document-Revision') !== props.revision)
      throw new Error('文件已變更，請重新開啟')
    const bytes = await readDownload(
      response,
      Number(response.headers.get('Content-Length')),
      MAX_VIEWPORT_BYTES,
      abort.signal,
      () => undefined
    )
    if (version !== generation || selectedPage !== page.value) {
      queued = true
      return
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }))
    const decoded = new Image()
    decoded.src = url
    try {
      await decoded.decode()
    } catch (e) {
      URL.revokeObjectURL(url)
      throw e
    }
    if (disposed || version !== generation) {
      URL.revokeObjectURL(url)
      return
    }
    const previous = image.value
    frame.value = current
    image.value = url
    await nextTick()
    if (previous) URL.revokeObjectURL(previous)
    error.value = ''
  } catch (e) {
    if (!disposed) {
      error.value = e instanceof Error ? e.message : '預覽失敗'
      clearImage()
    }
  } finally {
    busy = false
    if (queued && !disposed) {
      clearTimeout(timer)
      timer = setTimeout(() => void draw(), 150)
    } else loading.value = false
  }
}
function clearImage() {
  if (image.value) URL.revokeObjectURL(image.value)
  image.value = ''
}
function fit() {
  const bounds = props.manifest.pages.find((p) => p.id === page.value)?.bounds
  if (!bounds) return
  scale.value = Math.max(
    0.000001,
    Math.min(
      32,
      (size.value.width - 48) / bounds.width,
      (size.value.height - 48) / bounds.height
    )
  )
  x.value = bounds.x - (size.value.width / scale.value - bounds.width) / 2
  y.value = bounds.y - (size.value.height / scale.value - bounds.height) / 2
  schedule()
}
function select(id: string) {
  page.value = id
  clearImage()
  fit()
}
function zoom(
  factor: number,
  px = size.value.width / 2,
  py = size.value.height / 2
) {
  const previous = scale.value
  scale.value = Math.max(0.000001, Math.min(32, previous * factor))
  x.value += px / previous - px / scale.value
  y.value += py / previous - py / scale.value
  schedule()
}
function wheel(event: WheelEvent) {
  event.preventDefault()
  const rect = viewport.value?.getBoundingClientRect()
  if (rect)
    zoom(
      event.deltaY < 0 ? 1.15 : 1 / 1.15,
      event.clientX - rect.left,
      event.clientY - rect.top
    )
}
function down(event: PointerEvent) {
  if (event.button !== 0) return
  drag = {
    id: event.pointerId,
    px: event.clientX,
    py: event.clientY,
    x: x.value,
    y: y.value
  }
  viewport.value?.setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.id) return
  x.value = drag.x - (event.clientX - drag.px) / scale.value
  y.value = drag.y - (event.clientY - drag.py) / scale.value
  schedule()
}
function up() {
  drag = undefined
}
onMounted(() => {
  observer = new ResizeObserver((entries) => {
    const rect = entries[0]?.contentRect
    if (!rect || rect.width < 1 || rect.height < 1) return
    const first = size.value.width === 1
    size.value = {
      width: Math.floor(rect.width),
      height: Math.floor(rect.height)
    }
    if (first) fit()
    else schedule()
  })
  if (viewport.value) observer.observe(viewport.value)
})
onUnmounted(() => {
  disposed = true
  abort.abort()
  observer?.disconnect()
  clearTimeout(timer)
  clearImage()
})
</script>
<template>
  <div class="flex min-h-0 flex-1" data-test-id="raster-viewer">
    <aside class="w-52 shrink-0 overflow-auto border-r border-border p-3">
      <h2 class="mb-3 font-semibold">頁面</h2>
      <button
        v-for="item in manifest.pages"
        :key="item.id"
        class="mb-1 block w-full rounded px-3 py-2 text-left hover:bg-hover"
        :class="item.id === page ? 'bg-hover' : ''"
        data-test-id="pages-item"
        :aria-pressed="item.id === page"
        @click="select(item.id)"
      >
        {{ item.name }}
      </button>
    </aside>
    <div class="flex min-w-0 flex-1 flex-col">
      <div
        class="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2"
      >
        <button
          aria-label="縮小"
          class="rounded border border-border px-3"
          @click="zoom(1 / 1.25)"
        >
          −
        </button>
        <span data-test-id="viewer-zoom">{{ (scale * 100).toFixed(1) }}%</span>
        <button
          aria-label="放大"
          class="rounded border border-border px-3"
          @click="zoom(1.25)"
        >
          ＋
        </button>
        <button class="rounded border border-border px-3" @click="fit">
          符合頁面
        </button>
        <span v-if="loading" role="status" class="text-sm text-muted"
          >載入視窗預覽</span
        >
        <span v-if="error" role="alert" class="text-sm">{{ error }}</span>
      </div>
      <div
        ref="viewport"
        class="relative min-h-0 flex-1 touch-none overflow-hidden bg-neutral-100"
        style="cursor: grab"
        data-test-id="viewer-viewport"
        @wheel="wheel"
        @pointerdown="down"
        @pointermove="move"
        @pointerup="up"
        @pointercancel="up"
        @lostpointercapture="up"
      >
        <img
          v-if="image"
          :src="image"
          :style="imageStyle"
          class="pointer-events-none absolute left-0 top-0 max-w-none select-none"
          draggable="false"
          alt="設計頁面預覽"
          data-test-id="viewer-image"
        />
      </div>
    </div>
  </div>
</template>
