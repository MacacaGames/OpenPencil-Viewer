<script setup lang="ts">
import {
  ref,
  onMounted,
  onUnmounted,
  nextTick,
  defineAsyncComponent,
  watch
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { createTab } from '@/app/tabs'
import { loadScene } from '../../portal/upstream-adapter/editor'
import { readDownload } from '../../portal/transport/download'
import { MAX_SCENE_BYTES, SCENE_TYPE } from '../../portal/transport/scene-wire'
import RasterViewer from '../../portal/upstream-adapter/RasterViewer.vue'
import RemoteViewer from '../../portal/upstream-adapter/RemoteViewer.vue'
import ClientEditor from '../../portal/upstream-adapter/ClientEditor.vue'
import EditorKeyboard from '../../portal/upstream-adapter/EditorKeyboard'
import { browserTab } from '../../portal/upstream-adapter/browser-tab'
import FilePreview from '../../portal/upstream-adapter/FilePreview.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import type { FileRecord } from '../../portal/contracts/index'
import type { ViewerManifest } from '../../portal/contracts/viewer'
const manifest = ref<ViewerManifest | null>(null)
const documentId = ref('')
const revision = ref('')
const native = ref(false)
const remote = ref(false)
const editable = ref(false)
const allowClientEditor = ref(false),
  rendering = ref<'server' | 'client'>('server'),
  remoteDeployment = ref(false),
  remoteStarted = ref(false),
  selectedDocument = ref<FileRecord | null>(null)
const tab = browserTab(),
  router = useRouter(),
  route = useRoute()
let documentAbort: AbortController | undefined,
  loadRequest = 0
const editor = createTab().store
const EditorWorkspace = defineAsyncComponent(
  () => import('@/components/editor/EditorWorkspace.vue')
)
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
const fileView = ref<'cards' | 'list'>('cards')
try {
  if (localStorage.getItem('portal.fileView') === 'list')
    fileView.value = 'list'
} catch {}
function setFileView(value: 'cards' | 'list') {
  fileView.value = value
  try {
    localStorage.setItem('portal.fileView', value)
  } catch {}
}
let disposed = false
function dispose() {
  if (disposed) return
  disposed = true
  abort.abort()
  documentAbort?.abort()
  manifest.value = null
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
    signal: init.signal ?? abort.signal
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
  } else if (remoteDeployment.value)
    void router.push('/editor?id=' + encodeURIComponent(record.id))
  else location.assign('/editor?id=' + encodeURIComponent(record.id))
}
function blockDrop(event: DragEvent) {
  event.preventDefault()
  event.stopImmediatePropagation()
}
function cancel() {
  if (remoteDeployment.value) void router.push('/')
  else {
    dispose()
    location.assign('/')
  }
}
function returnToList(event: MouseEvent) {
  if (
    remoteDeployment.value &&
    !event.metaKey &&
    !event.ctrlKey &&
    event.button === 0
  ) {
    event.preventDefault()
    void router.push('/')
  }
}
function chooseRendering() {
  try {
    sessionStorage.setItem('portal.rendering', rendering.value)
  } catch {}
  remote.value = remoteDeployment.value && rendering.value === 'server'
  if (viewing.value) void loadLocation()
}
watch(
  () => route.fullPath,
  () => {
    if (me.value && remoteDeployment.value) void loadLocation()
  }
)
onMounted(async () => {
  window.addEventListener('pagehide', pageHidden)
  window.addEventListener('pageshow', pageShown)
  try {
    const mode = await api<{
      provider: string
      authorization: string
      viewer: string
      mode: string
      allowClientEditor: boolean
    }>('/auth/mode')
    provider.value = mode.provider
    authorization.value = mode.authorization
    native.value = mode.viewer === 'native'
    remoteDeployment.value = mode.viewer === 'selkies'
    allowClientEditor.value = mode.allowClientEditor
    try {
      if (
        allowClientEditor.value &&
        sessionStorage.getItem('portal.rendering') === 'client'
      )
        rendering.value = 'client'
    } catch {}
    remote.value = remoteDeployment.value && rendering.value === 'server'
    editable.value = remoteDeployment.value && mode.mode === 'session-edit'
    await refresh()
    await loadLocation()
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
async function loadLocation() {
  const request = ++loadRequest
  documentAbort?.abort()
  const loading = new AbortController()
  documentAbort = loading
  viewing.value = location.pathname === '/editor'
  error.value = ''
  ready.value = false
  progress.value = ''
  try {
    if (!viewing.value) {
      if (!roots.value.length)
        roots.value = (await api<{ items: FileRecord[] }>('/api/roots')).items
      if (!parent.value) parent.value = roots.value[0]?.id ?? ''
      await browse()
      return
    }
    const id = new URLSearchParams(location.search).get('id')
    if (!id) throw new Error('缺少文件 ID')
    const metadata = await api<FileRecord>(
      '/api/files/' + encodeURIComponent(id),
      { signal: loading.signal }
    )
    if (request !== loadRequest) return
    name.value = metadata.name
    selectedDocument.value = metadata
    await nextTick()
    documentId.value = id
    revision.value = metadata.revision
    if (native.value) {
      progress.value = '載入開發驗證場景'
      const response = await fetch(
        '/api/files/' + encodeURIComponent(id) + '/scene',
        {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: loading.signal
        }
      )
      if (
        response.headers.get('Content-Type') !== SCENE_TYPE ||
        response.headers.get('X-Document-Revision') !== metadata.revision
      )
        throw new Error('場景不可用或來源已變更')
      const bytes = await readDownload(
        response,
        Number(response.headers.get('Content-Length')),
        MAX_SCENE_BYTES,
        loading.signal,
        () => undefined
      )
      await loadScene(editor, bytes, metadata.name, loading.signal, (phase) => {
        progress.value = phase
      })
    } else if (!remote.value && rendering.value !== 'client') {
      progress.value = '伺服器準備預覽'
      manifest.value = await api<ViewerManifest>(
        '/api/files/' +
          encodeURIComponent(id) +
          '/viewer?revision=' +
          encodeURIComponent(metadata.revision)
      )
    }
    ready.value = true
    if (remote.value) remoteStarted.value = true
    progress.value = ''
  } catch (err) {
    if (
      abort.signal.aborted ||
      loading.signal.aborted ||
      request !== loadRequest
    )
      return
    if (err instanceof RequestError && err.status === 401 && !me.value) {
      if (viewing.value) location.replace('/')
      return
    }
    error.value = err instanceof Error ? err.message : '無法開啟'
    if (!me.value && viewing.value) location.replace('/')
  }
}
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
      <a href="/" class="font-semibold" @click="returnToList"
        >OpenPencil · LAN Portal</a
      >
      <span v-if="viewing" data-test-id="portal-document-name">{{ name }}</span>
      <span class="rounded border border-border px-2 py-1 text-xs">{{
        editable ? '會話編輯 · 不儲存' : '唯讀'
      }}</span>
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
      <label
        v-if="me && allowClientEditor"
        class="flex items-center gap-2 text-sm"
      >
        開啟方式
        <select
          v-model="rendering"
          aria-label="開啟方式"
          class="rounded border border-border bg-panel px-2 py-1"
          @change="chooseRendering"
        >
          <option value="server">伺服器畫面</option>
          <option value="client">瀏覽器編輯器</option>
        </select>
      </label>
      <button
        v-if="viewing && remoteDeployment"
        class="rounded border border-border px-3 py-1"
        @click="cancel"
      >
        返回文件列表
      </button>
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
        Google Workspace 登入後可瀏覽此入口掛載的所有設計文件。
        {{
          editable
            ? '可在遠端會話編輯，修改不儲存，關閉後清除。'
            : '使用唯讀 viewer。'
        }}
      </p>
      <p v-else>依你的 NAS 權限瀏覽 .fig，使用唯讀 viewer。</p>
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
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-8">
          <div class="flex items-center justify-between gap-4">
            <h1 class="text-xl font-semibold">設計文件</h1>
            <div
              role="group"
              aria-label="檔案顯示方式"
              class="flex rounded-lg border border-border p-1"
            >
              <button
                v-for="option in ['cards', 'list'] as const"
                :key="option"
                :aria-pressed="fileView === option"
                :class="[
                  'rounded px-3 py-1.5 text-sm',
                  fileView === option ? 'bg-hover text-surface' : 'text-muted'
                ]"
                @click="setFileView(option)"
              >
                {{ option === 'cards' ? '卡片' : '列表' }}
              </button>
            </div>
          </div>
          <form class="flex flex-wrap gap-3" @submit.prevent="browse()">
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
          <div
            :class="
              fileView === 'cards'
                ? 'portal-files-cards'
                : 'flex flex-col gap-2'
            "
            data-test-id="file-browser"
            :data-view="fileView"
          >
            <button
              v-for="file in files"
              :key="file.id + file.revision"
              :data-file-id="file.id"
              :aria-label="file.name"
              :class="[
                'overflow-hidden rounded-lg border border-border text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent',
                fileView === 'cards'
                  ? 'flex flex-col'
                  : 'flex items-center justify-between gap-4 px-4 py-3'
              ]"
              @dblclick="open(file)"
              @keydown.enter="open(file)"
            >
              <FilePreview
                v-if="fileView === 'cards'"
                :id="file.id"
                :revision="file.revision"
                :folder="file.kind === 'folder'"
                :enabled="authorization === 'google-mount'"
              />
              <div
                :class="
                  fileView === 'cards'
                    ? 'flex w-full flex-col gap-1 px-4 py-3'
                    : 'min-w-0 flex-1'
                "
              >
                <span class="block truncate font-medium">{{ file.name }}</span>
                <span class="block truncate text-xs text-muted">{{
                  file.kind === 'folder' ? '資料夾' : '.fig 設計文件'
                }}</span>
              </div>
              <span
                :class="[
                  'shrink-0 text-xs text-muted',
                  fileView === 'cards' ? 'px-4 pb-3' : ''
                ]"
                >{{
                  file.kind === 'file'
                    ? `${(file.size / 1048576).toFixed(2)} MiB`
                    : ''
                }}</span
              >
            </button>
          </div>
          <p v-if="!files.length && !error" class="text-muted">
            沒有可見文件。
          </p>
          <button
            v-if="next"
            class="rounded border border-border px-4 py-2"
            @click="browse(next ?? '0', true)"
          >
            載入更多
          </button>
        </div>
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
      <RasterViewer
        v-if="manifest && me"
        :manifest="manifest"
        :document-id="documentId"
        :revision="revision"
      />
      <ClientEditor
        v-else-if="
          allowClientEditor &&
          rendering === 'client' &&
          selectedDocument &&
          me &&
          ready
        "
        :key="selectedDocument.id + selectedDocument.revision"
        :document="selectedDocument"
        :max-file-bytes="me.maxFileBytes"
      />
      <template v-else-if="native">
        <EditorWorkspace />
        <EditorKeyboard v-if="ready" />
      </template>
    </template>
    <RemoteViewer
      v-if="remote && remoteStarted && documentId && me"
      v-show="viewing"
      :editable="editable"
      :document-id="documentId"
      :csrf="me.csrf"
      :tab="tab"
    />
    <AppAlert
      v-if="error"
      :description="error"
      heading="無法讀取"
      class="m-4"
    />
  </div>
</template>
<style scoped>
.portal-files-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr));
  gap: 1rem;
}
</style>
