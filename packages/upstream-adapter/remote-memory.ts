// Private Chromium or explicitly enabled browser editor. Shell stores are ephemeral.
// Document recovery/autosave still use the adapter's existing readonly guards.
import 'fake-indexeddb/auto'
Reflect.set(globalThis, '__portalMemoryIDB', true)
