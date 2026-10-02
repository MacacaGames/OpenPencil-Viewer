import type { SceneGraph } from '@open-pencil/scene-graph'
const lockedGraphs = new WeakSet<object>()
const cloneSources = new WeakMap<object, object>()
// Native property inspection clones selected nodes. Return an independent copy
// without exposing the mutable object behind the readonly proxy.
export function cloneReadonlyValue<T>(value: T): T {
  const seen = new WeakMap<object, object>()
  const unwrap = (item: unknown): unknown => {
    if (!item || typeof item !== 'object') return item
    const source = cloneSources.get(item)
    if (source) return source
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) return item
    const prototype = Object.getPrototypeOf(item)
    if (prototype !== Object.prototype && prototype !== Array.prototype)
      return item
    const prior = seen.get(item)
    if (prior) return prior
    const copy: Record<string, unknown> | unknown[] = Array.isArray(item)
      ? []
      : {}
    seen.set(item, copy)
    for (const [key, child] of Object.entries(item))
      (copy as Record<string, unknown>)[key] = unwrap(child)
    return copy
  }
  // Core returns shallow node copies, whose nested fields can still be proxies.
  return structuredClone(unwrap(value)) as T
}
export const isReadonlyGraph = (graph: object) => lockedGraphs.has(graph)
// Rendering caches and layer expansion are view state at the pinned commit.
const VIEW_FIELDS = new Set<PropertyKey>(['textPicture', 'expanded'])
export function lockGraph(graph: SceneGraph) {
  if (lockedGraphs.has(graph)) return
  const seen = new WeakMap<object, object>()
  const protect = <T>(value: T, top = false): T => {
    if (
      value === null ||
      typeof value !== 'object' ||
      ArrayBuffer.isView(value) ||
      value instanceof ArrayBuffer
    )
      return value
    const prior = seen.get(value)
    if (prior) return prior as T
    const proxy = new Proxy(value, {
      get(target, key, receiver) {
        const item = Reflect.get(target, key, receiver)
        return typeof item === 'function' ? item : protect(item)
      },
      set(target, key, item) {
        if (top && VIEW_FIELDS.has(key)) return Reflect.set(target, key, item)
        return true
      },
      deleteProperty() {
        return true
      },
      defineProperty() {
        return false
      },
      setPrototypeOf() {
        return false
      }
    })
    seen.set(value, proxy)
    cloneSources.set(proxy, value)
    return proxy
  }
  for (const [id, node] of graph.nodes)
    graph.nodes.set(id, protect(structuredClone(node), true))
  for (const map of [
    graph.nodes,
    graph.variables,
    graph.variableCollections,
    graph.activeMode,
    graph.enabledLibraries
  ]) {
    // The type union is intentionally kept at the map boundary, never the graph API.
    const mutable = map as Map<string, unknown>
    if (graph.nodes !== map)
      for (const [key, value] of mutable)
        mutable.set(key, protect(structuredClone(value)))
    Object.defineProperties(mutable, {
      set: { value: () => mutable },
      delete: { value: () => false },
      clear: { value: () => undefined }
    })
  }
  const safe = new Set([
    'constructor',
    'getPages',
    'getAllNodes',
    'getNode',
    'onNodeEvents',
    'countDescendants',
    'getActiveModeId',
    'getNodeVariableModeId',
    'resolveVariable',
    'resolveColorVariable',
    'resolveNumberVariable',
    'resolveColorVariableForNode',
    'resolveNumberVariableForNode',
    'getVariablesForCollection',
    'getVariablesByType',
    'getChildren',
    'isContainer',
    'isDescendant',
    'clearAbsPosCache',
    'getAbsolutePosition',
    'getAbsoluteBounds',
    'hitTest',
    'hitTestDeep',
    'hitTestFrame',
    'getMainComponent',
    'getInstances',
    'flattenTree'
  ])
  for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(graph))) {
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(graph),
      name
    )
    if (typeof descriptor?.value === 'function' && !safe.has(name))
      Object.defineProperty(graph, name, { value: () => undefined })
  }
  Object.defineProperty(graph, 'documentColorSpace', {
    value: graph.documentColorSpace,
    writable: false
  })
  lockedGraphs.add(graph)
}
// Deny by default: future upstream actions need an explicit review to become available.
const READ_ACTIONS = new Set([
  'select',
  'clearSelection',
  'selectAll',
  'selectInverse',
  'setTool',
  'screenToCanvas',
  'setZoomAroundPoint',
  'applyZoom',
  'pan',
  'zoomToBounds',
  'zoomToFit',
  'zoomTo100',
  'zoomToLevel',
  'zoomToSelection',
  'getNode',
  'getPages',
  'getLayerTree',
  'getSelectedNodes',
  'getSelectedNode',
  'validateEnteredContainer',
  'setHoveredGuide',
  'setSelectedGuide',
  'setAutoLayoutHover',
  'getCurrentPage',
  'getActivePage',
  'getSelectionBounds',
  'getSelectionCapabilities',
  'getSelectionNodes',
  'getSelectionAncestorIds',
  // Native variables/binding panels keep these graph-backed read queries live.
  // Returned collections/values are already protected by lockGraph.
  'getVariablesByType',
  'getVariable',
  'resolveColorVariable',
  'resolveNumberVariable',
  'getVariablesForCollection',
  'getCollection',
  'getCollections',
  'getCollectionCount',
  'getVariableCount',
  'getEnteredContainer',
  'getEnteredContainerIds',
  'getNodeAtPoint',
  'hitTestAtPoint',
  'selectAtPoint',
  'selectInRect',
  'enterContainer',
  'exitContainer',
  'setHoveredNode',
  'setHoveredNodeId',
  'setMarquee',
  'setSnapGuides',
  'setLayoutInsertIndicator',
  'setDropTarget',
  'setMeasurementMode',
  'setMeasurementTarget',
  'setMeasurementModifiers',
  'setGuides',
  'setGuidePreview',
  'setGuideHover',
  'setGuideSelection',
  'setGuideRedline',
  'requestRender',
  'requestRepaint',
  'onEditorEvent',
  'setCanvasKit',
  'setNavigationPhase',
  'removeCanvasRenderer',
  'subscribeToGraph',
  'dispose',
  'releaseGraphResources',
  'isInteractiveEditing',
  'clearPageViewports',
  'switchPage',
  'preparePage',
  'commitPageSwitch',
  'loadPageNodes',
  'pageSwitchCount'
])
export function guardEditor<T extends object>(
  editor: T,
  getGraph: () => object
): T {
  for (const [name, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(editor)
  )) {
    if (typeof descriptor.value !== 'function') continue
    const original = descriptor.value as (...args: unknown[]) => unknown
    if (name === 'setTool') {
      Object.defineProperty(editor, name, {
        ...descriptor,
        value: (tool: unknown) => {
          if (
            !isReadonlyGraph(getGraph()) ||
            tool === 'SELECT' ||
            tool === 'HAND'
          )
            return original(tool)
        }
      })
      continue
    }
    if (READ_ACTIONS.has(name)) continue
    Object.defineProperty(editor, name, {
      ...descriptor,
      value: (...args: unknown[]) =>
        isReadonlyGraph(getGraph()) ? undefined : original(...args)
    })
  }
  return editor
}
