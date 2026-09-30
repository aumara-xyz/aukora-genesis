import { useEffect, useRef, useState } from 'react'
import type { AumlokContactIdentity } from '../identity.ts'
import type { AumlokControlProjection } from './control-projection.ts'
import type { AumlokKey } from './locales.ts'
import css from './Aumlok.module.css'

export type ReadIdentity = (signal: AbortSignal) => Promise<AumlokContactIdentity>
type IconName = 'copy' | 'share' | 'rotate' | 'check' | 'error'

function Icon({ name }: { name: IconName }) {
  const paths = {
    copy: 'M9 9h11v11H9z M15 5V2H2v13h3',
    share: 'M12 16V2 M7 7l5-5 5 5 M4 12v9h16v-9',
    rotate: 'M20 7a9 9 0 1 0 1 9 M20 2v6h-6',
    check: 'm4 12 5 5L20 6',
    error: 'm6 6 12 12 M6 18 18 6',
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}

function Action({ icon, label, run, disabled = false }: {
  icon: IconName; label: string; run: () => Promise<unknown>; disabled?: boolean
}) {
  const [result, setResult] = useState<'check' | 'error' | null>(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; clearTimeout(timer.current) }
  }, [])
  return <button type="button" className={css.identityAction} aria-label={label} title={label}
    disabled={disabled || busy} data-result={result ?? undefined} onClick={() => {
      setBusy(true)
      void run().then(() => { if (mounted.current) setResult('check') }).catch((error: unknown) => {
        if (mounted.current && (!(error instanceof Error) || error.name !== 'AbortError')) setResult('error')
      }).finally(() => {
        if (!mounted.current) return
        setBusy(false)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => { setResult(null) }, 1800)
      })
    }}><Icon name={result ?? icon} /></button>
}

export function IdentityCard({ control, active, readIdentity, rotate, t }: {
  control: Readonly<AumlokControlProjection>
  active: boolean
  readIdentity: ReadIdentity
  rotate?: () => void
  t: (key: AumlokKey) => string
}) {
  const [identity, setIdentity] = useState<AumlokContactIdentity | null>(null)
  useEffect(() => {
    setIdentity(null)
    if (!active) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async (): Promise<void> => {
      let bound = false
      try {
        const next = await readIdentity(controller.signal)
        if (controller.signal.aborted) return
        const matches = next.subject === control.subject
          && (control.handle === undefined || next.label === control.handle)
        setIdentity(matches ? next : null)
        bound = matches && next.binding !== null
      } catch {
        if (!controller.signal.aborted) setIdentity(null)
      }
      if (!controller.signal.aborted) timer = setTimeout(() => { void refresh() }, bound ? 15_000 : 2000)
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [active, control.subject, control.handle, control.epoch, readIdentity])

  const copy = async (text: string): Promise<void> => { await navigator.clipboard.writeText(text) }
  const share = async (): Promise<void> => {
    if (!identity) return
    if (typeof navigator.share === 'function') await navigator.share({ text: identity.contact })
    else await copy(identity.contact)
  }
  return <div className={css.identityCard} data-aumlok-identity>
    <header className={css.identityHeader}>
      <h2 id="aumlok-title" data-aumlok-owner>{control.handle || t('title')}</h2>
      {rotate ? <button type="button" className={css.identityAction} onClick={rotate}
        aria-label={t('surface.action.newPhrase')} title={t('surface.action.newPhrase')}>
        <Icon name="rotate" />
      </button> : null}
    </header>
    <div className={css.identityQr} data-aumlok-contact-qr>
      {identity?.qrDataUrl ? <img src={identity.qrDataUrl} alt={t('identity.qr')}
        draggable={false} /> : <span className={css.identityQrPending} aria-hidden="true" />}
    </div>
    <div className={css.identityValues}>
      <div className={css.identityValue}>
        <code data-aumlok-subject aria-label={t('identity.id')}>{control.subject}</code>
        <Action icon="copy" label={t('identity.copyId')} run={() => copy(control.subject)} />
      </div>
      <div className={css.identityValue}>
        <code data-aumlok-npub aria-label="npub">{identity?.npub ?? ''}</code>
        <Action icon="copy" label={t('identity.copyNpub')} disabled={!identity}
          run={() => copy(identity?.npub ?? '')} />
      </div>
    </div>
    <div className={css.identityActions}>
      <Action icon="copy" label={t('identity.copyContact')} disabled={!identity}
        run={() => copy(identity?.contact ?? '')} />
      <Action icon="share" label={t('identity.share')} disabled={!identity} run={share} />
    </div>
  </div>
}
