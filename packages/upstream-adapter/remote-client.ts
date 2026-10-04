// The pinned Selkies core reports pipeline readiness to its own window.
// Relay only that fixed signal to the same-origin Portal, never arbitrary payloads.
window.addEventListener('message', (event: MessageEvent) => {
  if (
    event.origin === location.origin &&
    event.source === window &&
    window.parent !== window &&
    event.data?.type === 'pipelineStatusUpdate' &&
    event.data.video === true
  )
    window.parent.postMessage({ type: 'portalStreamReady' }, location.origin)
})
