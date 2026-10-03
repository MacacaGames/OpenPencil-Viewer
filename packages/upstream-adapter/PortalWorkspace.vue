<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useKeyboard } from '@/app/shell/keyboard/use'
import { createTab } from '@/app/tabs'
import EditorWorkspace from '@/components/editor/EditorWorkspace.vue'
import FontStatusBanner from '@/components/font-status/FontStatusBanner.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import type { FileRecord } from '../../portal/contracts/index'
import { loadScene } from '../../portal/upstream-adapter/editor'
import { MAX_SCENE_BYTES, SCENE_TYPE } from '../../portal/transport/scene-wire'
import { readDownload } from '../../portal/transport/download'
const editor = createTab().store
useKeyboard()
const me = ref<{
    email: string
    csrf: string
    maxFileBytes: number
    authorization: string
  } | null>(null),
  provider = ref(''),
  authorization = ref(''),
  files = ref<FileRecord[]>([]),
  roots = ref<FileRecord[]>([]),
  parent = ref(''),
  query = ref(''),
  error = ref(''),
  progress = ref(''),
  ready = ref(false),
  name = ref(''),
  total = ref(0),
  next = ref<string | null>(null)
const viewing = ref(location.pathname === '/editor'),
  abort = new AbortController()
let disposed = false
function dispose() {
  if (disposed) return
  disposed = true
  abort.abort()
  editor.dispose()
}
function pageHidden() {
  dispose()
  document.body.replaceChildren()
}
function pageShown(event: PageTransitionEvent) {
  if (event.persisted) location.reload()
}
class RequestError extends Error {
  constructor(public status: number) {
    super(
      status === 401
        ? '登入已失效'
        : status === 404
          ? '文件不可讀或已移除'
          : status === 503
            ? 'NAS 或權限來源不可用'
            : '請求被拒絕'
    )
  }
}
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const result = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: abort.signal
  })
  if (!result.ok) throw new RequestError(result.status)
  return result.json() as Promise<T>
}
async function browse(cursor = '0', append = false) {
  error.value = ''
  try {
    const path = query.value
      ? '/api/search?q=' + encodeURIComponent(query.value)
      : '/api/files?parentId=' + parent.value
    const result = await api<{
      items: FileRecord[]
      total: number
      next: string | null
    }>(path + '&cursor=' + cursor)
    files.value = append ? [...files.value, ...result.items] : result.items
    total.value = result.total
    next.value = result.next
  } catch (err) {
    error.value = err instanceof Error ? err.message : '無法載入列表'
    files.value = []
  }
}
async function refresh() {
  me.value = await api('/api/me')
  if (viewing.value) return
  roots.value = (await api<{ items: FileRecord[] }>('/api/roots')).items
  parent.value = roots.value[0]?.id ?? ''
  await browse()
}
function changeSource() {
  query.value = ''
  void browse()
}
function returnToSource() {
  query.value = ''
  parent.value = roots.value[0]?.id ?? ''
  void browse()
}
async function login(account: string) {
  try {
    await api('/auth/mock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account })
    })
    location.assign('/')
  } catch (err) {
    error.value = String(err)
  }
}
async function logout() {
  if (!me.value) return
  try {
    await api('/auth/logout', {
      method: 'POST',
      headers: { 'X-CSRF-Token': me.value.csrf }
    })
  } finally {
    dispose()
    location.replace('/')
  }
}
function open(record: FileRecord) {
  if (record.kind === 'folder') {
    parent.value = record.id
    void browse()
  } else location.assign('/editor?id=' + encodeURIComponent(record.id))
}
function blockDrop(event: DragEvent) {
  event.preventDefault()
  event.stopImmediatePropagation()
}
function cancel() {
  dispose()
  location.assign('/')
}
onMounted(async () => {
  window.addEventListener('pagehide', pageHidden)
  window.addEventListener('pageshow', pageShown)
  try {
    const mode = await api<{ provider: string; authorization: string }>(
      '/auth/mode'
    )
    provider.value = mode.provider
    authorization.value = mode.authorization
    await refresh()
    if (!viewing.value) return
    const id = new URLSearchParams(location.search).get('id')
    if (!id) throw new Error('缺少文件 ID')
    const metadata = await api<FileRecord>(
      '/api/files/' + encodeURIComponent(id)
    )
    name.value = metadata.name
    await nextTick()
    progress.value = '伺服器解析文件'
    const response = await fetch(
      '/api/files/' + encodeURIComponent(id) + '/scene',
      { credentials: 'same-origin', cache: 'no-store', signal: abort.signal }
    )
    if (response.status === 429)
      throw new Error('伺服器正在解析其他文件，請稍後重試')
    if (!response.ok) throw new Error('文件不可讀、解析失敗或來源離線')
    if (response.headers.get('X-Document-Revision') !== metadata.revision)
      throw new Error('文件已變更，請重新開啟')
    if (response.headers.get('Content-Type') !== SCENE_TYPE)
      throw new Error('場景服務不可用')
    const bytes = await readDownload(
      response,
      Number(response.headers.get('Content-Length')),
      MAX_SCENE_BYTES,
      abort.signal,
      (read, size) => {
        progress.value = `載入場景 ${Math.round((read / size) * 100)}%`
      }
    )
    await loadScene(editor, bytes, metadata.name, abort.signal, (phase) => {
      progress.value = phase
    })
    ready.value = true
    progress.value = ''
  } catch (err) {
    if (abort.signal.aborted) return
    if (err instanceof RequestError && err.status === 401 && !me.value) {
      if (viewing.value) location.replace('/')
      return
    }
    error.value = err instanceof Error ? err.message : '無法開啟'
    if (!me.value && viewing.value) location.replace('/')
  }
})
onUnmounted(() => {
  window.removeEventListener('pagehide', pageHidden)
  window.removeEventListener('pageshow', pageShown)
  dispose()
})
</script>
<template>
  <div
    class="flex h-full min-h-0 flex-col bg-panel text-surface"
    @drop.capture="blockDrop"
    @dragover.prevent
  >
    <header
      class="flex shrink-0 items-center gap-4 border-b border-border px-5 py-3"
    >
      <a href="/" class="font-semibold">OpenPencil · LAN Portal</a>
      <span v-if="viewing" data-test-id="portal-document-name">{{ name }}</span>
      <span class="rounded border border-border px-2 py-1 text-xs">唯讀</span>
      <span
        v-if="authorization === 'google-mount'"
        class="text-xs text-muted"
        data-test-id="shared-browse-profile"
        >共用瀏覽驗證 · 不套用 DSM 個別權限</span
      >
      <span v-if="viewing && ready" class="text-xs text-muted"
        >來源：{{ me?.authorization === 'mock' ? 'Mock fixture' : 'NAS' }} ·
        讀取完成</span
      >
      <span class="ml-auto text-sm">{{ me?.email }}</span>
      <button
        v-if="me"
        class="rounded border border-border px-3 py-1"
        @click="logout"
      >
        登出
      </button>
    </header>
    <div v-if="!me" class="mx-auto my-16 flex max-w-lg flex-col gap-5 px-8">
      <h1 class="text-xl font-semibold">登入設計文件入口</h1>
      <p v-if="authorization === 'google-mount'">
        Google Workspace 登入後可瀏覽此入口掛載的所有設計文件，使用原生
        OpenPencil 唯讀檢視。
      </p>
      <p v-else>依你的 NAS 權限瀏覽 .fig，使用原生 OpenPencil 唯讀檢視。</p>
      <template v-if="provider === 'mock'">
        <p class="text-sm text-muted">
          本機 Mock：僅有合成文件，未驗證 DSM ACL。
        </p>
        <button
          class="rounded bg-accent px-4 py-2 text-white"
          data-test-id="login-A"
          @click="login('A')"
        >
          Mock 身份 A
        </button>
        <button
          class="rounded bg-accent px-4 py-2 text-white"
          data-test-id="login-B"
          @click="login('B')"
        >
          Mock 身份 B
        </button>
      </template>
      <a
        v-else-if="provider === 'google-oidc'"
        href="/auth/google/start"
        class="rounded bg-accent px-4 py-2 text-white"
        >Google Workspace 登入</a
      >
    </div>
    <template v-else-if="!viewing">
      <div class="mx-auto flex w-full max-w-5xl flex-col gap-5 px-8 py-8">
        <h1 class="text-xl font-semibold">設計文件</h1>
        <form class="flex gap-3" @submit.prevent="browse()">
          <select
            v-model="parent"
            aria-label="來源"
            class="rounded border border-border bg-panel px-3"
            @change="changeSource"
          >
            <option v-for="root in roots" :key="root.id" :value="root.id">
              {{ root.name }}
            </option>
          </select>
          <input
            v-model="query"
            aria-label="搜尋文件"
            placeholder="搜尋文件名稱或路徑"
            class="min-w-0 flex-1 rounded border border-border bg-panel px-3 py-2"
          />
          <button class="rounded border border-border px-4">搜尋</button>
          <button
            type="button"
            class="rounded border border-border px-4"
            @click="returnToSource"
          >
            回到來源
          </button>
        </form>
        <p class="text-sm text-muted">
          {{ total }} 項可見結果 · 雙擊開啟 · 原檔保留在 NAS
        </p>
        <button
          v-for="file in files"
          :key="file.id"
          :data-file-id="file.id"
          class="flex items-center justify-between rounded border border-border px-4 py-4 text-left hover:bg-hover"
          @dblclick="open(file)"
          @keydown.enter="open(file)"
        >
          <span
            >{{ file.kind === 'folder' ? '資料夾 · ' : ''
            }}{{ file.name }}</span
          ><span class="text-xs text-muted">{{
            file.kind === 'file'
              ? `${(file.size / 1048576).toFixed(2)} MiB`
              : ''
          }}</span>
        </button>
        <p v-if="!files.length && !error" class="text-muted">沒有可見文件。</p>
        <button
          v-if="next"
          class="rounded border border-border px-4 py-2"
          @click="browse(next ?? '0', true)"
        >
          載入更多
        </button>
      </div>
    </template>
    <template v-else>
      <div
        v-if="progress"
        role="status"
        class="flex shrink-0 items-center gap-4 border-b border-border px-5 py-2"
      >
        <span>{{ progress }}</span
        ><button class="rounded border border-border px-3 py-1" @click="cancel">
          取消
        </button>
      </div>
      <FontStatusBanner v-if="ready" />
      <EditorWorkspace />
    </template>
    <AppAlert
      v-if="error"
      :description="error"
      heading="無法讀取"
      class="m-4"
    />
  </div>
</template>
