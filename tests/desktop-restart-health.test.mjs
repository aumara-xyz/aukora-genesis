// Synthetic cookies and DOM only; no installed cookie values or owner state.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { pruneOwnedAuthCookies, INTERFACE_STATE_SCRIPT } from '../apps/aukora-desktop/backend-status.mjs'
import { bootVerdict } from '../scripts/aukora/become.mjs'
const url = 'http://127.0.0.1:64281/'
const cookieName = port => 'dsh-auth-' + createHash('sha256').update(`127.0.0.1:${port}`).digest('base64url')
const keep = { domain: '127.0.0.1', path: '/', name: cookieName(64281) }
let rows = [...Array.from({ length: 60 }, (_, i) => ({ ...keep, name: cookieName(60000 + i) })),
  keep, { ...keep, name: 'preferences' }, { ...keep, domain: 'localhost', name: cookieName(42) },
  { ...keep, path: '/other', name: cookieName(43) }]
const preserved = rows.slice(60)
let flushed = false
const cookies = { get: async () => rows, remove: async (origin, name) => {
  assert.equal(origin, url)
  rows = rows.filter(row => row.name !== name)
}, flushStore: async () => { flushed = true } }
assert.equal(await pruneOwnedAuthCookies(cookies, url), 60)
assert.deepEqual(rows, preserved)
assert.equal(flushed, true)
assert.equal(await pruneOwnedAuthCookies(cookies, url), 0)
await assert.rejects(pruneOwnedAuthCookies(cookies, 'https://example.com/'), /non-loopback/)
const state = (boot, controls) => runInNewContext(INTERFACE_STATE_SCRIPT, {
  document: { querySelector: selector => selector === '[data-dsh-boot]' ? boot : controls },
})
assert.equal(state({ textContent: 'Failed to load plugins' }, {}), 'failed')
assert.equal(state({ textContent: 'HARNESS loading' }, {}), 'loading')
assert.equal(state(null, null), 'loading')
assert.equal(state(null, {}), 'ready')
const origin = new URL(url).origin
const backend = `T log aukora-desktop: backend ${origin} · release sample · spatial frontend\n`
const loaded = `T log aukora-desktop: window loaded ${origin}\n`
const ready = `T log aukora-desktop: interface ready ${origin}\n`
assert.equal(bootVerdict(backend + loaded, 'sample'), null)
assert.equal(bootVerdict(backend + loaded + ready, 'sample')?.ok, true)
assert.equal(bootVerdict(backend + loaded + ready + loaded, 'sample'), null)
assert.equal(bootVerdict(backend + loaded + ready.replace('64281', '60000'), 'sample'), null)
assert.equal(bootVerdict(backend + loaded + 'T error aukora-desktop: interface failed\n', 'sample')?.ok, false)
// The former window-loaded-only rule accepts exactly the failed-start case above.
assert.equal((backend + loaded).includes('window loaded'), true)
console.log('PASS restart health: 60 stale cookies removed; current/unrelated preserved; plugin failure and HTML-only load never ready; mounted interface accepted')
