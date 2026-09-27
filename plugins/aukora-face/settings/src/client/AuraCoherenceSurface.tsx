// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/** Live Aura Coherence system surface. */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  advanceAuraActivity,
  auraActivityHeadsOf,
  type AuraActivityBaseline,
} from '../aura/activity.ts'
import {
  aggregateAuraCoherence,
  type AuraSystemProjection,
} from '../aura/aggregate.ts'
import { deformTesseract } from '../aura/deformation.ts'
import { AURA_TRITS, auraCellIndex, auraTernaryOf } from '../aura/ternary.ts'
import {
  AURA_COEFFICIENT_PROVENANCE,
  REST,
  persistentChannelsOf,
  type Triad,
} from '../aura/figure.ts'
import {
  approachAuraTriad,
  auraBreathAtRest,
  auraPresentationAt,
  exciteAuraBreath,
  sameAuraTriad,
  stepAuraBreath,
  type AuraBreathMotion,
} from '../aura/motion.ts'
import { synth6 } from '../aura/walsh.ts'
import {
  figureFrame,
  frameDigest,
  TESSERACT_EDGES,
  TESSERACT_FACES,
  type Point3,
} from '../aura/rotor.ts'
import { isEditableTarget } from './escape.ts'
import css from './AuraCoherenceSurface.module.css'

/** Props assembled for the always-mounted Aura Coherence center surface. */
export type AuraCoherenceSurfaceComponentProps =
  PropsRuntime<'shell.surface'>
  & PropsLocale<'settings'>

interface MotionState {
  /** Current persistent xy/xz/yz deformation, eased only after logged state changes. */
  standing: Triad
  /** Aura's transient xw/yw/zw state. */
  breath: Triad
}

type ScreenPoint = readonly [number, number, number]

interface ScreenFace {
  /** Average display depth used only for painter ordering and light. */
  depth: number
  /** Stable face position in the canonical tesseract face list. */
  faceIndex: number
  /** Fixed Aura plane order `xy, xz, yz, xw, yw, zw`. */
  planeIndex: number
  /** SVG polygon points after Aura and display-camera projection. */
  points: string
}

interface FigureProps {
  /** Whether this resident surface may advance presentation time. */
  active: boolean
  /** Ordered data coefficients rendered by the Walsh deformation. */
  angles: readonly [number, number, number, number, number, number]
  /** Current Walsh field used only to color vertex polarity. */
  field: readonly number[]
  /** Active locale translator. */
  t: AuraCoherenceSurfaceComponentProps['t']
  /** Stable per-component SVG definition prefix. */
  svgPrefix: string
  /** Whether continuous rotation and display breathing are disabled. */
  reducedMotion: boolean
}

const COEFFICIENT_FRAME_INTERVAL_MS = 1000 / 30
const PRESENTATION_FRAME_INTERVAL_MS = 1000 / 45
const PRESENTATION_PROJECTION_DISTANCE = 4.2
const ZERO_COEFFICIENTS = Object.freeze([0, 0, 0, 0, 0, 0] as const)
const FACE_TONES = [
  { from: 'var(--aura-green)', to: 'var(--aura-green-bright)', tone: 'history' },
  { from: 'var(--aura-blue)', to: 'var(--aura-blue-bright)', tone: 'tool-health' },
  { from: 'var(--aura-gold)', to: 'var(--aura-gold-bright)', tone: 'approval' },
  { from: 'var(--aura-purple)', to: 'var(--aura-purple-bright)', tone: 'human' },
  { from: 'var(--aura-blue)', to: 'var(--aura-purple)', tone: 'assistant' },
  { from: 'var(--aura-green)', to: 'var(--aura-blue)', tone: 'tool-activity' },
] as const
const CHANNEL_TEXT = {
  historyPhase: {
    label: 'aura.channel.historyPhase.label',
    source: 'aura.channel.historyPhase.source',
  },
  toolHealth: {
    label: 'aura.channel.toolHealth.label',
    source: 'aura.channel.toolHealth.source',
  },
  approvalPosture: {
    label: 'aura.channel.approvalPosture.label',
    source: 'aura.channel.approvalPosture.source',
  },
  humanActivity: {
    label: 'aura.channel.humanActivity.label',
    source: 'aura.channel.humanActivity.source',
  },
  assistantActivity: {
    label: 'aura.channel.assistantActivity.label',
    source: 'aura.channel.assistantActivity.source',
  },
  toolActivity: {
    label: 'aura.channel.toolActivity.label',
    source: 'aura.channel.toolActivity.source',
  },
} as const

