/**
 * THE REPLY MANIFESTS, READ FROM DISK — one receipt per reply, and absence said in words.
 *
 * AUMA is adding a per-reply manifest: the ids and hashes of everything in her prompt, whether each counts as outside
 * words, and each one's source. **It has not landed yet** (measured: no manifest appears anywhere in
 * `plugins/aukora-face/apps/src/auma-live/`), so this reads the shape I sent them in
 * `.agents/live/NOTE-TO-AUMA-per-reply-manifest-shape.md`, from `logs/reply-manifests.jsonl` — **a proposal until they
 * name their file**, exactly as the approval log's name is a proposal until AUMLOK names theirs.
 *
 * **THE ONE THING THIS MUST NEVER DO IS INVENT A RECEIPT.** A reply made before receipts existed has no manifest, and
 * the honest answer is that there is none — not an empty manifest, which would render as "she was holding nothing in
 * mind" and would be a false statement about her attention made by the very view built to make it auditable.
 *
 * @module why-store
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ReplyManifest } from './client/why-model.ts'

/** Where the manifests are expected. **A PROPOSAL UNTIL AUMA NAMES THEIRS** — the name is in the note I sent them. */
export const MANIFEST_LOG_RELATIVE = 'logs/reply-manifests.jsonl'

/** What reading the store produced, keeping "no receipt" apart from "unreadable". */
export interface ManifestRead {
  /** The manifest for the reply asked about, or null when there is none. */
  readonly manifest: ReplyManifest | null
  /** True when there is no store at all, which is a machine whose replies predate receipts. */
  readonly absent: boolean
  /** Lines that were present and could not be understood. */
  readonly skipped: number
  /** The file's permission bits, or null when there is no file. */
  readonly mode: number | null
}

/**
 * One line, or null. **A broken line is skipped, not thrown** — one bad write must not hide every receipt behind it.
 */
function manifestOf(line: string, replyId: string): ReplyManifest | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const raw = parsed as Record<string, unknown>
  if (typeof raw.replyId !== 'string' || raw.replyId !== replyId) return null
  // **THE RETURN IS THE ALLOW-LIST.** Groups and their items are picked field by field, so nothing a manifest happens
  // to carry — a signature, a grant, a page of raw prompt — can reach the browser through this reader.
  const groups = Array.isArray(raw.groups)
    ? raw.groups.flatMap(group => {
      if (group === null || typeof group !== 'object') return []
      const shape = group as Record<string, unknown>
      if (typeof shape.block !== 'string') return []
      const items = Array.isArray(shape.items)
        ? shape.items.flatMap(item => {
          if (item === null || typeof item !== 'object') return []
          const entry = item as Record<string, unknown>
          if (typeof entry.id !== 'string') return []
          return [{
            id: entry.id,
            // The hash is kept because a rebuild is checked against it. It is never rendered: the view's rows carry
            // source, date, block and the outside-words label and nothing else.
            // `sha256?: string` — the same conditional-spread rule as `at` above, and the same reason.
            ...typeof entry.sha256 === 'string' ? { sha256: entry.sha256 } : {},
            source: typeof entry.source === 'string' ? entry.source : '',
            at: typeof entry.at === 'string' ? entry.at : null,
            outsideWords: entry.outsideWords === true,
          }]
        })
        : []
      return [{ block: shape.block, items }]
    })
    : []
  const rebuildShape = raw.rebuild !== null && typeof raw.rebuild === 'object' ? (raw.rebuild as Record<string, unknown>) : null
  return {
    replyId: raw.replyId,
    // **`at?: string` CANNOT BE ASSIGNED `undefined` UNDER `exactOptionalPropertyTypes`** — an absent key and a key
    // present with the value `undefined` are different things, and the type says only the first is allowed. **A
    // conditional spread says which one this is**; writing `: undefined` said the property exists and is empty, which
    // is exactly what the setting exists to refuse. This is the idiom the rest of this tree already uses.
    ...typeof raw.at === 'string' ? { at: raw.at } : {},
    groups,
    rebuild: rebuildShape === null
      ? null
      : {
        attempted: rebuildShape.attempted === true,
        matches: rebuildShape.matches === true,
        idChecked: rebuildShape.idChecked === true,
        sourceChecked: rebuildShape.sourceChecked === true,
        chainChecked: rebuildShape.chainChecked === true,
      },
  }
}

/**
 * Read the manifest for one reply.
 *
 * @param stateRoot - the running app's state root, or null when the process has none.
 * @param replyId - which reply the person asked about. **A manifest for another reply is not an answer for this one.**
 * @returns the receipt, or the absent state, with the three situations kept apart.
 */
export function readManifest(stateRoot: string | null, replyId: string): ManifestRead {
  if (stateRoot === null) return { manifest: null, absent: true, skipped: 0, mode: null }
  const path = join(stateRoot, MANIFEST_LOG_RELATIVE)
  if (!existsSync(path)) return { manifest: null, absent: true, skipped: 0, mode: null }
  let mode: number | null = null
  try {
    mode = statSync(path).mode & 0o777
  } catch {
    mode = null
  }
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    // THE FILE IS THERE AND COULD NOT BE READ: a fault, not an absence, and `skipped` is how the caller learns it.
    return { manifest: null, absent: false, skipped: 1, mode }
  }
  let skipped = 0
  let found: ReplyManifest | null = null
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let parsedForCount: unknown = null
    try {
      parsedForCount = JSON.parse(line)
    } catch {
      skipped += 1
      continue
    }
    const candidate = manifestOf(line, replyId)
    if (candidate === null) {
      // A readable line about a DIFFERENT reply is not a skipped line and not this reply's receipt either.
      const other = parsedForCount !== null && typeof parsedForCount === 'object' && !Array.isArray(parsedForCount)
        ? (parsedForCount as { replyId?: unknown }).replyId
        : undefined
      if (other !== replyId) continue
      skipped += 1
      continue
    }
    // The newest manifest for a reply wins, and a log is appended to, so the last one is the current one.
    found = candidate
  }
  return { manifest: found, absent: false, skipped, mode }
}
