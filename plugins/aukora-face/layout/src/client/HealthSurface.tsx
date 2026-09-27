/**
 * THE HEALTH PANEL — one calm column, six facts, and every number saying where it came from.
 *
 * Peter found out about 45 GB of leaked test copies and a backend heap leak only when things broke. This is the screen
 * that would have told him first. **WHAT IT DELIBERATELY DOES NOT DO**: it does not draw a comfortable zero where a
 * number is missing. An unread fact says it is unread, and why; a rate needs enough history to be a rate; and the
 * restart threshold is the watchdog's number or nothing at all.
 *
 * The decisions live in `health-model.ts`, where a court drives them; this file renders them.
 */

import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { formatBytes, formatRate, healthOf } from './health-model.ts'
import type { HealthSample, HealthView } from './health-model.ts'
import { HealthError, httpHealth } from './health-api.ts'
import type { HealthSource } from './health-api.ts'
import css from './Health.module.css'

/** Full props for the Health panel. */
export type HealthSurfaceProps =
  PropsLocale<'layout'>
  & {
    /** Where the ring comes from. A court passes its own; the app passes the routes. */
    readonly source?: HealthSource
    /** Whether a person is being asked to approve right now — the watchdog never restarts then, and neither do we. */
    readonly approvalOpen?: boolean
  }

/** One fact: its name, its value in plain words, where it came from, and its trend when there is one. */
function Fact({ name, value, from, trend, unknown }: {
  readonly name: string
  readonly value: string
  readonly from: string
  readonly trend?: string | null
  readonly unknown?: string | null
}): JSX.Element {
  return (
    <li className={css.healthFact} data-health-fact={name} data-health-known={unknown === null || unknown === undefined ? 'yes' : 'no'}>
      <div className={css.healthFactHead}>
        <span className={css.healthFactName}>{name}</span>
        <span className={css.healthFactValue}>{unknown === null || unknown === undefined ? value : unknown}</span>
      </div>
      {unknown === null || unknown === undefined ? null : <span className={css.healthFactFrom}>{value}</span>}
      {trend === null || trend === undefined ? null : <span className={css.healthFactTrend}>{trend}</span>}
      {/* **EVERY NUMBER SAYS WHERE IT CAME FROM** — the goal asks it of each one, so it is rendered under each one. */}
      <span className={css.healthFactFrom} data-health-from={name}>{from}</span>
    </li>
  )
}