/**
 * Map the available durable system adapter into Aura's standing triad.
 *
 * @param projection - commutative aggregate of Host-folded session projections.
 * @returns persistent history-phase, tool-health, and approval-posture coefficients.
 */
export function systemStandingOf(projection: AuraSystemProjection): Triad {
  return persistentChannelsOf(projection.channelSources.persistent)
}

export { approachAuraTriad }

/**
 * Project an Aura frame through the final display camera and shared presence scale.
 * @param frame - projected 4D figure points.
 * @param scale - presentation-only scale applied around the SVG center.
 * @returns screen points and depth values.
 */
function cameraFrame(frame: readonly Point3[], scale = 1): ScreenPoint[] {
  const yaw = -0.48
  const pitch = 0.34
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  return frame.map(([x, y, z]) => {
    const yawX = x * cy - z * sy
    const yawZ = x * sy + z * cy
    const pitchY = y * cp - yawZ * sp
    const pitchZ = y * sp + yawZ * cp
    const perspective = 1 / Math.max(0.72, 1.18 - pitchZ * 0.055)
    return [
      220 + yawX * 66 * perspective * scale,
      220 + pitchY * 66 * perspective * scale,
      pitchZ,
    ]
  })
}

/** Read one canonical tesseract point and fail if the renderer tables diverge. */
function screenPointAt(frame: readonly ScreenPoint[], vertex: number): ScreenPoint {
  const point = frame[vertex]
  if (point === undefined) throw new RangeError(`Aura vertex ${vertex} is absent from the display frame`)
  return point
}

/** Compact numeric rendering for disclosed Aura coefficients. */
function coefficient(value: number): string {
  return value.toFixed(4)
}

/** Human-readable local time for a recent content-free record. */
function recordTime(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Resolve the reduced-motion media query when the host implements it. */
function reducedMotionMedia(): MediaQueryList | undefined {
  if (typeof window === 'undefined') return undefined
  const matchMedia = (window as unknown as {
    matchMedia?: (query: string) => MediaQueryList
  }).matchMedia
  return matchMedia?.call(window, '(prefers-reduced-motion: reduce)')
}

/** Track the operating-system motion preference for both coefficient and view animation. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => reducedMotionMedia()?.matches ?? false)

  useEffect(() => {
    const media = reducedMotionMedia()
    if (media === undefined) return
    const update = () => { setReduced(media.matches) }
    update()
    media.addEventListener('change', update)
    return () => { media.removeEventListener('change', update) }
  }, [])

  return reduced
}

/** Track whether the document may present continuous coefficient motion. */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')

  useEffect(() => {
    const update = () => { setVisible(document.visibilityState !== 'hidden') }
    document.addEventListener('visibilitychange', update)
    return () => { document.removeEventListener('visibilitychange', update) }
  }, [])

  return visible
}

/** Advance only active, visible presentation time and stop cleanly on stagnant test clocks. */
function usePresentationTime(active: boolean, reducedMotion: boolean): number {
  const [elapsed, setElapsed] = useState(0)
  const elapsedRef = useRef(0)

  useEffect(() => {
    if (!active || reducedMotion || typeof window.requestAnimationFrame !== 'function') return

    let frame = 0
    let previousTimestamp: number | null = null
    let publishedAt = 0
    const resetTimestamp = () => { previousTimestamp = null }
    const draw = (timestamp: number) => {
      if (previousTimestamp === null) {
        previousTimestamp = timestamp
        publishedAt = timestamp
        frame = window.requestAnimationFrame(draw)
        return
      }
      // A duplicate or backward frame timestamp is possible in real browsers;
      // keep the loop alive and wait for the next advancing frame instead of
      // silently killing rotation for the rest of the activation.
      if (timestamp <= previousTimestamp) {
        frame = window.requestAnimationFrame(draw)
        return
      }

      const delta = Math.min(100, timestamp - previousTimestamp)
      previousTimestamp = timestamp
      if (document.visibilityState !== 'hidden') elapsedRef.current += delta
      if (timestamp - publishedAt >= PRESENTATION_FRAME_INTERVAL_MS) {
        publishedAt = timestamp
        setElapsed(elapsedRef.current)
      }
      frame = window.requestAnimationFrame(draw)
    }

    document.addEventListener('visibilitychange', resetTimestamp)
    frame = window.requestAnimationFrame(draw)
    return () => {
      document.removeEventListener('visibilitychange', resetTimestamp)
      window.cancelAnimationFrame(frame)
    }
  }, [active, reducedMotion])

  return reducedMotion ? 0 : elapsed
}

