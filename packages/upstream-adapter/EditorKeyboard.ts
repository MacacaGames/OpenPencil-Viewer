import { defineComponent } from 'vue'
import { useKeyboard } from '@/app/shell/keyboard/use'

/** Native-view shortcuts follow the mounted editor's lifetime and active store. */
export default defineComponent({
  setup() {
    useKeyboard()
    return () => null
  }
})
