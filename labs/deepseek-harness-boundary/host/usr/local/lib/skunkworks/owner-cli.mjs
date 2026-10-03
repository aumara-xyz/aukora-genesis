// skunkworks owner CLI — the box operator's OWNER path (acting on Peter's spoken decision).
// Runs as aukora-gate (via ops/owner-decide.sh -> sudo -u aukora-gate) and talks to /run/skunkworks-gate/owner.sock,
// which is 0600 aukora-gate: aukora-host/auma cannot connect. Approval is bound to id prefix + expected result sha256
// prefix, so the operator approves exactly the change that was read out to Peter.
// Honest note: the box user has full sudo, so the operator is trusted by construction; this path exists to keep
// the *harness* out of approvals, not to constrain the operator. Future: a Mac Touch ID / WebAuthn assertion over
// (id, base_sha, new_sha) would replace this sudo path and the owner bearer (design note only).
import net from 'node:net'
const call = (op, args) => new Promise((res, rej) => { const c = net.createConnection('/run/skunkworks-gate/owner.sock'); let b = ''
  c.on('connect', () => c.write(JSON.stringify({ op, args }) + '\n')); c.on('data', d => b += d); c.on('end', () => { const r = JSON.parse(b); r.ok ? res(r.result) : rej(new Error(r.error)) }); c.on('error', rej) })
const [op, pre, sha] = process.argv.slice(2)
const wita = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Asia/Makassar' }) + ' WITA'
const { pending } = await call('pending', {})
if (op === 'pending') { for (const p of pending) console.log(`${p.id.slice(0, 8)}  ${p.kind}  ${p.target}  ${p.base_sha.slice(0, 12)} -> ${p.new_sha.slice(0, 12)}  expires ${wita(p.expires)}  note: ${p.why ?? ''}`); if (!pending.length) console.log('no pending proposals'); process.exit(0) }
if (!['approve', 'reject'].includes(op) || !pre || pre.length < 8) { console.error('usage: owner-decide.sh pending | approve <id8+> <result-sha256-prefix(>=12)> | reject <id8+>'); process.exit(2) }
const m = pending.filter(p => p.id.startsWith(pre)); if (m.length !== 1) { console.error(`refused: ${m.length} pending proposals match ${pre}`); process.exit(3) }
const p = m[0]
if (op === 'approve' && (!sha || sha.length < 12 || !p.new_sha.startsWith(sha))) { console.error(`refused: expected result sha256 prefix (>=12 hex) must match the pending proposal (${p.new_sha.slice(0, 12)}…)`); process.exit(4) }
const r = await call(op, { id: p.id })
console.log(JSON.stringify({ proposal: p.id.slice(0, 8), result: r.state, applied: r.applied, message: r.message, ledger_seq: r.ledger_seq ?? null, approver: r.receipt?.approver ?? null, evidence_hmac: r.receipt?.approval_evidence_hmac ? r.receipt.approval_evidence_hmac.slice(0, 16) + '…' : null }))
