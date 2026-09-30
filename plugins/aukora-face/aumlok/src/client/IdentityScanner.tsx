import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { decodeQrFrame } from '@aukora/face-messages/src/client/qr-scanner.ts'
import { parseContactInput } from '@aukora/face-messages/src/client/add-contact.ts'
import { IDENTITY_VERIFY_CONTACT_ENDPOINT, type VerifiedIdentityContact } from '../identity.ts'
import { IdentityAvatar, IdentityIcon } from './IdentityVisuals.tsx'
import { recordLocalInPersonVerification } from './identity-local.ts'
import type { AumlokKey } from './locales.ts'
import css from './Aumlok.module.css'

export function IdentityScanner({ ownerNpub, onClose, t }: {
  ownerNpub: string; onClose: () => void; t: (key: AumlokKey) => string
}) {
  const video = useRef<HTMLVideoElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const generation = useRef(0)
  const [attempt, setAttempt] = useState(0)
  const [peer, setPeer] = useState<VerifiedIdentityContact | null>(null)
  const [error, setError] = useState<AumlokKey | null>(null)
  const [saved, setSaved] = useState(false)
  const [checking, setChecking] = useState(false)
  const [expired, setExpired] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)

  useEffect(() => {
    setExpired(false)
    if (!peer || saved) return
    const expire = (): void => { setExpired(true); setError('identity.expiredContact') }
    if (peer.expiresAt <= Date.now()) { expire(); return }
    const timer = setTimeout(expire, peer.expiresAt - Date.now())
    return () => { clearTimeout(timer) }
  }, [peer, saved])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => { previous?.focus() }
  }, [])

  useEffect(() => {
    const token = ++generation.current
    let stopped = false
    let stream: MediaStream | undefined
    let frame: ReturnType<typeof setTimeout> | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    const request = new AbortController()
    const element = video.current
    const current = (): boolean => !stopped && generation.current === token
    const stopCamera = (): void => {
      clearTimeout(frame)
      stream?.getTracks().forEach(track => { track.stop() })
      if (element && element.srcObject === stream) { element.pause(); element.srcObject = null }
    }
    setPeer(null); setError(null); setSaved(false); setChecking(false); setCameraReady(false)
    const scan = async (): Promise<void> => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera:unavailable')
        const acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (!current()) { acquired.getTracks().forEach(track => { track.stop() }); return }
        stream = acquired
        if (!element) throw new Error('camera:unavailable')
        element.srcObject = acquired
        await element.play()
        if (!current()) { stopCamera(); return }
        setCameraReady(true)
        const canvas = document.createElement('canvas')
        const next = async (): Promise<void> => {
          try {
            const raw = await decodeQrFrame(element, canvas)
            if (!current()) return
            if (raw !== null) {
              // Freeze the scan before signature verification, even for a rejected contact.
              stopCamera()
              const parsed = parseContactInput(raw)
              if (!parsed.ok || parsed.source !== 'qr' || !parsed.binding || !parsed.controller || parsed.npub === ownerNpub) {
                setError('identity.invalidContact'); return
              }
              setChecking(true)
              deadline = setTimeout(() => { request.abort() }, 15_000)
              try {
                const response = await fetch(IDENTITY_VERIFY_CONTACT_ENDPOINT, { method: 'POST', signal: request.signal,
                  credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: raw })
                if (!current()) return
                if (!response.ok) {
                  const rejected = await response.json().catch(() => null) as { code?: unknown } | null
                  if (!current()) return
                  setError(rejected?.code === 'identity:expired-contact' ? 'identity.expiredContact'
                    : rejected?.code === 'identity:replayed-contact' ? 'identity.replayedContact'
                      : response.status === 400 ? 'identity.invalidContact' : 'identity.verificationError')
                  return
                }
                const verified = await response.json() as VerifiedIdentityContact
                if (!current()) return
                if (verified.npub !== parsed.npub || verified.controller !== parsed.controller
                  || !/^aukora:1:[0-9a-f]{64}$/u.test(verified.subject) || verified.label !== parsed.label
                  || !['TEST', 'BOUND', 'VERIFIED'].includes(verified.bindingState)
                  || verified.liveChallengePerformed !== false
                  || !/^[0-9a-f]{64}$/u.test(verified.nonce)
                  || !Number.isSafeInteger(verified.expiresAt) || verified.expiresAt <= Date.now()) {
                  setError('identity.invalidContact'); return
                }
                setPeer(verified)
              } catch {
                if (current()) setError('identity.verificationError')
              } finally {
                clearTimeout(deadline)
                if (current()) setChecking(false)
              }
              return
            }
            frame = setTimeout(() => { void next() }, 160)
          } catch {
            stopCamera()
            if (current()) setError('identity.cameraError')
          }
        }
        void next()
      } catch {
        stopCamera()
        if (current()) setError('identity.cameraError')
      }
    }
    void scan()
    return () => {
      stopped = true
      ++generation.current
      request.abort()
      clearTimeout(deadline)
      stopCamera()
    }
  }, [ownerNpub, attempt])

  return createPortal(<div className={css.identityScrim} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={dialog} className={css.identitySheet} role="dialog" aria-modal="true" aria-labelledby="identity-scanner-title" aria-describedby="identity-scanner-subtitle"
      tabIndex={-1} data-identity-scanner onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
        if (event.key === 'Tab') {
          const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), summary')
          const first = controls?.[0]; const last = controls?.[controls.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
            event.preventDefault(); last?.focus()
          } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
            event.preventDefault(); first?.focus()
          }
        }
      }}>
      <header className={css.identitySheetHeader}>
        <div><h3 id="identity-scanner-title">{t('identity.verify')}</h3>
          <p id="identity-scanner-subtitle">{t('identity.scanSubtitle')}</p></div>
        <button type="button" className={css.identityAction} aria-label={t('identity.close')} onClick={onClose}><IdentityIcon name="error" /></button>
      </header>
      {peer ? <div className={css.identityScanned}>
        <IdentityAvatar npub={peer.npub} /><h2>{peer.label || peer.npub}</h2>
        <button type="button" className={css.identityAction} data-labeled data-result={saved ? 'check' : undefined}
          disabled={saved || expired} aria-label={t(saved ? 'identity.verifiedLocally' : 'identity.confirm')}
          title={t(saved ? 'identity.verifiedLocally' : 'identity.localOnly')} onClick={() => {
            if (peer.expiresAt <= Date.now()) { setExpired(true); setError('identity.expiredContact'); return }
            try { recordLocalInPersonVerification(ownerNpub, peer); setSaved(true); setError(null) }
            catch (cause) { setError(cause instanceof Error && cause.message === 'identity:verification-conflict'
              ? 'identity.verificationConflict' : 'identity.storageError') }
          }}><IdentityIcon name="check" /><span>{t(saved ? 'identity.verifiedLocally' : 'identity.confirm')}</span></button>
      </div> : <div className={css.identityCameraFrame} data-scanning={!error && !checking || undefined} aria-busy={checking}>
        <video ref={video} className={css.identityCamera} muted playsInline aria-label={t('identity.scanCode')}
          hidden={!cameraReady || !!error || checking} />
        <div className={css.scanCorners} aria-hidden="true"><i /><i /><i /><i /></div>
        {error ? <div className={css.scannerMessage} data-warning={error !== 'identity.cameraError' || undefined} role="alert">
          <IdentityIcon name={error === 'identity.cameraError' ? 'camera' : 'rotate'} />
          <strong>{t(error)}</strong>
          {error === 'identity.cameraError' ? <p>{t('identity.cameraHelp')}</p> : null}
          <button type="button" className={css.identityAction} data-labeled onClick={() => { setAttempt(value => value + 1) }}>
            <IdentityIcon name="rotate" /><span>{t('identity.retry')}</span>
          </button>
        </div> : <div className={css.scannerMessage} data-live={cameraReady && !checking || undefined} role="status">
          <IdentityIcon name={checking ? 'lock' : 'camera'} />
          <strong>{t(checking ? 'identity.checking' : 'identity.scanCode')}</strong>
          {!cameraReady && !checking ? <p>{t('identity.cameraStarting')}</p> : null}
        </div>}
      </div>}
      {peer && error ? <p className={css.identityWarning} role="alert"><IdentityIcon name="rotate" /><span>{t(error)}</span></p> : null}
      {peer ? <button type="button" className={css.identityAction} data-labeled
        onClick={() => { setPeer(null); setAttempt(value => value + 1) }}><IdentityIcon name="camera" /><span>{t('identity.scanAgain')}</span></button> : null}
      <details className={css.scannerAbout}>
        <summary>{t('identity.moreVerifying')}<span className={css.portalChevron} aria-hidden="true" /></summary>
        <p>{t('identity.verifyingExplanation')}</p>
      </details>
    </div>
  </div>, document.body)
}
