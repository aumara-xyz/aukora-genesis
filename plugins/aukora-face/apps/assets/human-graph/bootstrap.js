// This guard exists before the async module/data load so a closing iframe cannot
// create a late WebGL context. The shell also calls it synchronously on unmount.
const lifetime = new AbortController()
let disposeGraph = null
let starting = false
const controls = ['motion', 'home', 'zoom-in', 'zoom-out'].map(id => document.getElementById(id))
const fallback = document.getElementById('fallback')
const announcement = document.getElementById('announcement')
const listen = (target, name, fn) => target.addEventListener(name, fn, { signal: lifetime.signal })
function failed() {
  if (lifetime.signal.aborted) return
  disposeGraph?.()
  disposeGraph = null
  fallback.hidden = false
  controls.forEach(button => { button.disabled = true })
  announcement.textContent = 'Graph unavailable. Use the retry control to try WebGL again.'
}
async function start() {
  if (starting || lifetime.signal.aborted) return
  starting = true
  fallback.hidden = true
  controls.forEach(button => { button.disabled = true })
  disposeGraph?.()
  disposeGraph = null
  try {
    const { mountGraph } = await import('./graph.js')
    lifetime.signal.throwIfAborted()
    disposeGraph = await mountGraph(lifetime.signal, failed)
    lifetime.signal.throwIfAborted()
    controls.forEach(button => { button.disabled = false })
  } catch {
    disposeGraph?.()
    disposeGraph = null
    failed()
  } finally { starting = false }
}
window.disposeHumanGraph = () => {
  lifetime.abort()
  disposeGraph?.()
  disposeGraph = null
  delete window.disposeHumanGraph
}
listen(window, 'pagehide', () => window.disposeHumanGraph?.())
listen(window, 'message', event => {
  if (event.source !== window.parent || event.origin !== window.location.origin) return
  if (event.data?.source === 'aukora-shell' && event.data.type === 'surface-active'
    && event.data.app === 'human-graph' && event.data.active === false) window.disposeHumanGraph?.()
})
listen(document.getElementById('close'), 'click', () => {
  window.disposeHumanGraph?.()
  if (window.parent !== window) window.parent.postMessage({ source: 'aukora-human-graph', type: 'close' }, window.location.origin)
  else window.location.replace('about:blank')
})
// A fresh document resets both a lost canvas context and failed module imports.
listen(document.getElementById('retry'), 'click', () => window.location.reload())
void start()
