// RT3 live test: propose ONE change on the live gate as aukora-host (propose socket only; cannot approve).
// usage (as aukora-host): node live_propose.mjs '<content>' '<note>'   -> prints id8, AFTER APPLY, flag count/flags
import net from 'node:net'
const SOCK = '/run/skunkworks-gate/gate.sock', T = 'plugins/auma-theme/theme.json'
const call = (req) => new Promise((res) => { const c = net.createConnection(SOCK); let b = ''; c.on('connect', () => c.write(JSON.stringify(req) + '\n')); c.on('data', d => b += d); c.on('end', () => res(JSON.parse(b))); c.on('error', e => res({ ok: false, error: e.code })) })
const [, , content, note] = process.argv
const base = (await call({ op: 'read', args: { target: T } })).result.sha256
const r = await call({ op: 'propose', args: { target: T, content, why: note, claimed_base: base, session: 'rt3-live', call_id: 'rt3-live-' + Date.now() } })
console.log(JSON.stringify(r.ok ? { result: 'pending', id8: r.result.id.slice(0, 8), plain: r.result.popup.plain_change, after: r.result.popup.after_apply, swatch: r.result.popup.swatch, flags: r.result.popup.flags } : { result: 'refused', error: r.error.slice(0, 160) }, null, 1))
