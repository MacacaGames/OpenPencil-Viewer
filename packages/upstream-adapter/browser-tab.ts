/** UI navigation keeps this identity; reload reuses it, a newly opened tab gets its own. */
export function browserTab() {
  let tab: string = crypto.randomUUID()
  try {
    const navigation = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    const saved = sessionStorage.getItem('portal.remoteTab')
    if (navigation?.type === 'reload' && saved && /^[a-f0-9-]{36}$/.test(saved))
      tab = saved
    sessionStorage.setItem('portal.remoteTab', tab)
  } catch {}
  return tab
}
export function nextTabRequest(tab: string, previous = 0) {
  // Date-based fallback remains monotonic even when storage is disabled.
  let request = Math.max(Date.now() * 1000, previous + 1)
  try {
    const key = 'portal.remoteRequest.' + tab
    request = Math.max(request, (Number(sessionStorage.getItem(key)) || 0) + 1)
    sessionStorage.setItem(key, String(request))
  } catch {}
  return request
}
