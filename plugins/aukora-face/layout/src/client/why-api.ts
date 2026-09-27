/**
 * WHERE ONE REPLY'S ATTENTION RECEIPT COMES FROM.
 *
 * The manifest is a file on disk that only the host can read, so the view asks a route this face's host half serves.
 * **UNTIL AUMA'S MANIFEST LANDS** the route answers `absent`, and the view says so in words — there is no fixture in
 * the live path, because a fixture rendered as a receipt would be the one lie this view exists to prevent. The fixture
 * lives in the courts, where it belongs.
 *
 * @module why-api
 */

import { manifestFactOf } from './why-model.ts'
import type { ManifestFact, ReplyManifest } from './why-model.ts'

/** The route the host serves. The client declares the same string; a court requires them to agree. */
export const WHY_ROUTE = '/api/aukora/why'

/** What a read produced: the receipt, or the honest absence. */
export interface WhyRead {
  readonly manifest: ReplyManifest | null
  readonly absent: boolean
  readonly skipped: number
}

/** Why the receipt could not be read, in the three ways this codebase distinguishes. */
export type WhyProblem = 'absent' | 'refused' | 'failed'

/** A failure that names itself and carries nothing from the manifest. */
export class WhyError extends Error {
  readonly problem: WhyProblem
  readonly status: number

  constructor(problem: WhyProblem, status: number) {
    super(`why: ${problem} (${String(status)})`)
    this.name = 'WhyError'
    this.problem = problem
    this.status = status
  }
}

/** What the view reads from. A court passes its own; the app passes the route. */
export interface WhySource {
  readonly read: (replyId: string) => Promise<WhyRead>
}

/** The live source: the route, and nothing invented when it does not answer. */
export function httpWhy(): WhySource {
  return {
    read: async replyId => {
      let response: Response
      try {
        response = await fetch(`${WHY_ROUTE}?reply=${encodeURIComponent(replyId)}`)
      } catch {
        throw new WhyError('absent', 0)
      }
      if (!response.ok) throw new WhyError(response.status === 404 ? 'absent' : 'refused', response.status)
      const body: unknown = await response.json()
      const shaped = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {}
      // **THE ROUTE'S THREE FACTS ARE CARRIED, NOT DROPPED** — the lesson from the approvals view, where dropping
      // `absent` made an unlogged machine read as a real, empty history.
      return {
        manifest: shaped.manifest === null || shaped.manifest === undefined ? null : (shaped.manifest as ReplyManifest),
        absent: shaped.absent === true,
        skipped: typeof shaped.skipped === 'number' && Number.isFinite(shaped.skipped) ? shaped.skipped : 0,
      }
    },
  }
}

/** The fact a view should render, from whatever the source answered. */
export function factOfRead(read: WhyRead | null | undefined): ManifestFact {
  if (read === null || read === undefined) return manifestFactOf(null)
  if (read.manifest === null && read.absent !== true) {
    // The store exists and holds no receipt for this reply. That is a different sentence from a machine that has never
    // logged one, and the view says which.
    return { known: false, why: 'the receipt for this reply has not been written yet' }
  }
  return manifestFactOf(read.manifest)
}
