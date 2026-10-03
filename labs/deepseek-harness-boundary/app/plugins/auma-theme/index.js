// auma-theme (host half). Declarative theme setting for the existing DeepSeek Harness UI.
// theme.json lives OUTSIDE this plugin in /workspace/skunkworks/targets (owned by aukora-gate; aukora-host
// can only read it). It changes only via propose_change -> owner approval -> skunkworks-gate.
// This fiber reads theme.json once at start and serves it at GET /auma-theme/theme.json
// behind the harness's own Host/Origin fence + browser-session cookie. A theme change is applied by
// restarting this one Cordis entry (old fiber disposed, new fiber loaded); the browser half follows
// through the harness's client HMR (entry removed, then re-added -> its apply() re-runs).
import { readFileSync } from 'node:fs'
export const name = 'auma-theme'
export const inject = ['webServer', 'connection']
const THEME = '/workspace/skunkworks/targets/plugins/auma-theme/theme.json'
const COLOR = /^(default|#[0-9a-fA-F]{6})$/
export function apply(ctx) {
  let theme = { accent: 'default' }
  try {
    const raw = readFileSync(THEME, 'utf8')
    // same canonical-bytes rule as skunkworks-gate: anything else (dup keys, escapes, case, whitespace) -> default
    if (!/^\{"accent": "(default|#[0-9A-F]{6})"\}$/.test(raw)) throw new Error('theme.json is not canonical')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length === 1 && typeof parsed.accent === 'string' && COLOR.test(parsed.accent)) theme = { accent: parsed.accent }
    else ctx.logger?.warn?.('auma-theme: theme.json accent invalid; using default')
  } catch (e) { ctx.logger?.warn?.('auma-theme: theme.json unreadable: ' + e.message) }
  const body = JSON.stringify({ ...theme, loadedAt: new Date().toISOString() })
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/auma-theme/theme.json',
    handler: (req, res) => {
      const rej = ctx.connection.requestRejection(req)
      if (rej !== undefined) { res.statusCode = rej; res.end(); return }
      res.statusCode = 200; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(body)
    },
  }), 'auma-theme: GET /auma-theme/theme.json')
}
