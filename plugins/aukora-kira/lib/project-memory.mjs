/** Project continuity uses host session metadata, never a path proposed in recalled text.
 * Only Git metadata is read to join worktrees; no project files are ingested. */
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { sha256Hex } from './memory-tiers.mjs'
import { recallFilter } from './memory-frame.mjs'

const projectScopes = new Map()
export function projectScopeOf(agent) {
  const cwd = agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) return null
  if (projectScopes.has(cwd)) return projectScopes.get(cwd)
  try {
    let root = realpathSync(cwd)
    try {
      const common = execFileSync('git', ['-C', root, 'rev-parse', '--git-common-dir'], {
        encoding: 'utf8', timeout: 1500, maxBuffer: 4096, stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      root = realpathSync(resolve(root, common))
    } catch { /* A non-Git project remains scoped to its host cwd. */ }
    const scope = `project:${sha256Hex(root)}`
    if (projectScopes.size >= 128) projectScopes.delete(projectScopes.keys().next().value)
    projectScopes.set(cwd, scope)
    return scope
  } catch { return null }
}

/** The policy is acquired by the composition's read owner. This function only filters. */
export function visibleRemembered(notes, policy, scope) {
  return (Array.isArray(notes) ? notes : []).filter(note => note?.subject === policy?.subject
    && note.privacy === 'local' && policy?.permittedPrivacy?.includes('local')
    && (note.scope === undefined || note.scope === 'owner' || note.scope === 'agent' || note.scope === scope))
}

export function rememberedSnippet(note) {
  return {
    recordId: note.id, text: String(note.statement ?? note.text ?? '').slice(0, 600),
    contentHash: note.contentHash, contentHashScope: 'full-statement',
    observedAt: note.observedAt, tier: 'remembered', attributedTo: note.attributedTo,
    source: note.source, scope: note.scope,
    citation: { remembered: true, sessionId: note.source?.sessionId, seq: note.source?.seq,
      sha256: note.source?.sha256, entryHash: note.aura?.entryHash },
  }
}

/** Newest project findings, not oldest ledger entries or personal trivia. The
 * timestamp is observation time; a receipt proves a report existed, not its truth. */
export function projectRecent(notes, policy, scope, states, { unreadable = 0, unchained = 0 } = {}) {
  if (scope === null) return { snippets: [], projectState: true, availability: 'undetermined', reason: 'host-project-scope-unavailable' }
  const diagnostics = []
  const complete = unreadable === 0 && unchained === 0
  for (const [reason, count] of [['unreadable', unreadable], ['unchained', unchained]]) if (count > 0) diagnostics.push({ reason, count })
  const recent = visibleRemembered(notes, policy, scope)
    .filter(note => note.scope === scope && note.attributedTo === 'agent')
    .filter(note => {
      const verdict = recallFilter(note, { now: new Date().toISOString(), attachedProjects: [scope], states })
      if (!verdict.ok) diagnostics.push({ reason: verdict.why })
      return verdict.ok
    })
    .sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt))
      || Number(b.source?.seq ?? 0) - Number(a.source?.seq ?? 0) || String(a.id).localeCompare(String(b.id)))
  return { snippets: recent.slice(0, 3).map(rememberedSnippet), projectState: true, diagnostics,
    availability: complete ? recent.length ? 'found' : 'empty' : 'undetermined',
    reason: !complete ? 'remembered-store-unavailable' : recent.length ? 'newest-agent-reports-not-live-attestation' : 'no-eligible-captured-project-findings' }
}
