import { Card } from '@aukora/face-layout/client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { IDENTITY_CONTACT_ENDPOINT, type AumlokContactIdentity } from '../identity.ts'
import type { AumlokControlProjectionState } from './control-projection.ts'
import type { AumlokKey } from './locales.ts'
import { contactQrDataUrl } from '../contact-qr.ts'
import { IdentityAvatar, IdentityIcon, type IdentityIconName } from './IdentityVisuals.tsx'
import { IdentityScanner } from './IdentityScanner.tsx'
import { readLocalAvatar, saveLocalAvatar, removeLocalAvatar } from './identity-local.ts'
import css from './Aumlok.module.css'

export type ReadIdentity = (signal: AbortSignal) => Promise<AumlokContactIdentity>
function Action({ icon, label, run, disabled = false, labeled = false, t }: {
  icon: IdentityIconName; label: string; run: () => Promise<unknown>; disabled?: boolean; labeled?: boolean; t: (key: AumlokKey) => string
}) {
  const [result, setResult] = useState<'check' | 'error' | null>(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; clearTimeout(timer.current) }
  }, [])
  return <button type="button" className={css.identityAction} aria-label={result === 'error' ? `${label}: ${t('identity.failed')}` : label}
    title={result === 'error' ? t('identity.failed') : label}
    data-labeled={labeled || undefined}
    disabled={disabled || busy} data-result={result ?? undefined} onClick={() => {
      setBusy(true)
      setResult(null)
      void Promise.resolve().then(run).then(() => { if (mounted.current) setResult('check') }).catch((error: unknown) => {
        if (mounted.current && (!(error instanceof Error) || error.name !== 'AbortError')) setResult('error')
      }).finally(() => {
        if (!mounted.current) return
        setBusy(false)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => { setResult(value => value === 'check' ? null : value) }, 1800)
      })
    }}><IdentityIcon name={result ?? icon} />{labeled ? <span>{label}</span> : null}</button>
}

export function IdentityCard({ projection, active, readIdentity, refreshControlStatus, openAumlok, t }: {
  projection: AumlokControlProjectionState
  active: boolean
  readIdentity: ReadIdentity
  refreshControlStatus: () => void
  openAumlok: () => void
  t: (key: AumlokKey) => string
}) {
  const control = projection.status === 'connected' ? projection.control : null
  const reason = projection.status === 'not-connected' ? projection.reason : undefined
  // The loader disconnects before awaiting status. A bare absence is not a confirmed unbound owner.
  const pendingControl = control === null && reason === undefined
  const unbound = reason === 'controller-absent' || reason === 'adapter-unbound' || reason === 'no-controller-service'
  const revoked = control?.revoked === true
  const canRead = !revoked && (control !== null || unbound)
  const subject = control?.subject ?? null
  const handle = control?.handle
  // Identity-specific scalars survive equivalent projection objects without remounting or refetching.
  const principal = control === null ? 'unbound'
    : [subject, handle, control.epoch, control.activeControlDigest, control.approvalKeyDid].join('\n')
  const [result, setResult] = useState<{
    principal: string; identity: AumlokContactIdentity | null; failed: boolean
  } | null>(null)
  const current = useRef({ active, canRead, principal })
  current.current = { active, canRead, principal }
  const mismatchRefresh = useRef<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  // Guard during render, before effect cleanup: old contact data must never accompany a new principal.
  const identity = active && canRead && result?.principal === principal ? result.identity : null
  const failed = !pendingControl && !revoked && (!canRead || (result?.principal === principal && result.failed))
  useEffect(() => {
    if (!active || !canRead) return
    setResult(previous => previous?.principal === principal
      ? { ...previous, failed: false } : { principal, identity: null, failed: false })
    let stopped = false
    let request: AbortController | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    const refresh = async (): Promise<void> => {
      request = new AbortController()
      deadline = setTimeout(() => { request?.abort() }, 15_000)
      try {
        const next = await readIdentity(request.signal)
        if (stopped || !current.current.active || !current.current.canRead || current.current.principal !== principal) return
        const matches = next.subject === subject && (handle === undefined || next.label === handle)
        if (!matches) {
          // Keep this latch across the loader's disconnect/reconnect, even when it returns the same subject.
          if (subject !== null && mismatchRefresh.current !== principal) {
            mismatchRefresh.current = principal
            refreshControlStatus()
          }
          throw new Error('aumlok:identity-projection-changed')
        }
        mismatchRefresh.current = null
        setResult({ principal, identity: next, failed: false })
        timer = setTimeout(() => { void refresh() }, next.subject && !next.binding ? 2000 : 15_000)
      } catch {
        if (!stopped) setResult({ principal, identity: null, failed: true })
      } finally {
        clearTimeout(deadline)
      }
    }
    void refresh()
    return () => { stopped = true; request?.abort(); clearTimeout(timer); clearTimeout(deadline) }
  }, [active, canRead, principal, subject, handle, readIdentity, refreshControlStatus, attempt])

  if (identity) return <IdentityProfile key={`${principal}:${identity.npub}`} identity={identity} openAumlok={openAumlok} t={t} />
  return <Card className={css.identityCard} data-aumlok-identity data-state={revoked ? 'revoked' : failed ? 'failed' : 'loading'}>
    <header className={css.identityHeader}><IdentityAvatar /><h2>{control?.handle || t('identity.title')}</h2></header>
    <div className={css.identityQr} aria-busy={!failed && !revoked}>
      {revoked ? <span className={css.identityWarning} role="status" aria-label={t('identity.revoked')} title={t('identity.revoked')}><IdentityIcon name="error" /></span>
        : failed ? <button type="button" className={css.identityRetry} onClick={() => {
          mismatchRefresh.current = principal
          refreshControlStatus()
          setAttempt(value => value + 1)
        }}><IdentityIcon name="rotate" /><span>{t('identity.retry')}</span></button>
          : <span className={css.identityQrPending} role="status" aria-label={t('identity.loading')} />}
    </div>
    {unbound ? <button type="button" className={css.identityBind} onClick={openAumlok}>{t('runtime.binding.bind')}</button> : null}
  </Card>
}

