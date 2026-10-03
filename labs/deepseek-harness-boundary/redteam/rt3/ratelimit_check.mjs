// RT3 N1 check on the scratch gate built with real limits (RT3_WINDOW=3): limits are global, session labels don't matter.
import net from 'node:net'
const SOCK = '/tmp/rt3/scratch/run/gate.sock', T = 'plugins/auma-theme/theme.json', OWN = '/tmp/rt3/scratch/run/owner.sock'
const call = (req, s = SOCK) => new Promise((res) => { const c = net.createConnection(s); let b = ''; c.on('connect', () => c.write(JSON.stringify(req) + '\n')); c.on('data', d => b += d); c.on('end', () => res(JSON.parse(b))) })
const base = (await call({ op: 'read', args: { target: T } })).result.sha256
const P = (hex, sess) => call({ op: 'propose', args: { target: T, content: `{"accent": "${hex}"}`, why: 'test', claimed_base: base, session: sess } })
const o = []; const short = r => r.ok ? 'pending' : r.error.slice(0, 70)
const a = await P('#1E90FF', 's1'); o.push(['1st (s1)', short(a)])
o.push(['2nd while 1 pending (other session s2)', short(await P('#FF0000', 's2'))])
await call({ op: 'reject', args: { id: a.result.id } }, OWN)
o.push(['right after owner reject (new session s3)', short(await P('#008000', 's3'))])
console.log(JSON.stringify(o, null, 1))
