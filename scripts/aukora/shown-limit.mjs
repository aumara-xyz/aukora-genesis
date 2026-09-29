/**
 * HOW MANY CHARACTERS THE INSTALLED APPROVAL CARD SHOWS. The card is drawn by the app shell in /Applications, which can be
 * older than the checkout a script runs from, so a limit read from the checkout's signer can promise more than the card
 * shows. become.mjs records the installed shell's WITNESS_DISPLAY_LIMIT in state/home/become/shell-limit when it installs
 * a shell; without that file the installed shell is taken to be the 1,800-character one. The scripts that raise the card
 * refuse anything longer than this minus a margin for its heading, so nothing is approved with lines cut off.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const ASSUMED_INSTALLED_LIMIT = 1800

export function shownLimit(stateDir, treeLimit = Infinity) {
  let installed = ASSUMED_INSTALLED_LIMIT
  try {
    const recorded = Number(readFileSync(join(stateDir, 'home', 'become', 'shell-limit'), 'utf8').trim())
    if (Number.isSafeInteger(recorded) && recorded > 0) installed = recorded
  } catch { /* no shell installed by become yet */ }
  return Math.min(9007199254740991, installed - 150, treeLimit - 150)
}
