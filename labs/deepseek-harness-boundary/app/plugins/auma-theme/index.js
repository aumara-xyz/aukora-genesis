// auma-theme (host half). Declarative theme setting for the existing DeepSeek Harness UI.
// The ONLY model-editable file of this plugin is theme.json (via propose_change + owner approval).
// This fiber reads theme.json once at start and serves it at GET /auma-theme/theme.json
// behind the harness's own Host/Origin fence + browser-session cookie. A theme change is applied by
// restarting this one Cordis entry (old fiber disposed, new fiber loaded); the browser half follows
// through the harness's client HMR (entry removed, then re-added -> its apply() re-runs).
import { readFileSync } from 'node:fs'
export const name = 'auma-theme'
export const inject = ['webServer', 'connection']
const COLOR = /^(default|#[0-9a-fA-F]{6})$/
export function apply(ctx) {
  let theme = { accent: 'default' }
  try {
    const parsed = JSON.parse(readFileSync(new URL('./theme.json', import.meta.url), 'utf8'))
    if (parsed && typeof parsed.accent === 'string' && COLOR.test(parsed.accent)) theme = { accent: parsed.accent }
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
