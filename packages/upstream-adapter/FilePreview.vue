<script setup lang="ts">
import { ref } from 'vue'
const props = defineProps<{
  id: string
  revision: string
  folder: boolean
  enabled: boolean
}>()
const failed = ref(false)
</script>
<template>
  <div
    class="flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-t-lg bg-hover"
  >
    <img
      v-if="props.enabled && !props.folder && !failed"
      :src="`/api/files/${props.id}/thumbnail?revision=${encodeURIComponent(props.revision)}`"
      alt=""
      loading="lazy"
      decoding="async"
      class="h-full w-full object-contain"
      referrerpolicy="no-referrer"
      @error="failed = true"
    />
    <svg
      v-else
      class="h-10 w-10 text-muted"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      aria-hidden="true"
    >
      <path
        v-if="props.folder"
        d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"
      />
      <template v-else>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="m5 17 5-5 4 4 3-3 3 3" />
        <circle cx="15" cy="8" r="1" />
      </template>
    </svg>
  </div>
</template>
