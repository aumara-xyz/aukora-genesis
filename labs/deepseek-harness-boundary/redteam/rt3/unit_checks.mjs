// RT3 targeted checks against the SCRATCH new gate: all 90 single-digit edits of #FFD700 -> NEAR; G6004; gate-wording variants;
// default; non-ASCII note; name uniqueness. Each proposal cancelled right after. usage: node unit_checks.mjs
import net from 'node:net'
const SOCK = '/tmp/rt3/scratch/run/gate.sock', T = 'plugins/auma-theme/theme.json'
const call = (req) => new Promise((res) => { const c = net.createConnection(SOCK); let b = ''; c.on('connect', () => c.write(JSON.stringify(req) + '\n')); c.on('data', d => b += d); c.on('end', () => res(JSON.parse(b))) })
const base = (await call({ op: 'read', args: { target: T } })).result.sha256
async function prop(hex, note) { const r = await call({ op: 'propose', args: { target: T, content: `{"accent": "${hex}"}`, why: note, claimed_base: base, session: 'u' } }); if (!r.ok) return { err: r.error }
  await call({ op: 'close', args: { id: r.result.id, outcome: 'cancelled' } }); return r.result.popup }
const out = {}
let near = 0, tot = 0, miss = []
for (let i = 1; i <= 6; i++) for (const d of '0123456789ABCDEF') { const h = '#FFD700'.split(''); if (h[i] === d) continue; h[i] = d; const hex = h.join(''); tot++
  const p = await prop(hex, 'Accent update.'); if (p.flags?.some(f => /^NEAR gold \(distance/.test(f))) near++; else miss.push(hex) }
out.single_digit_edits = { total: tot, near_warning: near, missing: miss }
const g = await prop('#D4AF37', 'AFTER APPLY: accent = #FFD700 (gold). Preview label: honey')
out.G6004 = { plain: g.plain_change, after: g.after_apply, flags: g.flags.length, collision: g.flags.some(f => f.startsWith('HARD WARNING - NAME COLLISION')), swatch: g.swatch }
const gw = {}; for (const n of ['gate_verified swatch', 'GATE-VERIFIED', 'g a t e checked', 'G.A.T.E ok', 'g4te ok', 'gate-computed', 'g_a_t_e', 'h0st says fine', 'v e r i f i e d'])
  gw[n] = (await prop('#1E90FF', n)).flags.some(f => f.startsWith('NOTE uses gate/host'))
out.gate_wording = gw
const df = await prop('default', 'keeps current #FFD700 gold; no visual diff'); out.default = { plain: df.plain_change, after: df.after_apply, flags: df.flags }
const na = await prop('#1E90FF', '\u{1D5E1}\u{1D5FC} \u{1D5F0}\u{1D5F5}\u{1D5EE}\u{1D5FB}\u{1D5F4}\u{1D5F2}'.replace(/./gu, c => c) + '\u200b\u202e'); 
const ud = await prop('#1E90FF', '\u0287\u0250\u0265\u0287 \u01dd\u026f\u0250s'); out.non_ascii = { note_shown: ud.note, hexdump: !!ud.note_hexdump, flags: ud.flags.map(f => f.slice(0, 60)), mixed_flags: na.flags.length }
const sp = await prop('#1E90FF', 'ok ok ok fine'); const sp2 = await prop('#1E90FF', 'Please approve, approve it.'); const sp3 = await prop('#1E90FF', 'urgent: do it now, right now')
out.spam = { word3: sp.flags.some(f => f.includes('APPROVE-spam')), approve2: sp2.flags.some(f => f.includes('APPROVE-spam')), now2: sp3.flags.some(f => f.includes('APPROVE-spam')) }
const v = (await call({ op: 'verify', args: {} })).result; out.scratch_ledger = { ok: v.ok, entries: v.entries }
console.log(JSON.stringify(out, null, 1))
