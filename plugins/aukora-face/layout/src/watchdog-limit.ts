/**
 * THE WATCHDOG'S RESTART THRESHOLD, READ FROM THE FILE THAT OWNS IT.
 *
 * **WHY THIS IS NOT IN THE SAMPLER.** The sampler's promise is that it reads **nothing private** — names and sizes, a
 * volume's free space, a kernel counter, a process's footprint. My first version put this function in that module, and
 * the sampler's own privacy arm caught it immediately, because reading a threshold means reading a **file's contents**.
 * The arm was right and the fix was not to weaken the arm: the sampler reads the machine, this reads one repository
 * file, and the two belong in different modules.
 *
 * **WHY IT PARSES THEIR SOURCE INSTEAD OF IMPORTING IT.** The number is ALPHA's: `apps/aukora-desktop/footprint-watch.mjs`
 * line 18, `FOOTPRINT_LIMIT_BYTES = Math.round(3.4 * 1024 ** 3)`. Copying it would be the second implementation their
 * own comment warns against, and importing across trees from a **face** is something no face does — the host half is
 * built, and a relative import out of the package is the kind of thing that works until the build says otherwise. The
 * number is READ, with a court that fails if the line moves or changes shape, and `null` when it cannot be read: the
 * panel then reports the proximity as unknown rather than inventing a threshold. The note asking ALPHA to expose it
 * where a face may import it is on the board; when they do, this becomes their export.
 *
 * @module watchdog-limit
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The repository root, found by walking up.
 *
 * **A FIXED RELATIVE PATH WOULD BREAK AFTER A BUILD.** This file is at `src/` today and at `lib/` once the face is
 * built, so `../../..` counts a different number of levels in each — and a path that is right in the source tree and
 * wrong in the built one is the kind of defect a panel would show as "unknown" forever. The root is found by looking
 * for the two directories that make this repository what it is.
 */
export function repoRootFrom(start: string): string | null {
  let here = start
  for (let step = 0; step < 8; step += 1) {
    if (existsSync(join(here, 'apps', 'aukora-desktop')) && existsSync(join(here, 'plugins', 'aukora-face'))) return here
    const up = dirname(here)
    if (up === here) return null
    here = up
  }
  return null
}

/** Where the watchdog's threshold lives, so a failure names the file that moved. Null when the root cannot be found. */
export function watchdogSourcePath(): string | null {
  const root = repoRootFrom(dirname(fileURLToPath(import.meta.url)))
  return root === null ? null : join(root, 'apps', 'aukora-desktop', 'footprint-watch.mjs')
}

/**
 * The threshold, or null when it could not be read.
 *
 * @param readFile - how to read a file, injected so a court can drive this without the real tree.
 * @param path - the file to read, defaulting to the watchdog's own.
 */
export function watchdogLimitBytes(
  readFile: (path: string) => string = path => readFileSync(path, 'utf8'),
  path: string | null = watchdogSourcePath(),
): number | null {
  if (path === null) return null
  let source: string
  try {
    source = readFile(path)
  } catch {
    return null
  }
  const match = /FOOTPRINT_LIMIT_BYTES\s*=\s*([^\n]+)/u.exec(source)
  if (match === null) return null
  // **THE EXPRESSION IS EVALUATED, NOT PARSED BY HAND.** Their line is arithmetic, and re-implementing arithmetic in a
  // regex would be a third way to disagree with them. Only digits, `Math.round`, `*`, `**`, parentheses and whitespace
  // are allowed through, so nothing from that file can execute as code.
  // **`match[1]` IS `string | undefined` UNDER `noUncheckedIndexedAccess`**, and this read `.trim()` on it
  // regardless — the same defect as `waiting.ts:113` (`stamped[0]`), `waiting.ts:126` (a null clock) and
  // `health-model.ts:199` (`newest` possibly undefined). **Four instances in one face, all of them an indexed or
  // optional read whose guard was assumed rather than written.**
  if (match[1] === undefined) return null
  const expression = match[1].trim().replace(/;\s*$/u, '')
  if (!/^[\d\s.*+()Mathround\u002a]+$/u.test(expression)) return null
  try {
    const value = Function(`"use strict"; return (${expression})`)() as unknown
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}