/** The panel. */
export function HealthSurface({ t, source: given, approvalOpen }: HealthSurfaceProps): JSX.Element {
  const source = given ?? httpHealth()
  const [samples, setSamples] = useState<readonly HealthSample[]>([])
  const [limitBytes, setLimitBytes] = useState<number | null>(null)
  const [lanes, setLanes] = useState<{ readonly running: number | null; readonly waiting: number | null }>({ running: null, waiting: null })
  const [trouble, setTrouble] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void source.read()
      .then(read => {
        if (cancelled) return
        setSamples(read.samples)
        setLimitBytes(read.limitBytes)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setTrouble(cause instanceof HealthError ? cause.problem : 'failed')
      })
    // **THE LANES COME FROM THE STATUS ROUTE, READ FROM HERE** — a server-side fetch has no origin for the fence to
    // check, so the host half cannot ask, and asking anyway would have taught me to forge a header.
    void source.lanes().then(answer => { if (!cancelled) setLanes(answer) }).catch(() => { /* unknown, as above */ })
    return () => { cancelled = true }
  }, [source])

  // The newest sample carries the lanes, so a lane reading that arrived after the ring did still reaches the view.
  const merged = samples.length === 0
    ? samples
    : samples.map((sample, index) => index === samples.length - 1
      ? { ...sample, lanesRunning: lanes.running, lanesWaiting: lanes.waiting }
      : sample)
  const view: HealthView | null = merged.length === 0 ? null : healthOf(merged, limitBytes ?? Number.POSITIVE_INFINITY, approvalOpen === true)
  const rate = (perMinute: number | null): string | null => formatRate(perMinute, t as never)

  return (
    <section className={css.health} data-health-surface>
      <h1 className={css.healthTitle}>{t('health.title')}</h1>
      <p className={css.healthLead}>{t('health.lead')}</p>
      {trouble === null
        ? null
        : <p className={css.healthTrouble} data-health-trouble={trouble}>{t(trouble === 'absent' ? 'health.trouble.absent' : 'health.trouble.failed')}</p>}
      {/* **A FAILURE IS NOT AN EMPTY PANEL.** "No reading has been taken yet" is true of a machine nobody has sampled
          and FALSE of one whose service refused — and the trouble line above already says which. Rendering both at once
          is the exact defect this sweep exists for: the reader knows the difference and the layer above dropped it. */}
      {view === null && trouble === null ? <p className={css.healthLead} data-health-empty>{t('health.empty')}</p> : null}
      {view === null ? null : (
        <ul className={css.healthFacts}>
          <Fact
            name={t('health.disk')}
            value={view.disk.known ? `${formatBytes(view.disk.value.freeBytes) ?? ''} ${t('health.disk.free')}` : ''}
            from={view.disk.known ? view.disk.from : view.disk.why}
            unknown={view.disk.known ? null : t('health.unknown')}
          />
          <Fact
            name={t('health.scratch')}
            value={view.scratch.known ? formatBytes(view.scratch.value.bytes) ?? '' : ''}
            from={view.scratch.known ? view.scratch.from : view.scratch.why}
            trend={rate(view.scratchTrend.perMinute) ?? (view.scratch.known ? t('health.trend.none') : null)}
            unknown={view.scratch.known ? null : t('health.unknown')}
          />
          <Fact
            name={t('health.footprint')}
            value={view.footprint.known ? formatBytes(view.footprint.value.bytes) ?? '' : ''}
            from={view.footprint.known ? view.footprint.from : view.footprint.why}
            trend={rate(view.footprintTrend.perMinute) ?? (view.footprint.known ? t('health.trend.none') : null)}
            unknown={view.footprint.known ? null : t('health.unknown')}
          />
          <Fact
            name={t('health.pressure')}
            value={view.pressure.known ? String(view.pressure.value.level) : ''}
            from={view.pressure.known ? view.pressure.from : view.pressure.why}
            unknown={view.pressure.known ? null : t('health.unknown')}
          />
          <Fact
            name={t('health.lanes')}
            value={view.lanes.known ? t('health.lanes.value').replace('{running}', String(view.lanes.value.running)).replace('{waiting}', String(view.lanes.value.waiting)) : ''}
            from={view.lanes.known ? view.lanes.from : view.lanes.why}
            unknown={view.lanes.known ? null : t('health.unknown')}
          />
          <Fact
            name={t('health.ci')}
            value={view.ci.known ? view.ci.value.result : ''}
            from={view.ci.known ? view.ci.from : view.ci.why}
            unknown={view.ci.known ? null : t('health.unknown')}
          />
        </ul>
      )}
      {/* **THE DISK WARNING IS THE GOAL'S OWN NUMBER.** Under twenty gigabytes, said in a sentence. */}
      {view !== null && view.disk.known && view.disk.value.warn
        ? <p className={css.healthWarn} data-health-warn="disk">{t('health.warn.disk')}</p>
        : null}
      {view !== null && view.restartRecommended
        ? <p className={css.healthWarn} data-health-warn="restart">{t('health.warn.restart')}</p>
        : null}
      {/* AND WHEN A RESTART IS NEARING BUT NOT YET DUE, THE PANEL SAYS SO WITHOUT RECOMMENDING IT — the decision is
          the watchdog's, and this only reports how close the number is. */}
      {view !== null && !view.restartRecommended && view.footprint.known && view.footprint.value.proximity === 'near'
        ? <p className={css.healthWarn} data-health-warn="near">{t('health.warn.near')}</p>
        : null}
    </section>
  )
}