/** Animated viewing layer shared by the current geometry and its zero-state reference. */
function AuraFigure({ active, angles, field, reducedMotion, svgPrefix, t }: FigureProps) {
  const elapsed = usePresentationTime(active, reducedMotion)
  const presentation = useMemo(
    () => auraPresentationAt(elapsed, [angles[3], angles[4], angles[5]], reducedMotion),
    [angles, elapsed, reducedMotion],
  )
  const displayFrame = useMemo(() => cameraFrame(figureFrame({
    vertices: deformTesseract(angles),
    orientation: presentation.orientation,
    distance: PRESENTATION_PROJECTION_DISTANCE,
  }), presentation.scale), [angles, presentation.orientation, presentation.scale])
  const referenceFrame = useMemo(() => cameraFrame(figureFrame({
    vertices: deformTesseract(ZERO_COEFFICIENTS),
    orientation: presentation.orientation,
    distance: PRESENTATION_PROJECTION_DISTANCE,
  }), presentation.scale), [presentation.orientation, presentation.scale])
  const displayFaces = useMemo<ScreenFace[]>(() => TESSERACT_FACES.map((face, faceIndex) => {
    const points = face.vertices.map(vertex => screenPointAt(displayFrame, vertex))
    return {
      depth: points.reduce((sum, point) => sum + point[2], 0) / points.length,
      faceIndex,
      planeIndex: face.planeIndex,
      points: points.map(point => `${point[0]},${point[1]}`).join(' '),
    }
  }).sort((left, right) => left.depth - right.depth || left.faceIndex - right.faceIndex), [displayFrame])
  const visualStyle = {
    '--aura-activity': presentation.activity.toFixed(4),
    '--aura-presence-scale': presentation.scale.toFixed(5),
  } as CSSProperties

  return (
    <div
      className={css.figureStage}
      data-aura-breathing={presentation.activity > 0.01 ? 'true' : 'false'}
      data-aura-presentation-scale={presentation.scale.toFixed(5)}
      style={visualStyle}
    >
      <div className={css.presenceHalo} aria-hidden="true" />
      <svg
        className={css.tesseract}
        viewBox="0 0 440 440"
        role="img"
        aria-labelledby={`${svgPrefix}-title ${svgPrefix}-description`}
        focusable="false"
      >
        <title id={`${svgPrefix}-title`}>{t('aura.figure.title')}</title>
        <desc id={`${svgPrefix}-description`}>{t('aura.figure.description')}</desc>
        <defs>
          <linearGradient id={`${svgPrefix}-edge`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--aura-green)" />
            <stop offset="0.34" stopColor="var(--aura-blue-bright)" />
            <stop offset="0.68" stopColor="var(--aura-purple-bright)" />
            <stop offset="1" stopColor="var(--aura-gold-bright)" />
          </linearGradient>
          {FACE_TONES.map(({ from, to }, planeIndex) => (
            <linearGradient
              key={planeIndex}
              id={`${svgPrefix}-face-${planeIndex}`}
              x1="0"
              y1="0"
              x2="1"
              y2="1"
              data-aura-plane-gradient={planeIndex}
            >
              <stop offset="0" stopColor={from} stopOpacity="0.98" />
              <stop offset="0.52" stopColor={to} stopOpacity="0.9" />
              <stop offset="1" stopColor={from} stopOpacity="0.78" />
            </linearGradient>
          ))}
          <filter id={`${svgPrefix}-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <g className={css.referenceLayer} aria-hidden="true">
          {TESSERACT_EDGES.map(([from, to], index) => {
            const a = referenceFrame[from]
            const b = referenceFrame[to]
            if (a === undefined || b === undefined) return null
            return <line
              key={`${from}-${to}`}
              x1={a[0]}
              y1={a[1]}
              x2={b[0]}
              y2={b[1]}
              data-aura-reference-edge={index}
            />
          })}
        </g>
        <g className={css.currentLayer}>
          {displayFaces.map((face) => {
            const amplitude = Math.abs(angles[face.planeIndex] ?? 0)
            const depthLight = Math.max(0, Math.min(1, (face.depth + 2.4) / 4.8))
            const tone = FACE_TONES[face.planeIndex]?.tone ?? 'unknown'
            const faceOpacity = Math.min(0.42, 0.12 + amplitude * 0.16 + depthLight * 0.14)
            return <polygon
              key={face.faceIndex}
              points={face.points}
              fill={`url(#${svgPrefix}-face-${face.planeIndex})`}
              fillOpacity={faceOpacity}
              strokeOpacity={Math.min(0.72, 0.34 + amplitude * 0.2 + depthLight * 0.18)}
              data-aura-face={face.faceIndex}
              data-plane={face.planeIndex}
              data-plane-tone={tone}
              data-polarity={(angles[face.planeIndex] ?? 0) < 0 ? 'negative' : 'positive'}
            />
          })}
          {TESSERACT_EDGES.map(([from, to], index) => {
            const a = displayFrame[from]
            const b = displayFrame[to]
            if (a === undefined || b === undefined) return null
            const depth = (a[2] + b[2]) / 2
            return <line
              key={`${from}-${to}`}
              x1={a[0]}
              y1={a[1]}
              x2={b[0]}
              y2={b[1]}
              opacity={Math.max(0.52, Math.min(0.94, 0.72 + depth * 0.08))}
              stroke={`url(#${svgPrefix}-edge)`}
              strokeWidth={Math.max(1.2, Math.min(2, 1.5 + depth * 0.13))}
              data-aura-edge={index}
            />
          })}
          {displayFrame.map(([x, y, z], index) => (
            <circle
              key={index}
              cx={x}
              cy={y}
              r={Math.max(2.8, Math.min(5.2, 3.8 + z * 0.2))}
              opacity={Math.max(0.68, Math.min(1, 0.84 + z * 0.06))}
              filter={`url(#${svgPrefix}-glow)`}
              data-aura-vertex={index}
              data-polarity={(field[index] ?? 0) < 0 ? 'negative' : 'positive'}
            />
          ))}
        </g>
      </svg>
      <div className={css.figureKey} aria-label={t('aura.figure.key.label')}>
        <span data-layer="current">{t('aura.figure.key.current')}</span>
        <span data-layer="reference">{t('aura.figure.key.reference')}</span>
      </div>
    </div>
  )
}

