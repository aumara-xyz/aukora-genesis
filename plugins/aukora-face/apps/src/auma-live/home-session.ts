// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * HER HOME SESSION ON THE HOST — which live session a presence turn goes through.
 *
 * **THE DEFECT.** `presence()` accepted only a session already live in the in-memory `SessionStore`
 * (`sessions.get(id)`). Her configured home, not opened since boot, got `409 selected session is not live`, and the
 * page turned that into "Choose an active thread in Aukora, then reopen Auma Live" — so a fresh app start could not
 * answer even with a home configured.
 *
 * **THE RULES, each a line a court deletes:**
 *   1. A requested session that is live answers through itself.
 *   2. A requested session that is NOT live FALLS BACK to the configured home, and the answer names what it fell
 *      back from so the page can say so.
 *   3. The home, when not live, is RESUMED on demand through the host's own resume path — the session
 *      controller's `resolveAgent`, the same `resolve` a client opening a thread reaches
 *      (`vendor/dsh/packages/api/session-controller/src/agent.ts`). **Only the configured home is ever resumed
 *      here**; a stale selection is never resumed on its behalf.
 *   4. A missing home (`no-home`) and an unknown one (`home-not-found`) are refused BY NAME. A home that is not
 *      live on a host with no session controller to resume it is `home-not-resumable`: the page must not promise
 *      that saying it again will help. A resume that fails for another reason is `home-unavailable`. None of them
 *      tells anyone to choose a thread.
 *
 * Pure and DOM-free, with type-only imports, so `tests/laya-auma-live-home-session.test.mjs` imports this file as
 * it is and runs it — and runs copies of it with each rule deleted.
 */
import type { Session, SessionId } from '@deepseek-ai/dsh-session'

/** What the host's resume path said about one session id. */
export type HomeResume =
  | { readonly session: Session }
  | { readonly error: string; readonly code?: string }

/**
 * The code the host's resume path gives when there is no session controller to resume through. `index.ts` sets it;
 * this module turns it into `home-not-resumable`, so the page does not tell Peter to try again.
 */
export const CONTROLLER_UNMOUNTED = 'session-controller/unmounted'

/** Where a presence turn may find its session. */
export interface PresenceSessionSources {
  /** The configured home; '' when none is configured. */
  readonly homeSession: string
  /** The live in-memory lookup (`ctx.sessions.get`). */
  readonly live: (id: SessionId) => Session | undefined
  /** The host's resume path; absent when no session controller is mounted. */
  readonly resume?: (id: SessionId) => Promise<HomeResume>
}

/** A named refusal: the status the route answers, the code the page maps to a sentence, and the operator text. */
export interface PresenceSessionRefusal {
  readonly status: 409 | 503
  readonly code: 'no-home' | 'home-not-found' | 'home-not-resumable' | 'home-unavailable'
  readonly message: string
}

/** The session a turn goes through, or the reason there is none. */
export type PresenceSession =
  | { readonly session: Session; readonly fellBackFrom?: string }
  | { readonly refusal: PresenceSessionRefusal }

/** The longest session id the presence route accepts. */
export const MAX_SESSION_ID = 256

/**
 * Refuse a configured home that cannot be a session id, BY NAME, when the face loads.
 * @param homeSession - the configured value.
 * @returns the value to use ('' when none is configured).
 * @throws when the value is set but is not a usable session id.
 */
export function checkHomeSessionConfig(homeSession: string): string {
  if (homeSession === '') return ''
  if (homeSession !== homeSession.trim() || homeSession.length > MAX_SESSION_ID || /[\u0000-\u001f\u007f]/u.test(homeSession)) {
    throw new Error(`ui-stock-apps: homeSession ${JSON.stringify(homeSession)} is not a session id `
      + `(no surrounding space, no control characters, at most ${String(MAX_SESSION_ID)} characters)`)
  }
  return homeSession
}

/**
 * Resolve the session one presence turn goes through.
 * @param requested - the session the page named; '' when it named none.
 * @param sources - the configured home, the live lookup and the resume path.
 * @returns the live session (and what it fell back from), or a named refusal.
 */
export async function resolvePresenceSession(
  requested: string,
  sources: PresenceSessionSources,
): Promise<PresenceSession> {
  const asked = requested === '' ? undefined : sources.live(requested as SessionId)
  if (asked !== undefined) return { session: asked }
  const home = sources.homeSession
  if (home === '') {
    return {
      refusal: {
        status: 409,
        code: 'no-home',
        message: requested === ''
          ? 'no session was named and no home session is configured for Auma Live (homeSession)'
          : `session "${requested}" is not open on this host and no home session is configured for Auma Live (homeSession)`,
      },
    }
  }
  const reached = await reachHome(home as SessionId, sources)
  if ('refusal' in reached) return reached
  if (requested === '' || requested === home) return { session: reached.session }
  // **A SELECTED THREAD THAT IS NOT LIVE FALLS BACK TO HER HOME**, and says what it fell back from.
  return { session: reached.session, fellBackFrom: requested }
}

/**
 * The home, live or resumed. The ONLY id this ever resumes is the configured home.
 * @param home - the configured home.
 * @param sources - the live lookup and the resume path.
 * @returns the live home session, or a named refusal.
 */
async function reachHome(
  home: SessionId,
  sources: PresenceSessionSources,
): Promise<{ readonly session: Session } | { readonly refusal: PresenceSessionRefusal }> {
  const live = sources.live(home)
  if (live !== undefined) return { session: live }
  let outcome: HomeResume = {
    error: 'it is not live, and this host mounts no session controller to resume it', code: CONTROLLER_UNMOUNTED,
  }
  // **RESUMED ON DEMAND**, through the same path a client opening the thread uses.
  if (sources.resume !== undefined) outcome = await resumeOnce(sources.resume, home)
  if ('session' in outcome) return { session: outcome.session }
  if (outcome.code === 'session/not-found') {
    return {
      refusal: {
        status: 409,
        code: 'home-not-found',
        message: `the configured home session "${home}" does not exist on this host`,
      },
    }
  }
  if (outcome.code === CONTROLLER_UNMOUNTED) {
    // NOT "try again in a moment": nothing on this host can open the home until a session controller is mounted.
    return {
      refusal: {
        status: 503,
        code: 'home-not-resumable',
        message: `the configured home session "${home}" is not live, and nothing on this host can resume it: ${outcome.error}`,
      },
    }
  }
  return {
    refusal: {
      status: 503,
      code: 'home-unavailable',
      message: `the configured home session "${home}" could not be resumed: ${outcome.error}`,
    },
  }
}

/** One resume, with a thrown failure kept as a reason rather than an unhandled rejection. */
async function resumeOnce(resume: (id: SessionId) => Promise<HomeResume>, home: SessionId): Promise<HomeResume> {
  try {
    return await resume(home)
  } catch (error: unknown) {
    return { error: String((error as { message?: unknown } | null)?.message ?? error) }
  }
}
