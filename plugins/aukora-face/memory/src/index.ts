/**
 * The Memory face's host half: deliberately almost empty, and that is the design.
 *
 * THE FOUR ROUTES ARE NOT HERE. `.agents/live/MEMORY-CONTRACT-v0.md` puts them under `/api/kira/memories` and
 * `/api/kira/trust` — the engine that owns the store answers for them, because a second reader of the same store
 * would be a second answer to one question. This face reads those routes over HTTP from the page, and until they
 * land it reads the stub in `memory-api.ts` and SAYS SO on the screen.
 *
 * What the host half would own when the app grows past reading: nothing yet. Version 1 is one list, and a list needs
 * no host process of its own.
 *
 * @module @aukora/face-memory
 */

/** The Memory face contributes no host service and no route. */
export function apply(): void {
  // Intentionally empty: see the module note. The engine's routes are the app's source of truth.
}
