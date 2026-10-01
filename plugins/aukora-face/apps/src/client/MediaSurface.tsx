import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { ActionButton, Panel, SectionHeader } from '@aukora/face-layout/client'
import type { StockAppSurfaceProps } from './contract.ts'
import { isEditableTarget } from './EmbeddedAppSurface.tsx'
import stockCss from './StockApps.module.css'
import css from './MediaSurface.module.css'

type Mode = 'image' | 'video'
const IMAGE_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '7:9', '9:7', '9:16', '16:9', '21:9']
const VIDEO_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']
const DURATIONS = Array.from({ length: 12 }, (_, index) => index + 4)

/** Small native outline glyphs; no remote media or simulated generation results. */
function MediaIcon({ kind }: { kind: 'image' | 'video' | 'settings' | 'close' | 'lock' | 'gallery' }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'image' && <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 6-6 4 4 3-3 5 5" /></>}
    {kind === 'video' && <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m10 8 6 4-6 4Z" /></>}
    {kind === 'settings' && <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>}
    {kind === 'close' && <path d="m6 6 12 12M6 18 18 6" />}
    {kind === 'lock' && <><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2" /></>}
    {kind === 'gallery' && <><rect x="7" y="7" width="14" height="14" rx="3" /><path d="M17 3H6a3 3 0 0 0-3 3v11M11 16l3-3 3 3" /></>}
  </svg>
}

function MediaSettings({ t, onDismiss, trigger }: {
  t: StockAppSurfaceProps['t']; onDismiss: () => void; trigger: RefObject<HTMLButtonElement>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const id = useId()
  useLayoutEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => {
      // Entry is disabled in this pass. Reset and unmount the fields on every dismissal regardless.
      form.current?.reset()
      element?.close()
      if (trigger.current?.closest('[data-active]')) trigger.current.focus()
    }
  }, [trigger])
  return <dialog ref={dialog} className={css.dialog} aria-labelledby={`${id}-title`}
    aria-describedby={`${id}-reason`} onCancel={event => { event.preventDefault(); onDismiss() }}
    onClick={event => { if (event.target === event.currentTarget) onDismiss() }}>
    <Panel className={css.settingsPanel}>
      <SectionHeader className={css.settingsHeader}>
        <span className={css.gold}><MediaIcon kind="settings" /></span>
        <h2 id={`${id}-title`}>{t('media.settings')}</h2>
        <ActionButton autoFocus variant="gold" aria-label={t('media.closeSettings')} onClick={onDismiss}>
          <MediaIcon kind="close" />
        </ActionButton>
      </SectionHeader>
      <div className={css.provider}><span>Higgsfield</span><span className={css.disconnected}>{t('media.disconnected')}</span></div>
      <form ref={form} autoComplete="off" onSubmit={event => event.preventDefault()}>
        <label className={css.field}>{t('media.keyId')}
          <input type="text" disabled defaultValue="" autoComplete="off" aria-describedby={`${id}-reason`} />
        </label>
        <label className={css.field}>{t('media.keySecret')}
          <input type="password" disabled defaultValue="" autoComplete="new-password" aria-describedby={`${id}-reason`} />
        </label>
        <p id={`${id}-reason`} className={css.settingsReason}>{t('media.credentialsUnavailable')}</p>
        <div className={css.settingsActions}>
          <ActionButton variant="gold" onClick={onDismiss}>{t('media.cancel')}</ActionButton>
          <ActionButton variant="green" disabled aria-describedby={`${id}-reason`}>{t('media.saveConnect')}</ActionButton>
        </div>
      </form>
    </Panel>
  </dialog>
}

/** Native Apps seat. Draft controls are local only; provider and credential actions are unavailable. */
export function MediaSurface({ activeSurface, closeSurface, t }: StockAppSurfaceProps) {
  const active = activeSurface === 'media'
  const surface = useRef<HTMLDivElement>(null)
  const settingsTrigger = useRef<HTMLButtonElement>(null)
  const imageTab = useRef<HTMLButtonElement>(null)
  const videoTab = useRef<HTMLButtonElement>(null)
  const id = useId()
  const [mode, setMode] = useState<Mode>('image')
  const [drafts, setDrafts] = useState({ image: '', video: '' })
  const [imageRatio, setImageRatio] = useState('1:1')
  const [videoRatio, setVideoRatio] = useState('16:9')
  const [videoResolution, setVideoResolution] = useState('1080p')
  const [duration, setDuration] = useState(8)
  const [audio, setAudio] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const video = mode === 'video'
  const ratio = video ? videoRatio : imageRatio
  const [width = 1, height = 1] = ratio.split(':').map(Number)

  useEffect(() => {
    if (!active) {
      setSettingsOpen(false)
      const focused = document.activeElement
      if (focused instanceof HTMLElement && surface.current?.contains(focused)) focused.blur()
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || settingsOpen || isEditableTarget(event.target)) return
      event.preventDefault()
      closeSurface()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [active, closeSurface, settingsOpen])

  const selectMode = (next: Mode, focus = false): void => {
    setMode(next)
    if (focus) (next === 'image' ? imageTab : videoTab).current?.focus()
  }
  return <div {...(active ? {} : { inert: '' })} ref={surface} data-stock-app="media"
    data-active={active ? '' : undefined} aria-hidden={!active}
    className={`${stockCss.surfaceSeat} ${css.surface}`}>
    <div className={css.content}>
      <SectionHeader className={css.header}>
        <span className={css.brandIcon}><MediaIcon kind="gallery" /></span><h1>{t('media.name')}</h1>
        <div className={css.headerActions}>
          <ActionButton ref={settingsTrigger} variant="gold" onClick={() => setSettingsOpen(true)}>
            <MediaIcon kind="settings" />{t('media.settings')}
          </ActionButton>
          <ActionButton variant="blue" aria-label={t('media.close')} onClick={closeSurface}><MediaIcon kind="close" /></ActionButton>
        </div>
      </SectionHeader>
      <div className={css.workspace}>
        <Panel className={css.composer}>
          <div className={css.modeSwitch} role="tablist" aria-label={t('media.mode')}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              selectMode(event.key === 'Home' ? 'image' : event.key === 'End' ? 'video' : video ? 'image' : 'video', true)
            }}>
            {(['image', 'video'] as const).map(value => <ActionButton key={value}
              ref={value === 'image' ? imageTab : videoTab} role="tab" id={`${id}-${value}-tab`}
              aria-selected={mode === value} aria-controls={`${id}-editor`} tabIndex={mode === value ? 0 : -1}
              aria-pressed={mode === value} variant={value === 'image' ? 'blue' : 'purple'} onClick={() => selectMode(value)}>
              <MediaIcon kind={value} />{t(value === 'image' ? 'media.image' : 'media.video')}
            </ActionButton>)}
          </div>
          <div id={`${id}-editor`} role="tabpanel" aria-labelledby={`${id}-${mode}-tab`} className={css.editor}>
            <label className={css.promptLabel} htmlFor={`${id}-prompt`}>{t('media.prompt')}</label>
            <textarea id={`${id}-prompt`} className={css.prompt} rows={5} value={drafts[mode]}
              maxLength={video ? 4000 : 800} placeholder={t(video ? 'media.videoPlaceholder' : 'media.imagePlaceholder')}
              onChange={event => setDrafts(previous => ({ ...previous, [mode]: event.target.value }))} />
            <div className={css.controls}>
              <label className={`${css.field} ${css.model}`}>{t('media.model')}
                <select value={video ? 'seedance2' : 'z-image-turbo'} onChange={() => {}}>
                  <option value={video ? 'seedance2' : 'z-image-turbo'}>{video ? 'Seedance 2.0' : 'Z-Image Turbo'}</option>
                </select>
              </label>
              <label className={css.field}>{t('media.ratio')}
                <select value={ratio} onChange={event => (video ? setVideoRatio : setImageRatio)(event.target.value)}>
                  {(video ? VIDEO_RATIOS : IMAGE_RATIOS).map(value => <option key={value}>{value}</option>)}
                </select>
              </label>
              <label className={css.field}>{t('media.resolution')}
                <select value={video ? videoResolution : '1k'} onChange={event => { if (video) setVideoResolution(event.target.value) }}>
                  {(video ? ['480p', '720p', '1080p', '4k'] : ['1k']).map(value => <option key={value}>{value}</option>)}
                </select>
              </label>
              {video && <label className={css.field}>{t('media.duration')}
                <select value={duration} onChange={event => setDuration(Number(event.target.value))}>
                  {DURATIONS.map(value => <option key={value} value={value}>{value} s</option>)}
                </select>
              </label>}
              {video && <label className={css.audio}>{t('media.audio')}
                <input type="checkbox" role="switch" checked={audio} onChange={event => setAudio(event.target.checked)} />
              </label>}
            </div>
          </div>
          <div className={css.generateArea}>
            <ActionButton className={css.generate} variant="green" disabled aria-describedby={`${id}-unavailable`}>
              <MediaIcon kind="lock" />{t('media.generate')}
            </ActionButton>
            <p id={`${id}-unavailable`} className={css.reason}>{t('media.generationUnavailable')}</p>
          </div>
        </Panel>
        <Panel className={css.preview}>
          <SectionHeader className={css.previewHeader}><h2>{t('media.preview')}</h2>
            <span>{ratio}<span className={css.dot}>·</span>{video ? videoResolution : '1k'}{video && <><span className={css.dot}>·</span>{duration} s</>}</span>
          </SectionHeader>
          <div className={css.previewCanvas}>
            <div className={css.emptyFrame} data-media-ratio={ratio}
              style={{ aspectRatio: `${width} / ${height}`, width: `min(100%, ${280 * width / height}px)` }}>
              <span className={css.emptyIcon}><MediaIcon kind={mode} /></span>
            </div>
            <span className={css.emptyCaption}>{t('media.noPreview')}</span>
          </div>
        </Panel>
      </div>
      <Panel className={css.gallery}>
        <SectionHeader className={css.galleryHeader}><span className={css.purple}><MediaIcon kind="gallery" /></span><h2>{t('media.gallery')}</h2><span className={css.count}>0</span></SectionHeader>
        <div className={css.galleryEmpty}><span className={css.galleryGlyph}><MediaIcon kind="image" /></span>{t('media.noGenerations')}</div>
      </Panel>
    </div>
    {active && settingsOpen && <MediaSettings t={t} onDismiss={() => setSettingsOpen(false)} trigger={settingsTrigger} />}
  </div>
}
