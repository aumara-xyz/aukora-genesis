// SPDX-License-Identifier: AGPL-3.0-or-later
// Upstream orchestration: aumara-xyz/aukora-phi surface/mind/governedRecall.ts
// Commit: a099901ad5a2d623c5343263de6ae5f9994d3159
// SHA-256: vendor/aukora-governed-recall/PROVENANCE.json#/files/21/sha256
// Kira adapter, not a verbatim port: journal consent, caller scope and supersession
// are projected onto the unchanged upstream predicates. No capability comes from text.
import { recallScoped } from './recall.mjs'
import { classifyEvidence, decodeToAuditVerdict } from './containment.mjs'
import { stalenessVerdict } from './staleness.mjs'
import { contentHash, verifyContentHash } from '../memory-quality.mjs'

const counted = new WeakMap()
export function countDrop(governed, reason, id) {
  let seen = counted.get(governed)
  if (!seen) { seen = new Set(); counted.set(governed, seen) }
  if (seen.has(id)) return
  seen.add(id)
  governed.dropped += 1
  governed.reasons[reason] = (governed.reasons[reason] ?? 0) + 1
}

// Kira stores canonical seconds; the donor deliberately accepts milliseconds only.
const instant = value => typeof value !== 'string' ? value : /^\d{4}-\d{2}-\d{2}$/u.test(value)
  ? `${value}T00:00:00.000Z` : value.replace(/T(\d\d:\d\d:\d\d)Z$/u, 'T$1.000Z')
export const recallAnnotations = note => ({
  advisoryOnly: true, grantsAuthority: false, containment: note.containment, staleness: note.staleness,
})

// Keep the signed envelope authoritative for identity/privacy, and read governance
// metadata from the original content before a snippet or UI projection discards it.
export function signedRecallRecord({ record, text }, entries = []) {
  const content = record.content ?? {}
  const metadata = Object.fromEntries(['scope', 'consent', 'validTo', 'expiresBy', 'hidden', 'forgotten',
    'current', 'category', 'origin'].filter(key => content[key] !== undefined).map(key => [key, content[key]]))
  const statement = text ?? (typeof content.note === 'string' ? content.note : JSON.stringify(content))
  return { ...metadata, id: record.recordId, recordId: record.recordId, tier: 'signed', contentHash: contentHash(statement),
    subject: record.subject, privacy: record.privacy, kind: record.kind, createdAt: record.createdAt,
    source: record.source, statement,
    supersededBy: entries.filter(entry => entry.record?.links?.some(link =>
      link.relation === 'supersedes' && link.recordId === record.recordId)).map(entry => entry.record.recordId) }
}

/** Host-only context; neither the tool parameters nor the recalled text can widen it. */
export function filterMemoryRecords(records, context, governed) {
  const kept = []
  for (const note of records) {
    const id = String(note.id ?? note.recordId)
    if (note.recallRefusal) { countDrop(governed, note.recallRefusal, id); continue }
    const moved = context.states?.get(id)
    const forgotten = context.forgotten?.has(id) || note.forgotten === true
    const hidden = moved === 'hidden' || note.hidden === true
    const text = note.statement ?? note.text
    if (note.contentHash !== undefined && !verifyContentHash(text, note.contentHash).ok) {
      countDrop(governed, 'content-hash-mismatch', id); continue
    }
    const record = { recordId: id, content: text, createdAt: instant(note.observedAt ?? note.createdAt) ?? '',
      kind: note.kind ?? 'observation', provenance: 'kira:recalled-data' }
    // recallScoped's first guard runs before scoring or classification, including hidden consent.
    if (!recallScoped([record], {}, new Set(forgotten || hidden ? [id] : [])).length) {
      countDrop(governed, forgotten ? 'forgotten' : 'hidden', id); continue
    }
    let refusal
    if (note.subject !== context.subject) refusal = 'subject-out-of-scope'
    else if (!context.permittedPrivacy?.includes(note.privacy)) refusal = 'privacy-out-of-scope'
    const scope = note.scope ?? 'owner'
    if (!refusal && (scope === 'session' || String(scope).startsWith('session:'))) {
      const session = scope === 'session' ? note.source?.sessionId : scope.slice(8)
      if (!session || session !== context.sessionId) refusal = 'session-out-of-scope'
    } else if (!refusal && scope !== 'owner' && scope !== 'agent' && !(context.attachedProjects ?? []).includes(scope)) refusal = 'scope-not-attached'
    if (refusal) { countDrop(governed, refusal, id); continue }
    // Consent controls visibility, never approval to remember. Owner-only is ordinary private memory.
    if (note.consent === 'hidden') { countDrop(governed, 'hidden', id); continue }
    const ingest = { decision: 'data', provenance: 'untrusted-external' }
    // Kira's registered representation is plaintext. Quarantine strips source trust,
    // while the string remains displayable as DATA; no command/token decoder is used.
    const decoded = decodeToAuditVerdict({ decoded: typeof text === 'string', auditSummary: typeof text === 'string' ? text : undefined })
    const containment = classifyEvidence({ hasAuditSummary: decoded.disposition === 'readable_advisory',
      codebookKnown: typeof text === 'string', finite: true, withinBounds: typeof text === 'string' && text.length <= 1_000_000 })
    if (containment.disposition !== 'readable_advisory') { countDrop(governed, 'containment-quarantine', id); continue }
    const replaced = moved === 'superseded' || note.current === false
      || (Array.isArray(note.supersededBy) ? note.supersededBy.length > 0 : Boolean(note.supersededBy))
    const explicitStale = moved === 'expired' || note.staleness?.flagged === true || note.stale === true
    const expiresBy = instant(note.validTo ?? note.expiresBy)
    const staleness = replaced || explicitStale || expiresBy != null
      ? stalenessVerdict({ createdAt: record.createdAt,
        expiresBy: replaced || explicitStale ? '1970-01-01T00:00:00.000Z' : expiresBy }, context.nowMs)
      : { state: 'fresh', flagged: false, horizon: 'none', expiresBy: null, expiringSoon: false }
    kept.push({ ...note, advisoryOnly: true, grantsAuthority: false,
      containment: { ...containment, kind: 'DATA', ingest: ingest.decision,
        ...(ingest.provenance ? { provenance: ingest.provenance } : {}) },
      staleness: { ...staleness, ...(replaced ? { reason: 'superseded' } : {}) } })
  }
  return kept
}

// Historical import compatibility; no approval or tier gating.
export const governRecords = filterMemoryRecords