/** One portal-style disclosure row. */
function Portal({
  title,
  summary,
  children,
}: {
  title: string
  summary: string
  children: ReactNode
}) {
  return (
    <details className={css.portal}>
      <summary>
        <span>{title}</span>
        <strong>{summary}</strong>
      </summary>
      <div className={css.portalBody}>{children}</div>
    </details>
  )
}

/**
 * Render Aura's life-state projection and its underlying record portals.
 * @param props - shell visibility, close action, and global session feed.
 * @returns the always-mounted Aura Coherence surface.
 */
export function AuraCoherenceSurface(props: AuraCoherenceSurfaceComponentProps) {
  const { activeSurface, closeSurface, t, useSessions, useSessionPendingInteraction } = props
  const active = activeSurface === 'aura-coherence'
  const sessions = useSessions(state => state)
  const currentSessionId = sessions.current
  const currentSession = currentSessionId === undefined ? undefined : sessions.byId[currentSessionId]
  const currentTitle = currentSession?.displayTitle
  const currentProjection = currentSession?.projectionValues?.auraCoherence
  const entries = useMemo(() => sessions.ids.map((id) => {
    const session = sessions.byId[id]
    const sessionProjection = session?.projectionValues?.auraCoherence
    return {
      id,
      title: session?.displayTitle ?? id,
      ...(sessionProjection === undefined ? {} : { projection: sessionProjection }),
    }
  }), [sessions.byId, sessions.ids])
  // The full aggregate scans every session's records, and this resident
  // surface re-renders on each store tick. While hidden, serve the last
  // computed projection instead of re-scanning; activation recomputes it
  // fresh. Activity heads stay live at every tick — the baseline advance
  // below needs them so a hidden stretch never replays as live activity.
  const lastProjectionRef = useRef<AuraSystemProjection | null>(null)
  const projection = useMemo(() => {
    if (!active && lastProjectionRef.current !== null) return lastProjectionRef.current
    const next = aggregateAuraCoherence(entries)
    lastProjectionRef.current = next
    return next
  }, [active, entries])
  const activityHeads = useMemo(() => auraActivityHeadsOf(entries), [entries])
  const pendingInteractions = useSessionPendingInteraction(state => state)
  const pending = sessions.ids.some(id => pendingInteractions.get(id) !== undefined)
  const svgPrefix = useId().replace(/:/g, '')
  const standing = useMemo(() => systemStandingOf(projection), [projection])
  const ternary = useMemo(() => auraTernaryOf(projection.channelSources.persistent), [projection])
  const reducedMotion = useReducedMotion()
  const documentVisible = useDocumentVisible()
  const [motion, setMotion] = useState<MotionState>(() => ({
    standing: [...standing],
    breath: [...REST],
  }))
  const motionRef = useRef(motion)
  const breathMotionRef = useRef<AuraBreathMotion>({ drive: [...REST], value: [...REST] })
  const activityBaselinesRef = useRef<ReadonlyMap<string, AuraActivityBaseline>>(new Map())
  const coefficientTimeRef = useRef<number | null>(null)

  useEffect(() => {
    const activityAdvance = advanceAuraActivity(activityBaselinesRef.current, activityHeads)
    activityBaselinesRef.current = activityAdvance.baselines
    const targetStanding: Triad = [...standing]
    const publish = (next: MotionState) => {
      motionRef.current = next
      setMotion(next)
    }

    let breathMotion: AuraBreathMotion = {
      drive: [...breathMotionRef.current.drive],
      value: [...motionRef.current.breath],
    }
    let current: MotionState = {
      standing: [...motionRef.current.standing],
      breath: [...breathMotion.value],
    }
    const advanceSteps = (steps: number) => {
      for (let step = 0; step < steps; step += 1) {
        breathMotion = stepAuraBreath(breathMotion)
        current = {
          standing: approachAuraTriad(current.standing, targetStanding),
          breath: [...breathMotion.value],
        }
        if (sameAuraTriad(current.standing, targetStanding) && auraBreathAtRest(breathMotion)) break
      }
    }
    const now = performance.now()
    const previousTime = coefficientTimeRef.current ?? now
    const elapsedBeforeEffect = Math.max(0, now - previousTime)
    const catchupSteps = Math.min(
      500,
      Math.floor(elapsedBeforeEffect / COEFFICIENT_FRAME_INTERVAL_MS),
    )
    advanceSteps(catchupSteps)
    coefficientTimeRef.current = catchupSteps === 500
      ? now
      : previousTime + catchupSteps * COEFFICIENT_FRAME_INTERVAL_MS
    breathMotion = exciteAuraBreath(breathMotion, activityAdvance.impulse)
    breathMotionRef.current = breathMotion
    current = { ...current, breath: [...breathMotion.value] }

    const canAnimate = active && documentVisible && !reducedMotion
    if (!canAnimate) {
      current = { ...current, standing: targetStanding }
      if (!sameAuraTriad(motionRef.current.standing, current.standing)
        || !sameAuraTriad(motionRef.current.breath, current.breath)) publish(current)
      return
    }
    // Catch-up can reach the target on its own, before a single frame is
    // scheduled. Its result still has to be published, or the surface keeps
    // rendering the pre-catch-up figure and its reshaping status with no
    // frame left to correct either.
    if (sameAuraTriad(current.standing, targetStanding) && auraBreathAtRest(breathMotion)) {
      if (!sameAuraTriad(motionRef.current.standing, current.standing)
        || !sameAuraTriad(motionRef.current.breath, current.breath)) publish(current)
      return
    }

    let animationFrame: number | null = null
    let timeout: number | null = null
    const hasAnimationFrame = typeof window.requestAnimationFrame === 'function'
    function schedule() {
      if (hasAnimationFrame) animationFrame = window.requestAnimationFrame(draw)
      else timeout = window.setTimeout(() => { draw(performance.now()) }, COEFFICIENT_FRAME_INTERVAL_MS)
    }
    function draw(timestamp: number) {
      const lastTime = coefficientTimeRef.current ?? timestamp
      // A non-advancing frame timestamp must not strand the ease mid-flight
      // with the status stuck on reshaping; reschedule and wait for time.
      if (timestamp <= lastTime) {
        schedule()
        return
      }
      const steps = Math.min(
        500,
        Math.floor((timestamp - lastTime) / COEFFICIENT_FRAME_INTERVAL_MS),
      )
      if (steps > 0) {
        advanceSteps(steps)
        coefficientTimeRef.current = steps === 500
          ? timestamp
          : lastTime + steps * COEFFICIENT_FRAME_INTERVAL_MS
        breathMotionRef.current = breathMotion
        publish(current)
        if (sameAuraTriad(current.standing, targetStanding) && auraBreathAtRest(breathMotion)) return
      }
      schedule()
    }
    schedule()
    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
      if (timeout !== null) window.clearTimeout(timeout)
    }
  }, [
    active,
    activityHeads,
    documentVisible,
    reducedMotion,
    standing[0],
    standing[1],
    standing[2],
  ])

  const close = useCallback(() => { closeSurface() }, [closeSurface])
  useEffect(() => {
    if (!active) return
    // Bubble-phase, deferring to consumed events: Modal/Menu take Escape in
    // capture and mark it defaultPrevented, and Escape inside a text-entry
    // control belongs to that control, so only an unclaimed press closes the
    // surface.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [active, close])

  const angles = useMemo(
    () => [...motion.standing, ...motion.breath] as const,
    [motion.breath, motion.standing],
  )
  const auraFrame = useMemo(
    () => figureFrame({ vertices: deformTesseract(angles) }),
    [angles],
  )
  const digest = useMemo(() => frameDigest(auraFrame), [auraFrame])
  const field = useMemo(() => synth6(angles), [angles])
  const approvals = projection.approvals
  const counts = projection.counts
  const refusalTotal = approvals.rejected + approvals.unavailable
  const changing = !sameAuraTriad(motion.standing, standing)
    || !sameAuraTriad(motion.breath, [...REST])

  return (
    <section className={css.surface} hidden={!active} data-aura-coherence-surface>
      <div className={css.section} aria-labelledby="aura-coherence-title">
        <header className={css.heading}>
          <div className={css.titleBlock}>
            <h2 id="aura-coherence-title">{t('aura.trigger')}</h2>
            <p>{t('aura.subtitle')}</p>
          </div>
          <div
            className={css.liveState}
            data-state={projection.projectedSessions === 0
              ? 'absent'
              : pending
                ? 'waiting'
                : changing
                  ? 'moving'
                  : 'rest'}
          >
            <span />
            {projection.projectedSessions === 0
              ? t('aura.status.noRecord')
              : pending
                ? t('aura.status.awaiting')
                : changing
                  ? t('aura.status.moving')
                  : t('aura.status.rest')}
          </div>
        </header>

        <AuraFigure
          active={active}
          angles={angles}
          field={field}
          reducedMotion={reducedMotion}
          svgPrefix={svgPrefix}
          t={t}
        />

        <section className={css.channels} aria-labelledby={`${svgPrefix}-channels`}>
          <header>
            <h3 id={`${svgPrefix}-channels`}>{t('aura.channels.title')}</h3>
            <p>{t('aura.channels.note')}</p>
          </header>
          <div className={css.channelGrid}>
            {AURA_COEFFICIENT_PROVENANCE.map((channel, index) => {
              const value = angles[index] ?? 0
              const formattedValue = `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
              const text = CHANNEL_TEXT[channel.channel]
              const lifetime = t(channel.lifetime === 'persistent'
                ? 'aura.channel.lifetime.persistent'
                : 'aura.channel.lifetime.transient')
              const meterText = t('aura.channel.value', {
                label: t(text.label),
                lifetime,
                value: formattedValue,
              })
              return <div
                key={channel.plane}
                className={css.channel}
                data-aura-channel={channel.channel}
                data-lifetime={channel.lifetime}
              >
                <div className={css.channelHeading}>
                  <span className={css.plane}>{channel.plane}</span>
                  <strong>{t(text.label)}</strong>
                  <output>{formattedValue}</output>
                </div>
                {channel.signed
                  // A signed channel spans [-1, 1]: a center-origin meter keeps
                  // -1 and +1 visually distinct instead of collapsing them into
                  // the same magnitude bar.
                  ? <div
                    className={css.bipolarMeter}
                    role="meter"
                    aria-valuemin={-1}
                    aria-valuemax={1}
                    aria-valuenow={value}
                    aria-label={t(text.label)}
                    aria-valuetext={meterText}
                  >
                    <span
                      className={css.bipolarFill}
                      data-direction={value < 0 ? 'negative' : 'positive'}
                      style={{ width: `${Math.abs(value) * 50}%` }}
                      aria-hidden="true"
                    />
                  </div>
                  : <progress
                    max="1"
                    value={Math.abs(value)}
                    aria-label={t(text.label)}
                    aria-valuetext={meterText}
                  />}
                <p>{t(text.source)}</p>
              </div>
            })}
          </div>
        </section>

        <section className={css.channels} aria-labelledby={`${svgPrefix}-ternary`} data-aura-ternary>
          <header>
            <h3 id={`${svgPrefix}-ternary`}>{t('aura.ternary.title')}</h3>
            <p>{t('aura.ternary.note')}</p>
          </header>
          <p data-aura-ternary-readout>{t('aura.ternary.readout', {
            coordinate: ternary.trits.map(value => value === null ? '?' : String(value)).join(', '),
            index: ternary.index === null ? t('aura.ternary.unknown') : String(ternary.index),
          })}</p>
          <p>{t('aura.ternary.values', { values: ternary.values.map(value => value.toFixed(4)).join(', ') })}</p>
          <div className={css.ternarySlices}>
            {AURA_TRITS.map(history => <div key={history}>
              <strong>{t('aura.ternary.slice', { value: history })}</strong>
              <ol className={css.ternaryGrid}>
                {AURA_TRITS.flatMap(tool => AURA_TRITS.map((approval) => {
                  const index = auraCellIndex([history, tool, approval])
                  return <li key={index} data-aura-cell={index} aria-current={ternary.index === index ? 'true' : undefined}>
                    <span>{index}</span><small>{history}, {tool}, {approval}</small>
                  </li>
                }))}
              </ol>
            </div>)}
          </div>
          <p>{t('aura.ternary.bins')}</p>
        </section>

        <div className={css.truthLine}>
          <div>
            <span>{t('aura.coverage.label')}</span>
            <strong>{t('aura.coverage.summary', {
              projected: projection.projectedSessions,
              sessions: projection.sessions,
            })}</strong>
          </div>
          <p>
            {projection.projectedSessions === 0
              ? t('aura.coverage.waiting')
              : approvals.asked === 0
                ? t('aura.coverage.none', { interactions: counts.interactions })
                : approvals.asked === 1
                  ? t('aura.coverage.one', { interactions: counts.interactions })
                  : t('aura.coverage.many', {
                    approvals: approvals.asked,
                    interactions: counts.interactions,
                  })}
          </p>
          <div>
            <span>{t('aura.provenance.label')}</span>
            <strong>{projection.lastTime === null
              ? t('aura.provenance.none')
              : t('aura.provenance.value', {
                fingerprint: projection.recordFingerprint,
                time: recordTime(projection.lastTime),
              })}</strong>
          </div>
        </div>

        <div className={css.portals} aria-label={t('aura.portals.label')}>
          <Portal
            title={t('aura.interaction.title')}
            summary={t('aura.interaction.summary', { records: counts.records })}
          >
            <dl className={css.values}>
              <div><dt>{t('aura.interaction.observed')}</dt><dd>{counts.interactions}</dd></div>
              <div><dt>{t('aura.interaction.fingerprint')}</dt><dd>{projection.recordFingerprint}</dd></div>
              <div><dt>{t('aura.interaction.adapter')}</dt><dd>{t('aura.interaction.adapterValue')}</dd></div>
            </dl>
            <ol className={css.recent}>
              {projection.recent.map(record => (
                <li key={`${record.sessionId}:${record.seq}`} data-kind={record.kind}>
                  <span>{record.sessionTitle} · {record.label}</span>
                  <time dateTime={new Date(record.time).toISOString()}>{recordTime(record.time)}</time>
                </li>
              ))}
            </ol>
          </Portal>

          <Portal
            title={t('aura.message.title')}
            summary={t('aura.message.summary', {
              assistant: counts.assistantMessages,
              human: counts.humanMessages,
            })}
          >
            <dl className={css.values}>
              <div><dt>{t('aura.message.human')}</dt><dd>{counts.humanMessages}</dd></div>
              <div><dt>{t('aura.message.assistant')}</dt><dd>{counts.assistantMessages}</dd></div>
              <div><dt>{t('aura.message.context')}</dt><dd>{counts.contextMessages}</dd></div>
              <div><dt>{t('aura.message.turns')}</dt><dd>{counts.turns}</dd></div>
            </dl>
            <p>{t('aura.message.note')}</p>
          </Portal>

          <Portal
            title={t('aura.action.title')}
            summary={t('aura.action.summary', {
              failed: counts.toolErrors,
              requested: counts.toolCalls,
            })}
          >
            <dl className={css.values}>
              <div><dt>{t('aura.action.requests')}</dt><dd>{counts.toolCalls}</dd></div>
              <div><dt>{t('aura.action.results')}</dt><dd>{counts.toolResults}</dd></div>
              <div><dt>{t('aura.action.failures')}</dt><dd>{counts.toolErrors}</dd></div>
              <div><dt>{t('aura.action.standing')}</dt><dd>{coefficient(motion.standing[1])}</dd></div>
            </dl>
            <p>{t('aura.action.note')}</p>
          </Portal>

          <Portal
            title={t('aura.approval.title')}
            summary={t('aura.approval.summary', {
              allowed: approvals.allowed,
              refused: refusalTotal,
            })}
          >
            <dl className={css.values}>
              <div><dt>{t('aura.approval.asked')}</dt><dd>{approvals.asked}</dd></div>
              <div><dt>{t('aura.approval.allowed')}</dt><dd>{approvals.allowed}</dd></div>
              <div><dt>{t('aura.approval.rejected')}</dt><dd>{approvals.rejected}</dd></div>
              <div><dt>{t('aura.approval.unavailable')}</dt><dd>{approvals.unavailable}</dd></div>
              <div><dt>{t('aura.approval.cancelled')}</dt><dd>{approvals.cancelled}</dd></div>
              <div><dt>{t('aura.approval.standing')}</dt><dd>{coefficient(motion.standing[2])}</dd></div>
            </dl>
          </Portal>

          <Portal
            title={t('aura.confinement.title')}
            summary={currentProjection?.confinement.preset ?? t('aura.confinement.default')}
          >
            <dl className={css.values}>
              <div><dt>{t('aura.confinement.thread')}</dt><dd>{currentTitle ?? t('aura.confinement.none')}</dd></div>
              <div><dt>{t('aura.confinement.permission')}</dt><dd>{currentProjection?.confinement.preset ?? t('aura.confinement.notOverridden')}</dd></div>
              <div><dt>{t('aura.confinement.sandbox')}</dt><dd>{currentProjection?.confinement.sandbox ?? t('aura.confinement.notOverridden')}</dd></div>
              <div><dt>{t('aura.confinement.approval')}</dt><dd>{currentProjection?.confinement.approval ?? t('aura.confinement.notOverridden')}</dd></div>
            </dl>
          </Portal>

          <Portal title={t('aura.field.title')} summary={t('aura.field.summary')}>
            <dl className={css.values}>
              <div><dt>{t('aura.field.standing')}</dt><dd>{motion.standing.map(coefficient).join(' · ')}</dd></div>
              <div><dt>{t('aura.field.breath')}</dt><dd>{motion.breath.map(coefficient).join(' · ')}</dd></div>
              <div><dt>{t('aura.field.digest')}</dt><dd>{digest}</dd></div>
              <div><dt>{t('aura.field.walsh')}</dt><dd>{field.map(value => value.toFixed(3)).join(' ')}</dd></div>
              <div><dt>{t('aura.field.identity')}</dt><dd className={css.unavailable}>{t('aura.field.notMounted')}</dd></div>
              <div><dt>{t('aura.field.receipts')}</dt><dd className={css.unavailable}>{t('aura.field.notMounted')}</dd></div>
              <div><dt>{t('aura.field.anchor')}</dt><dd className={css.unavailable}>{t('aura.field.notMounted')}</dd></div>
              <div><dt>{t('aura.field.order')}</dt><dd className={css.unavailable}>{t('aura.field.notClaimed')}</dd></div>
            </dl>
            <p>{t('aura.field.note')}</p>
          </Portal>
        </div>
      </div>
    </section>
  )
}
