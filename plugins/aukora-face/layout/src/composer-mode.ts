import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { requiredConfinement } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from './composer-mode-types.ts'

/** Registers a read-only projection and a sandbox-only command. Installation never changes session state. */
export function installComposerMode(ctx: Context): void {
  ctx.inject(['sessionProjections', 'commands', 'sandboxPolicy'], scope => {
    const modeSchema = z.enum(['read-only', 'workspace-write', 'danger-full-access'])
    scope.sessionProjections.register({
      key: 'aukoraComposerMode', stateVersion: 1, stateSchema: modeSchema.nullable(),
      init: () => null,
      apply: (state, event) => event.type === 'sandbox/mode' ? event.data.mode : state,
      wire: {
        viewSchema: z.object({ mode: modeSchema, available: z.boolean() }),
        view: state => ({
          mode: state ?? scope.sandboxPolicy.defaultMode,
          available: typeof scope.get('aukoraConfinement')?.confine === 'function',
        }),
      },
    })
    scope.commands.register({
      definitionId: CommandDefinitionId('@aukora/composer-mode'), name: 'aukora-mode',
      description: 'Select confined Chat or Build mode without changing approval policy', input: { hint: '<read-only|workspace-write>' },
      handler: ({ agent, rawInput }) => {
        const requested = rawInput.trim()
        if (requested !== 'read-only' && requested !== 'workspace-write') {
          return { kind: 'error', text: 'Required confinement allows only Chat or Build; YOLO is unavailable.' }
        }
        try {
          const policy = scope.sandboxPolicy.resolve({ session: agent.session, mode: requested })
          requiredConfinement(scope, policy)
          if (scope.sandboxPolicy.resolve({ session: agent.session }).mode !== requested) {
            setSandboxMode(agent.session, requested)
          }
          if (scope.sandboxPolicy.resolve({ session: agent.session }).mode !== requested) {
            return { kind: 'error', text: 'The host did not confirm the requested sandbox mode.' }
          }
          return { kind: 'success', text: requested === 'read-only' ? 'Chat mode' : 'Build mode' }
        } catch {
          return { kind: 'error', text: 'Mode change unavailable; check the host-reported state.' }
        }
      },
    })
  })
}
