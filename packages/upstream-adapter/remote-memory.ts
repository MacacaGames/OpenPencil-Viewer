// Private Chromium only. Native shell stores use memory and vanish on navigation.
// Document recovery/autosave still use the adapter's existing readonly guards.
import 'fake-indexeddb/auto'
Reflect.set(globalThis, '__portalMemoryIDB', true)
