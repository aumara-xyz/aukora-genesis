import { useEffect, useId, useRef, useState } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ComposerMode } from '../composer-mode-types.ts'
import { NS } from './locales.ts'
import css from './ComposerControls.module.css'

interface ControlsInjected { selectMode(mode: 'read-only' | 'workspace-write'): Promise<void> }
type Props = PropsRuntime<'conversation.input.permission'> & InjectFace<ControlsInjected> & PropsLocale<'layout'>
const modes = ['read-only', 'workspace-write', 'danger-full-access'] as const
const copy = ['composer.chat', 'composer.build', 'composer.yolo'] as const

/** The dot and single label follow the host projection; unavailable controls never invent a selection. */
export function ComposerControls({ locked, selectMode, useProjection, sessionId, t }: Props) {
  const state = useProjection('aukoraComposerMode')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const generation = useRef(0)
  const hintId = useId()
  const visionHintId = useId()
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
  const index = state === undefined ? -1 : modes.indexOf(state.mode)
  const label = index < 0 ? '—' : t(copy[index] ?? 'composer.mode')
  const disabled = state === undefined || !state.available || locked || busy
  const hint = [t('composer.yoloReason'), state === undefined ? t('composer.modeUnknown')
    : !state.available ? t('composer.modeUnavailable') : state.mode === 'danger-full-access' ? t('composer.currentYolo') : '']
    .filter(Boolean).join(' ')
  return <div className={css.controls} aria-busy={busy} data-composer-mode={state?.mode ?? 'unknown'}>
    <span className={css.mode} data-mode={index} data-disabled={disabled || undefined} data-error={error || undefined} title={hint}>
      <span className={css.slider}>
        <span className={css.track} aria-hidden="true"><span className={css.fill} /><span className={css.dot} /></span>
        {index >= 0 && <input className={css.range} type="range" min="0" max="2" step="1" value={index}
          aria-label={t('composer.mode')} aria-valuetext={label} aria-describedby={hintId} disabled={disabled}
          onChange={event => {
            const requested = modes[Number(event.currentTarget.value)]
            // Native drag/key feedback must not move the visual dot ahead of the host.
            event.currentTarget.value = String(index)
            if (requested !== undefined) void choose(requested)
          }} />}
      </span>
      <span className={css.label} aria-hidden="true">{label}</span>
      <span id={hintId} className={css.srOnly}>{hint}</span>
    </span>
    <span className={css.vision} data-vision="unavailable" role="group" aria-label={t('composer.visionUnavailable')} aria-disabled="true"
      aria-describedby={visionHintId} title={t('composer.visionReason')}>
      <span className={css.slider} aria-hidden="true"><span className={css.track}>
        <span className={css.fill} /><span className={css.dot} />
      </span></span>
      <span className={css.label} aria-hidden="true">{t('composer.vision')}</span>
      <span id={visionHintId} className={css.srOnly}>{t('composer.visionReason')}</span>
    </span>
    <span className={css.srOnly} role="alert">{error ? t('composer.failed') : ''}</span>
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
