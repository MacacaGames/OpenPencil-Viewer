import { computed, ref } from 'vue'
import { DEFAULT_COLLAB_STATE, type CollabState } from '@/app/collab/types'
export function disabledCollaboration() {
  const state = ref<CollabState>({ ...DEFAULT_COLLAB_STATE, peers: [] })
  const deny = () => {
    throw new Error('collaboration-disabled')
  }
  return {
    state,
    remotePeers: computed(() => state.value.peers),
    followingPeer: ref<number | null>(null),
    connect: (_roomId: string) => deny(),
    disconnect: () => undefined,
    shareCurrentDoc: (): string => deny(),
    updateCursor: (_x: number, _y: number, _pageId: string) => undefined,
    updateSelection: (_ids: string[]) => undefined,
    setLocalName: (_name: string) => undefined,
    followPeer: (_id: number | null) => undefined
  }
}
