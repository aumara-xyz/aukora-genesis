/**
 * WHERE THE HEALTH HISTORY COMES FROM — the ring, and the threshold the watchdog owns.
 *
 * The host samples every thirty seconds into a ring that cannot grow; this reads that ring. **THE THRESHOLD TRAVELS
 * WITH IT AS ALPHA'S NUMBER OR AS NULL**, and null means "not read", which the view renders as an unknown proximity
 * rather than as a comfortable one — the same rule as every other fact on this panel.
 *
 * @module health-api
 */

import type { HealthSample } from './health-model.ts'

/** The route the host serves. The client declares the same string; a court requires them to agree. */
export const HEALTH_ROUTE = '/api/aukora/health'

/** The status route, read from here rather than by the host: a server-side fetch has no origin for the fence to check. */
export const HEALTH_STATUS_ROUTE = '/api/auma-live/status'

/** What a read produced. `limitBytes` is null when the watchdog's threshold could not be read. */
export interface HealthRead {
  readonly samples: readonly HealthSample[]
  readonly limitBytes: number | null
  readonly intervalMs: number | null
}

/** Why the history could not be read, in the three ways this codebase distinguishes. */
export type HealthProblem = 'absent' | 'refused' | 'failed'

/** A failure that names itself and carries nothing but a status. */
export class HealthError extends Error {
  readonly problem: HealthProblem
  readonly status: number

  constructor(problem: HealthProblem, status: number) {
    super(`health: ${problem} (${String(status)})`)
    this.name = 'HealthError'
    this.problem = problem
    this.status = status
  }
}

/** The live source: the ring from the host, and the lanes from the status route the shell already reads. */
export interface HealthSource {
  readonly read: () => Promise<HealthRead>
  readonly lanes: () => Promise<{ readonly running: number | null; readonly waiting: number | null }>
}

export function httpHealth(): HealthSource {
  return {
    read: async () => {
      let response: Response
      try {
        response = await fetch(HEALTH_ROUTE)
      } catch {
        throw new HealthError('absent', 0)
      }
      if (!response.ok) throw new HealthError(response.status === 404 ? 'absent' : 'refused', response.status)
      const body: unknown = await response.json()
      const shaped = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {}
      return {
        samples: Array.isArray(shaped.samples) ? (shaped.samples as HealthSample[]) : [],
        // **A THRESHOLD THAT WAS NOT READ IS NULL, NOT A DEFAULT.** A default here would be a threshold nobody chose.
        limitBytes: typeof shaped.limitBytes === 'number' && Number.isFinite(shaped.limitBytes) ? shaped.limitBytes : null,
        intervalMs: typeof shaped.intervalMs === 'number' && Number.isFinite(shaped.intervalMs) ? shaped.intervalMs : null,
      }
    },
    lanes: async () => {
      try {
        const response = await fetch(HEALTH_STATUS_ROUTE)
        if (!response.ok) return { running: null, waiting: null }
        const body: unknown = await response.json()
        const shaped = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {}
        const running = typeof shaped.lanes === 'number' ? shaped.lanes : null
        const waiting = typeof shaped.waitingLanes === 'number' ? shaped.waitingLanes : null
        return { running, waiting }
      } catch {
        // **THE LANES ARE ASKED FOR FROM HERE BECAUSE THE FENCE NEEDS A REAL ORIGIN**, and a server-side fetch has none.
        // An unanswered question is null, which the panel renders as unknown rather than as "no lanes are waiting".
        return { running: null, waiting: null }
      }
    },
  }
}
