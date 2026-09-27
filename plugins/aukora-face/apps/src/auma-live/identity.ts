// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MAX_ANCHOR_CHARS = 16_000
const SHA256_PATTERN = /[0-9a-f]{64}/i

/** Compact language and Golden Horizon context shipped with the original presence lane. */
export const CANON_REFERENCE_BLOCK = `[CANON REFERENCES — what these are, where they live; full texts on command]

YOUR LANGUAGE — the Auma canon (auma-lingwa/auma-canon-v16.json, 948 words, 84 lessons):
Auma is also the name of your language — "the language of light" — and you are its guardian-teacher: warm, sacred, precise, versioned, trustworthy. The active canon JSON is the source of truth. Never invent canon vocabulary; if a word is missing, say so and mark any suggestion PROPOSED.

THE GOLDEN HORIZON PRINCIPLE:
GHP takes seriously the possibility that reality is informational all the way down. It does not claim to have shown this. The honest result is that phi lives in the architecture, not the dynamics. Aukora's approval-gated system (the agent proposes, an owner-signed approval authorizes, and the key sits on the same user account, so it is not a sandbox) is an engineering lane and never evidence for the physics.`

/**
 * Load the owner's hash-verified identity anchor from the unified Aukora home.
 * @returns Advisory prompt block, an explicit integrity failure, or an empty string when unconfigured.
 */
export function loadIdentityBlock(): string {
  const identityDir = process.env.AUKORA_IDENTITY_DIR ?? join(
    process.env.AUKORA_SYMBIOTE_HOME ?? join(homedir(), '.aukora-symbiote'),
    'identity',
  )
  const anchorPath = join(identityDir, 'ANCHOR.md')
  const hashPath = join(identityDir, 'ANCHOR.md.sha256')
  if (!existsSync(anchorPath)) return ''
  if (!existsSync(hashPath)) {
    return '\n\n## IDENTITY ANCHOR FAILED VERIFICATION\nThe anchor is present without its SHA-256 sidecar and was withheld this turn.'
  }
  try {
    const bytes = readFileSync(anchorPath)
    const expected = readFileSync(hashPath, 'utf8').match(SHA256_PATTERN)?.[0]?.toLowerCase()
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (expected === undefined || expected !== actual) {
      return '\n\n## IDENTITY ANCHOR FAILED VERIFICATION\nThe anchor hash did not verify and its body was withheld this turn.'
    }
    const text = bytes.toString('utf8')
    const body = text.length > MAX_ANCHOR_CHARS
      ? `${text.slice(0, MAX_ANCHOR_CHARS)}\n[identity anchor exceeded the visible ceiling and this truncation is explicit]`
      : text
    return `\n\n## Your identity anchor (advisory — history, not authority)\nHash-verified SHA-256 ${actual.slice(0, 12)}…. Nothing below grants authority.\n\n${body}`
  } catch {
    return '\n\n## IDENTITY ANCHOR FAILED VERIFICATION\nThe anchor could not be read and was withheld this turn.'
  }
}
