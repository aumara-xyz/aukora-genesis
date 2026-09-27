// WHICH WORD THE BADGE READS, decided in one place a court can reach.
//
// §3 gives the badge TWO words for the THREE states: UNBOUND before a binding, BOUND after it and
// through a refresh, because a refresh is an act ON the bound state and the old binding stands until
// the new words are typed back. PREVIEW was the word this badge read while the screen was a preview of
// a ceremony that ran somewhere else; the ceremony runs here now, so the word is the state itself.
//
// §5 step 4: the screen flips UNBOUND -> BOUND once an owner is bound, and the ceremony tells the
// person "the Aumlok screen will read BOUND once it refreshes". The badge rendered one word
// unconditionally in every build, so that sentence was false for every person who ever read it.
//
// THE DECISION IS KEYED OFF THE SAME STATUS THE SCREEN ALREADY BRANCHES ON — the RUNTIME_POSTURE
// lookup in AumlokSurface.tsx and the `projection.status` it is indexed by — never off a second
// reading of the controller directory: one fact, one source. The state itself is decided in
// `surface-state.ts`, so the badge and the tiles cannot disagree about the same machine. It lives here,
// outside the React component, because this face's court measures decisions and shipped bytes rather
// than rendered markup, so a decision that existed only inside JSX could not be measured at all.
import type { AumlokKey } from './locales.ts'
import type { AumlokControlProjectionState } from './control-projection.ts'
import { aumlokBadgeWord, aumlokSurfaceState } from './surface-state.ts'

/** The closed set of words the badge can read. */
export type AumlokBadgeKey = Extract<AumlokKey, 'unbound' | 'bound'>

/** BOUND once an owner is bound; UNBOUND until then. */
export function aumlokBadgeKey(status: AumlokControlProjectionState['status']): AumlokBadgeKey {
  return aumlokBadgeWord(aumlokSurfaceState({ bound: status === 'connected', refreshing: false }))
}
