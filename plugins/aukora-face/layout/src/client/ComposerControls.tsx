import { useEffect, useRef, useState } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ComposerMode } from '../composer-mode-types.ts'
import { ActionButton } from './primitives.tsx'
import { NS } from './locales.ts'
import css from './ComposerControls.module.css'

interface ControlsInjected { selectMode(mode: 'read-only' | 'workspace-write'): Promise<void> }
type Props = PropsRuntime<'conversation.input.permission'> & InjectFace<ControlsInjected> & PropsLocale<'layout'>
const modes = ['read-only', 'workspace-write', 'danger-full-access'] as const
const copy = ['composer.chat', 'composer.build', 'composer.yolo'] as const

/** Current selection always comes from the host. Neither YOLO nor Vision has an activation path. */
export function ComposerControls({ locked, selectMode, useProjection, sessionId, t }: Props) {
  const state = useProjection('aukoraComposerMode')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const generation = useRef(0)
  useEffect(() => {
    generation.current++
    setBusy(false)
    setError(false)
    return () => { generation.current++ }
  }, [sessionId])
  const choose = async (mode: ComposerMode): Promise<void> => {
    if (mode === 'danger-full-access' || busy || locked || state?.available !== true || state.mode === mode) return
    const submittedGeneration = generation.current
    setBusy(true)
    setError(false)
    try { await selectMode(mode) }
    catch { if (generation.current === submittedGeneration) setError(true) }
    finally { if (generation.current === submittedGeneration) setBusy(false) }
  }
  const unavailable = state === undefined || !state.available
  return <div className={css.controls} aria-busy={busy} data-composer-mode={state?.mode ?? 'unknown'}>
    <div className={css.actions}>
      <div className={css.modes} role="group" aria-label={t('composer.mode')}>
        {modes.map((mode, index) => <ActionButton key={mode} variant={index === 0 ? 'green' : index === 1 ? 'blue' : 'gold'}
          className={css.mode} disabled={index === 2 || unavailable || locked || busy}
          aria-pressed={state === undefined ? undefined : state.mode === mode}
          title={index === 2 ? t('composer.yoloReason') : unavailable ? t('composer.modeUnavailable') : undefined}
          onClick={() => { void choose(mode) }}>{t(copy[index] ?? 'composer.mode')}</ActionButton>)}
      </div>
      <ActionButton variant="purple" className={css.vision} disabled title={t('composer.visionReason')}
        aria-label={t('composer.visionReason')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /><path d="m4 3 16 18" />
        </svg>{t('composer.visionUnavailable')}
      </ActionButton>
    </div>
    <span className={css.reason}>{t('composer.yoloReason')}</span>
    {state === undefined && <span className={css.state}>{t('composer.modeUnknown')}</span>}
    {state !== undefined && !state.available && <span className={css.state}>{t('composer.modeUnavailable')}</span>}
    {state?.mode === 'danger-full-access' && <span className={css.state}>{t('composer.currentYolo')}</span>}
    {error && <span className={css.error} role="alert">{t('composer.failed')}</span>}
  </div>
}

/** Replace the existing permission seat and inspect the canonical command's host outcome. */
export function installComposerControls(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.permission', () => ctx.slots.register({
    name: 'conversation.input.permission', priority: -10, locale: NS,
    inject: (sessionId: SessionId): ControlsInjected => ({
      selectMode: async mode => {
        const session = ctx.sessions.binding(sessionId)?.session
        if (session === undefined) throw new Error('Session unavailable')
        const remote = ctx.get('remote')
        if (remote?.commands === undefined) throw new Error('Command transport unavailable')
        const result = await remote.commands.execute(sessionId, `/aukora-mode ${mode}`, [])
        if (!result.ok || result.value?.result.kind !== 'success') {
          throw new Error('Mode change unavailable')
        }
      },
    }),
  }, ComposerControls))
}