function IdentityProfile({ identity, openAumlok, t }: {
  identity: AumlokContactIdentity; openAumlok: () => void; t: (key: AumlokKey) => string
}) {
  const [scanning, setScanning] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [photo, setPhoto] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  useEffect(() => {
    try { setPhoto(readLocalAvatar(identity.npub)); setPhotoError(false) }
    catch { setPhotoError(true) }
  }, [identity.npub])
  const [issued, setIssued] = useState<{ contact: string; name: string; expiresAt: number } | null>(null)
  const [contactError, setContactError] = useState(false)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const visible = (): void => {
      if (document.visibilityState !== 'visible') return
      setNow(Date.now())
      setAttempt(value => value + 1)
    }
    document.addEventListener('visibilitychange', visible)
    return () => { document.removeEventListener('visibilitychange', visible) }
  }, [])
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let expiry: ReturnType<typeof setTimeout> | undefined
    let request: AbortController | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    setIssued(null)
    const issue = async (): Promise<void> => {
      request = new AbortController()
      deadline = setTimeout(() => request?.abort(), 15_000)
      try {
        const response = await fetch(IDENTITY_CONTACT_ENDPOINT, { method: 'POST', signal: request.signal,
          credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ npub: identity.npub, subject: identity.subject }) })
        if (!response.ok) throw new Error('identity:contact-unavailable')
        const next = await response.json() as AumlokContactIdentity & { expiresAt: number }
        if (stopped) return
        if (next.npub !== identity.npub || next.subject !== identity.subject || !Number.isFinite(next.expiresAt)
          || next.expiresAt <= Date.now() || typeof next.contact !== 'string') throw new Error('identity:contact-changed')
        setIssued({ contact: next.contact, name: identity.label, expiresAt: next.expiresAt }); setContactError(false); setNow(Date.now())
        clearTimeout(expiry)
        expiry = setTimeout(() => { setNow(Date.now()) }, Math.max(0, next.expiresAt - Date.now()))
      } catch { if (!stopped) { setContactError(true); setIssued(null) } }
      finally {
        clearTimeout(deadline)
        if (!stopped) timer = setTimeout(() => { void issue() }, 30_000)
      }
    }
    void issue()
    return () => { stopped = true; request?.abort(); clearTimeout(timer); clearTimeout(expiry); clearTimeout(deadline) }
  }, [identity.label, identity.npub, identity.subject, attempt])
  const contact = issued?.name === identity.label && issued.expiresAt > now ? issued.contact : null
  const qr = useMemo(() => {
    try { return contact ? contactQrDataUrl(contact) : null } catch { return null }
  }, [contact])
  const copy = async (text: string): Promise<void> => { await navigator.clipboard.writeText(text) }
  const freshContact = (): string => {
    if (!contact || !issued || Date.now() >= issued.expiresAt) throw new Error('identity:expired-contact')
    return contact
  }
  const usable = qr !== null
  return <Card className={css.identityCard} data-aumlok-identity data-state={usable ? 'ready' : 'failed'}>
    <header className={css.identityHeader}>
      <div className={css.identityAvatarControls}>
        <button type="button" className={css.identityAvatarButton} aria-label={t('identity.choosePhoto')} title={t('identity.choosePhoto')}
          disabled={photoBusy} onClick={() => { picker.current?.click() }}><IdentityAvatar npub={identity.npub} photo={photo} /></button>
        <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''
          if (!file) return
          setPhotoBusy(true)
          void saveLocalAvatar(identity.npub, file).then(value => { setPhoto(value); setPhotoError(false) })
            .catch(() => { setPhotoError(true) }).finally(() => { setPhotoBusy(false) })
        }} />
        {photo ? <button type="button" className={css.identityAction} aria-label={t('identity.resetPhoto')} title={t('identity.resetPhoto')} disabled={photoBusy}
          onClick={() => { try { removeLocalAvatar(identity.npub); setPhoto(null); setPhotoError(false) } catch { setPhotoError(true) } }}><IdentityIcon name="rotate" /></button> : null}
        {photoError ? <span role="alert" className={css.identityStorageError} aria-label={t('identity.failed')}><IdentityIcon name="error" /></span> : null}
      </div>
      <h2 data-aumlok-owner>{identity.label || t('identity.title')}</h2>
      <button type="button" className={css.identityAction} data-labeled data-identity-verify onClick={() => { setScanning(true) }}>
        <IdentityIcon name="camera" /><span>{t('identity.verify')}</span>
      </button>
    </header>
    <div className={css.identityQrHalo} data-ready={usable || undefined}>
      <div className={css.identityQr} data-aumlok-contact-qr aria-busy={!usable && !contactError}>
        {usable ? <img src={qr!} alt={t('identity.qr')} draggable={false} />
          : contactError || (issued && !qr) ? <button type="button" className={css.identityRetry} aria-label={t('identity.retry')}
              onClick={() => { setAttempt(value => value + 1) }}><IdentityIcon name="rotate" /></button>
            : <span className={css.identityQrPending} role="status" aria-label={t('identity.loading')} />}
      </div>
    </div>
    <div className={css.identityActions}>
      <Action icon="copy" label={t('identity.copyContact')} disabled={!usable} labeled t={t} run={async () => {
        const payload = freshContact(); const png = await exportPng(payload)
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([payload], { type: 'text/plain' }), 'image/png': png })])
      }} />
      <Action icon="share" label={t('identity.share')} disabled={!usable} labeled t={t} run={async () => {
        const payload = freshContact()
        const file = new File([await exportPng(payload)], 'aumlok-contact.png', { type: 'image/png' })
        if (navigator.canShare?.({ files: [file] })) await navigator.share({ text: payload, files: [file] })
        else { const url = URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
      }} />
    </div>
    <div className={css.identityPortals}>
      <details className={css.identityPortal} data-identity-portal="root">
        <summary>
          <span className={css.portalIcon}><IdentityIcon name="key" /></span>
          <span className={css.portalHeading}><strong>{t('identity.id')}</strong><span>{t('identity.idSubtitle')}</span></span>
          <span className={css.portalChevron} aria-hidden="true" />
        </summary>
        <div className={css.portalContent}>
          <p>{t('identity.idExplanation')}</p>
          {identity.subject ? <code data-aumlok-subject>{identity.subject}</code>
            : <button type="button" className={css.identityBind} onClick={openAumlok}>{t('runtime.binding.bind')}</button>}
          <Action icon="copy" label={t('identity.copyId')} disabled={!identity.subject} labeled t={t} run={() => copy(identity.subject ?? '')} />
        </div>
      </details>
      <details className={css.identityPortal} data-identity-portal="nostr">
        <summary>
          <span className={css.portalIcon}><IdentityIcon name="network" /></span>
          <span className={css.portalHeading}><strong>{t('identity.nostr')}</strong><span>{t('identity.nostrSubtitle')}</span></span>
          <span className={css.portalChevron} aria-hidden="true" />
        </summary>
        <div className={css.portalContent}>
          <p>{t(identity.binding ? 'identity.nostrExplanation' : 'identity.nostrUnboundExplanation')}</p>
          <code data-aumlok-npub>{identity.npub}</code>
          <Action icon="copy" label={t('identity.copyNpub')} labeled t={t} run={() => copy(identity.npub)} />
        </div>
      </details>
      <details className={css.identityPortal} data-identity-portal="sharing">
        <summary>
          <span className={css.portalIcon}><IdentityIcon name="share" /></span>
          <span className={css.portalHeading}><strong>{t('identity.sharing')}</strong></span>
          <span className={css.portalChevron} aria-hidden="true" />
        </summary>
        <div className={css.portalContent}>
          <p>{t('identity.sharingContact')}</p>
          <p>{t('identity.sharingId')}</p>
          <p>{t('identity.sharingNostr')}</p>
        </div>
      </details>
    </div>
    {scanning ? <IdentityScanner ownerNpub={identity.npub} onClose={() => { setScanning(false) }} t={t} /> : null}
  </Card>
}

async function exportPng(payload: string): Promise<Blob> {
  const image = new Image()
  image.src = contactQrDataUrl(payload)
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth * 6; canvas.height = image.naturalHeight * 6
  const context = canvas.getContext('2d')
  if (!context) throw new Error('identity:png-unavailable')
  context.imageSmoothingEnabled = false
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('identity:png-unavailable')), 'image/png'))
}
