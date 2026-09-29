import { mkdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import './noble-map.mjs'
const { runPatch } = await import('./run.mjs')
export { runPatch }

export const name = 'aukora-caged-worker'
export const inject = ['tools']
export function apply(ctx, config = {}) {
  const supportRoot = config.supportRoot ?? join(homedir(), 'Library', 'Application Support', 'AUKORA')
  const workspace = config.workspace ?? join(homedir(), 'aukora-live', 'workspace')
  if (!isAbsolute(workspace) || !isAbsolute(supportRoot)) throw new Error('adapter:absolute-owner-paths-required')
  let busy = false
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'aukora-caged-worker: stop worker')
  ctx.tools.register({ name: 'aukora_workspace_patch',
    description: 'Replace or create one file in the owner-selected workspace through a verified confined worker and the existing Aumlok approval popup. The worker cannot read the owner workspace or Git. Supply complete UTF-8 replacement content and the current SHA-256, or null for a new file. Approval is required for each patch.',
    parameters: { type: 'object', additionalProperties: false, required: ['workspace', 'path', 'beforeSha256', 'content'], properties: {
      workspace: { type: 'string', enum: ['selected'] }, path: { type: 'string' },
      beforeSha256: { type: ['string', 'null'] }, content: { type: 'string' },
    } }, timeoutMs: 340_000, isConcurrencySafe: () => false,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (busy) return JSON.stringify({ ok: false, state: 'REFUSED', reason: 'adapter:busy' })
      busy = true
      try {
        mkdirSync(workspace, { recursive: true, mode: 0o700 })
        const settings = { supportRoot: realpathSync(supportRoot), workspace: realpathSync(workspace),
          stateDir: join(supportRoot, 'state', 'home', 'caged-worker') }
        mkdirSync(settings.stateDir, { recursive: true, mode: 0o700 })
        return JSON.stringify(await runPatch(settings, args,
          exec?.signal ? AbortSignal.any([lifetime.signal, exec.signal]) : lifetime.signal))
      }
      catch (error) { return JSON.stringify({ ok: false, state: 'REFUSED', reason: String(error.message) }) }
      finally { busy = false }
    },
  })
  try { console.info('AUKORA_CAGED_WORKER_REGISTERED', ctx.tools.get?.('aukora_workspace_patch')?.name === 'aukora_workspace_patch') } catch { console.info('AUKORA_CAGED_WORKER_REGISTRY_UNVERIFIED') }
}
