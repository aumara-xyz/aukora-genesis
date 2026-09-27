/**
 * **THE ELEVEN FACE CONFIGS IMPORT THIS PATH, AND UNTIL NOW NOTHING WAS HERE.**
 *
 * ```ts
 * import { clientBundle } from '../tsdown.client.ts'      // in every one of the 11 configs
 * ```
 *
 * **THE PRESET IS UPSTREAM'S, AND IT IS NOT OURS TO COPY.** It lives at
 * `vendor/dsh/packages/client/tsdown.client.ts`, *installed by `scripts/build-dsh.py` and never edited by hand
 * (`AGENTS.md`)*, and **its own imports are relative and deep** — `./modules/src/client/manifest.ts`,
 * `./web/src/platform.ts`, `../../scripts/client-build-environment.ts` — **so a copy beside the faces would break every
 * one of them.** *This file re-exports it instead of forking it.*
 *
 * **AND IT IS NOT USED BY THE OVERLAY BUILD, WHICH IS THE POINT.** `scripts/build-face.py` copies each face into
 * `.runtime/face-build/packages/client/aukora-face-<name>/` — **and this file sits one level ABOVE the face directories,
 * so it is not copied with them.** *In the overlay, `'../tsdown.client.ts'` resolves to `packages/client/tsdown.client.ts`,
 * which is upstream's own file, byte for byte.* **So the overlay path is untouched by this file, and it exists for the
 * one case the overlay does not cover: running a face's own config from the repository checkout.**
 *
 * **PREREQUISITE, STATED RATHER THAN IMPLIED:** `vendor/dsh` is ignored (`.gitignore:28`) and installed by
 * `scripts/build-dsh.py`. *A checkout without it cannot resolve this re-export — and cannot build a face by ANY path,
 * including `build-face.py`, whose first act is to read the pinned tree.* **`AGENTS.md` states the same rule in its first
 * section: the build checks need that tree; the keyless courts do not.**
 */
export * from '../vendor/dsh/packages/client/tsdown.client.ts'
