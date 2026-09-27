/**
 * THE FIRST RUN'S HOST HALF — the two facts the screen cannot know by itself, and the one secret it must not keep.
 *
 * The screen (`FirstRunSurface.tsx`) renders what a person sees; `first-run.ts` decides what those things mean. This
 * module is the third part: it answers **"is this a first run?"** and it **stores the person's key**. Three rules,
 * each of which the code below is shaped by:
 *
 *  1. **A FIRST RUN IS DECIDED FROM THE STATE, NOT FROM A FLAG.** Nobody in this repository writes an owner profile
 *     today — `owner.json`, `writeOwner` and `ownerProfile` appear in neither KIRA's tree nor the faces' — so this
 *     module defines the file it reads and writes, in one place, and the screen's own `isFirstRun` is the same
 *     decision seen from the other side.
 *  2. **THE KEY GOES IN, AND ONLY A TAIL EVER COMES BACK.** Measured in the harness: its last-resort guard logs the
 *     **error object**, never the request body (`vendor/dsh/packages/host/webserver/src/index.ts:241`), so a key in a
 *     POST is not logged by the server — and this module keeps that true by never putting the key in a message, an
 *     error or a response. A stored key is answered as its last four characters and nothing else.
 *  3. **STATE ROOT IS READ, NOT GUESSED.** The running app's variable is `AUKORA_STATE_ROOT`
 *     (`plugins/aukora-eye/lib/token-file.mjs:36`); the materializer's `AUKORA_STATE` is a different one, and this
 *     module never invents a home directory of its own.
 *
 * @module first-run-host
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Every way this host half answers, so a route never has to compose a status by hand. */
export const FIRST_RUN_REFUSALS = Object.freeze({
  BODY_NOT_OBJECT: 'first-run:body-not-an-object',
  NAME_MISSING: 'first-run:name-missing',
  KEY_MISSING: 'first-run:key-missing',
  NO_STATE_ROOT: 'first-run:no-state-root',
})

/** The state root the running app uses, or null when the process was started without one. */
export function stateRootOf(env: Record<string, string | undefined>): string | null {
  const root = env.AUKORA_STATE_ROOT ?? env.AUKORA_STATE
  return typeof root === 'string' && root.trim() !== '' ? root.replace(/\/+$/u, '') : null
}

/** The profile file, beside the state it describes. One definition, used by the reader and the writer. */
export function ownerFileIn(stateRoot: string): string {
  return join(stateRoot, 'owner.json')
}

/**
 * The person's key file. `secrets/` rather than the state root itself, so a directory listing of their state does not
 * put a credential beside their memories.
 */
export function keyFileIn(stateRoot: string): string {
  return join(stateRoot, 'secrets', 'openrouter-key')
}

/**
 * The profile a state file holds, or null.
 *
 * **A FILE THAT CANNOT BE READ IS NOT A PROFILE AND IS NOT A CRASH.** A half-written file, a file somebody edited by
 * hand, an empty file — each returns null, which means "no profile", which means a first run. That is the safe
 * direction: showing the first-run screen again is a small annoyance, while reading a broken file as a profile would
 * let somebody through a screen they have not filled in.
 */
export function profileOf(text: string | null | undefined): { readonly name: string } | null {
  if (typeof text !== 'string' || text.trim() === '') return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const name = (parsed as { name?: unknown }).name
    return typeof name === 'string' && name.trim() !== '' ? { name: name.trim() } : null
  } catch {
    return null
  }
}

/** What the screen is told: whether this is a first run, the name if there is one, and whether a key is stored. */
export interface FirstRunAnswer {
  readonly firstRun: boolean
  readonly name: string | null
  /** The last four characters of a stored key, or null. **Never the key itself.** */
  readonly keyTail: string | null
}

/** The tail of a stored secret: four characters, and never the secret. A four-character secret yields nothing. */
export function tailOf(secret: string | null | undefined): string | null {
  if (typeof secret !== 'string') return null
  const trimmed = secret.trim()
  return trimmed.length <= 4 ? null : trimmed.slice(-4)
}

/** Read the state and answer the screen. Every failure to read is "no profile", never an error the screen must parse. */
export function firstRunAnswer(stateRoot: string | null): FirstRunAnswer {
  if (stateRoot === null) return { firstRun: true, name: null, keyTail: null }
  const owner = existsSync(ownerFileIn(stateRoot))
    ? profileOf(readFileSync(ownerFileIn(stateRoot), 'utf8'))
    : null
  const keyFile = keyFileIn(stateRoot)
  const keyTail = existsSync(keyFile) ? tailOf(readFileSync(keyFile, 'utf8')) : null
  return { firstRun: owner === null, name: owner?.name ?? null, keyTail }
}

/**
 * Store the person's name, creating the state directory if the installer has not yet.
 *
 * @returns the answer the screen should now show.
 */
export function rememberName(stateRoot: string, name: string, voice?: 'on' | 'off'): FirstRunAnswer {
  const trimmed = name.trim()
  mkdirSync(dirname(ownerFileIn(stateRoot)), { recursive: true })
  // THE VOICE CHOICE IS REMEMBERED BESIDE THE NAME, because it is the same kind of fact: something the person told
  // the app about themselves. The key is the only thing here that is a secret, and it is the only thing kept apart.
  const profile = voice === undefined ? { name: trimmed } : { name: trimmed, voice }
  writeFileSync(ownerFileIn(stateRoot), `${JSON.stringify(profile)}\n`, { mode: 0o600 })
  return firstRunAnswer(stateRoot)
}

/** Store the key, with the file readable only by its owner. **The key is never returned, logged or echoed.** */
export function rememberKey(stateRoot: string, key: string): FirstRunAnswer {
  const path = keyFileIn(stateRoot)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, key.trim(), { mode: 0o600 })
  return firstRunAnswer(stateRoot)
}

/** Remove the stored key. Removing one that is not there is a success, because the person asked for it to be gone. */
export function forgetKey(stateRoot: string): FirstRunAnswer {
  const path = keyFileIn(stateRoot)
  if (existsSync(path)) rmSync(path)
  return firstRunAnswer(stateRoot)
}
