#!/usr/bin/env node
/**
 * THE RECALL PROBE — what the live Kira store would answer, READ-ONLY, with each value's SOURCE FILE.
 *
 * WHAT IT IS FOR. Peter's checklist item 3 is "she remembers across threads and cites only verified memory". A
 * claim about that is worth nothing without the store's own numbers, so this probe prints three things and names
 * where each came from:
 *   · SETTLED HEADS — how many records the chain actually carries, and the head the verified read returned.
 *   · PENDING — how many queue entries are waiting for a person, DERIVED the way the review tool derives it: an
 *     entry whose recordId is in `keys/` has been settled, so settled is read from the STORE and never by
 *     deleting an entry.
 *   · THREE QUERIES — what recall returns for each, and what cite says about the record it returned (VERIFIED
 *     with its sequence, or the named reason it will not vouch for it).
 * It is the same read owner, the same recall service and the same cite service the plugin provides, so what it
 * prints is what Auma Live would carry — not a re-implementation that could disagree with her.
 *
 * READ-ONLY, AND BY CONSTRUCTION RATHER THAN BY PROMISE. `createMemoryOwner` CREATES `objects/`, `keys/`, `spent/`
 * and `approvals/` and MINTS AN `issuer.json` when they are absent, so a probe that simply constructed it over
 * any path would WRITE to a store — or create one. The preflight refuses unless the store already has all five,
 * which makes every mkdir a no-op and every key already present. Nothing here stages, settles, enqueues or
 * deletes; the court asserts the store's bytes are identical afterwards.
 *
 *   node scripts/kira/recall-probe.mjs [--state-dir <path>] [--subject <aukora:1:hex>] [--queries "a;b;c"] [--json]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isMainModule } from '../../scripts/lib/is-main.mjs'
import { createMemoryOwner } from '../../plugins/aukora-kira/lib/memory-owner.mjs'
// THE DIGEST IS THE OWNER'S OWN FUNCTION, and it lives in `record.mjs` — `queue.mjs` imports it from there too.
import { kiraRecordContentSha256 } from '../../plugins/aukora-kira/lib/record.mjs'
import { createKiraRecallService, readOnlySurface } from '../../plugins/aukora-kira/lib/recall-service.mjs'
import { createCiteService, CITE_VERIFIED } from '../../plugins/aukora-kira/lib/cite-service.mjs'

/** A line count, for a file whose length nothing else reports. */
export function countLines(path) {
  if (!existsSync(path)) return 0
  const text = readFileSync(path, 'utf8')
  return text === '' ? 0 : text.replace(/\n$/u, '').split('\n').length
}

/** A refusal that names itself, so a caller can tell "no store" from "a store this probe may not open". */
export class RecallProbeRefusal extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) { super(message); this.name = 'RecallProbeRefusal'; this.code = code }
}

const REQUIRED = ['objects', 'keys', 'spent', 'approvals', 'aura.jsonl', 'issuer.json']

/** Where a live store is, in the order the running app would have named it. */
export function storeCandidates(env = process.env, home = homedir()) {
  return [
    env.AUKORA_KIRA_STATE,
    env.DSH_HOME === undefined ? undefined : join(env.DSH_HOME, 'kira-memory'),
    join(home, 'Library', 'Application Support', 'AUKORA', 'state', 'home', 'kira-memory'),
    join(home, '.aukora', 'kira-memory'),
  ].filter(candidate => typeof candidate === 'string' && candidate !== '')
}

/** A store is one that ALREADY has everything `createMemoryOwner` would otherwise create. */
export const isInitialised = (dir) => REQUIRED.every(name => existsSync(join(dir, name)))

/** @returns {string} the one initialised store, or a refusal naming what it looked at. */
export function discoverStore(candidates = storeCandidates()) {
  const found = candidates.filter(isInitialised)
  if (found.length === 0) {
    throw new RecallProbeRefusal('store-not-found',
      `no initialised Kira store. Looked at: ${candidates.join(', ')}. A store has objects/, keys/, spent/, `
      + 'approvals/, aura.jsonl and issuer.json — this probe will not create one, because creating one is a WRITE.')
  }
  if (found.length > 1) {
    throw new RecallProbeRefusal('store-ambiguous',
      `more than one initialised Kira store: ${found.join(', ')}. Name the one to read with --state-dir.`)
  }
  return found[0]
}

/**
 * THE READ-ONLY PREFLIGHT. Checked BEFORE any owner exists, because the owner is what writes.
 * @param {string} stateDir
 */
export function preflight(stateDir) {
  if (typeof stateDir !== 'string' || stateDir === '') {
    throw new RecallProbeRefusal('no-state-dir', 'a store path is required')
  }
  if (!existsSync(stateDir)) {
    throw new RecallProbeRefusal('store-not-found', `${stateDir} does not exist`)
  }
  const missing = REQUIRED.filter(name => !existsSync(join(stateDir, name)))
  if (missing.length > 0) {
    throw new RecallProbeRefusal('store-not-initialised',
      `${stateDir} is not an initialised Kira store: missing ${missing.join(', ')}. Opening it would CREATE them, `
      + 'and this probe is read-only.')
  }
  return stateDir
}

/** The subject the store's records carry, read from the bytes rather than assumed. */
export function subjectOf(stateDir) {
  const objects = join(stateDir, 'objects')
  for (const name of readdirSync(objects).sort()) {
    const text = readFileSync(join(objects, name), 'utf8')
    const match = /"subject"\s*:\s*"(aukora:1:[0-9a-f]{64})"/u.exec(text)
    if (match !== null) return match[1]
    const anywhere = /(aukora:1:[0-9a-f]{64})/u.exec(text)
    if (anywhere !== null) return anywhere[1]
  }
  throw new RecallProbeRefusal('subject-not-found',
    `no aukora:1:<64 hex> subject appears in ${objects}. The read owner decides the subject and this probe will `
    + 'not guess one; pass --subject.')
}

/** The pending queue, derived the way the review tool derives it: settled lives in the STORE. */
export function queueState(queueDir, stateDir) {
  const source = join(queueDir, '*.json')
  if (!existsSync(queueDir)) return { path: queueDir, entries: 0, settled: 0, declined: 0, pending: 0, source }
  const entries = readdirSync(queueDir).filter(name => name.endsWith('.json'))
  // SETTLED IS THE STORE HOLDING THE OBJECT — `queue.mjs` says so in those words, and precedence is
  // SETTLED > DECLINED > PENDING. MEASURED against the governed `kira_queue` tool on the live store:
  // 85 entries - 2 settled - 2 declined = 81, which is the number that tool reports. An earlier version of
  // this probe derived settled from `keys/` alone and disagreed with the tool it exists to summarise.
  const held = new Set()
  for (const name of readdirSync(join(stateDir, 'objects'))) {
    try { held.add(JSON.parse(readFileSync(join(stateDir, 'objects', name), 'utf8')).key) } catch { /* unreadable */ }
  }
  const settled = entries.filter(name => held.has(name.replace(/\.json$/u, ''))).length
  const declinedDir = join(queueDir, 'settlement', 'declined')
  let declined = 0
  if (existsSync(declinedDir)) {
    // THE DIGEST IS THE OWNER'S OWN FUNCTION, NOT A RESTATEMENT: `queue.mjs` builds a row's `proposalDigest` as
    // `kiraRecordContentSha256(entry.record)`, and a queue entry FILE does not carry that field -- measured. A
    // first version of this loop looked for `proposalDigest`/`contentDigest` on the entry itself, found neither,
    // and reported zero declines against the two the governed tool reports.
    const digests = new Set()
    for (const name of entries) {
      if (held.has(name.replace(/\.json$/u, ''))) continue
      try {
        const entry = JSON.parse(readFileSync(join(queueDir, name), 'utf8'))
        digests.add(kiraRecordContentSha256(entry.record))
      } catch { /* unreadable */ }
    }
    for (const name of readdirSync(declinedDir)) {
      try {
        const doc = JSON.parse(readFileSync(join(declinedDir, name), 'utf8'))
        if (digests.has(doc.proposalDigest) || digests.has(doc.contentDigest)) declined += 1
      } catch { /* unreadable */ }
    }
  }
  return { path: queueDir, entries: entries.length, settled, declined,
    pending: entries.length - settled - declined, source }
}

/** Three queries from the store's OWN settled text, so they are drawn from real topics rather than invented. */
export function queriesFrom(stateDir, count = 3) {
  const queries = []
  for (const name of readdirSync(join(stateDir, 'objects')).sort()) {
    const text = readFileSync(join(stateDir, 'objects', name), 'utf8')
    const note = /"(?:note|text|summary)"\s*:\s*"((?:[^"\\]|\\.){16,})"/u.exec(text)
    if (note === null) continue
    const words = note[1].replace(/\\[a-z]/gu, ' ').split(/\s+/u).filter(word => word.length > 3)
    if (words.length >= 3) queries.push(words.slice(0, 4).join(' '))
    if (queries.length >= count) break
  }
  while (queries.length < count) queries.push('a topic this store does not carry')
  return queries
}

/** Everything the probe prints, in one object, each value beside the file it came from. */
export async function probe({ stateDir, subject, queueDir, queries }) {
  preflight(stateDir)
  const resolvedSubject = subject ?? subjectOf(stateDir)
  const owner = createMemoryOwner({ stateDir })
  const policy = { subject: resolvedSubject, policyRevision: 'probe', permittedPrivacy: ['local'] }
  const readOwner = owner.createReadOwner(policy)
  const snapshot = await readOwner.read()
  const records = Array.isArray(snapshot?.records) ? snapshot.records : []
  const recall = createKiraRecallService(readOnlySurface(readOwner, policy))
  const cite = createCiteService({ stateDir, subject: resolvedSubject, permittedPrivacy: ['local'],
    createMemoryOwner: () => createMemoryOwner({ stateDir }) })

  const answered = []
  for (const question of queries) {
    const answer = await recall.recall(question)
    const rows = Array.isArray(answer?.records) ? answer.records : []
    const first = rows[0]
    const recordId = first?.citation?.recordId ?? first?.recordId
    let verdict
    if (recordId === undefined) {
      verdict = { recordId: null, verdict: 'NOT_RETURNED', reason: 'recall returned no record for this question',
        source: `${stateDir}/objects` }
    } else {
      try {
        const cited = await cite.cite(recordId)
        verdict = cited.verdict === CITE_VERIFIED
          ? { recordId, verdict: CITE_VERIFIED, auraSequence: cited.auraSequence, verifiedHead: cited.verifiedHead,
              source: `${stateDir}/aura.jsonl` }
          : { recordId, verdict: cited.verdict, reason: cited.reason, source: `${stateDir}/aura.jsonl` }
      } catch (error) {
        verdict = { recordId, verdict: 'REFUSED', reason: String(error?.message ?? error), source: `${stateDir}/aura.jsonl` }
      }
    }
    answered.push({ query: question, recall: {
      availability: answer?.availability ?? snapshot?.availability ?? null,
      status: answer?.status ?? null,
      returned: rows.length,
      recordIds: rows.map(row => row?.citation?.recordId ?? row?.recordId ?? null),
      source: `${stateDir}/objects`,
    }, cite: verdict })
  }

  return {
    store: {
      path: stateDir,
      source: `${stateDir}/aura.jsonl`,
      // THE SNAPSHOT CARRIES NO CHAIN LENGTH (measured: its keys are availability, subject, policyRevision,
      // projection and records), so the length is COUNTED from the chain file rather than asked for.
      chainEntries: countLines(join(stateDir, 'aura.jsonl')),
      objects: readdirSync(join(stateDir, 'objects')).filter(name => name.endsWith('.json')).length,
      projection: snapshot?.projection?.name ?? null,
      sourceOfHeads: `${stateDir}/objects`,
      settledHeads: records.length,
      availability: snapshot?.availability ?? null,
      head: records.at(-1)?.citation?.verifiedHead ?? null,
      subject: resolvedSubject,
    },
    queue: queueState(queueDir ?? join(stateDir, 'queue'), stateDir),
    queries: answered,
  }
}

/** Only `--state-dir` and the three named options are accepted: argv never silently carries a typo. */
export function parseArgs(argv) {
  const out = { json: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') { out.json = true; continue }
    const value = argv[i + 1]
    if (arg === '--state-dir' || arg === '--subject' || arg === '--queries' || arg === '--queue-dir') {
      if (value === undefined) throw new RecallProbeRefusal('usage', `${arg} needs a value`)
      if (arg === '--state-dir') out.stateDir = value
      if (arg === '--queue-dir') out.queueDir = value
      if (arg === '--subject') out.subject = value
      if (arg === '--queries') out.queries = value.split(';').map(part => part.trim()).filter(part => part !== '')
      i += 1
      continue
    }
    throw new RecallProbeRefusal('unknown-argument',
      `unknown argument ${arg}. Usage: recall-probe.mjs [--state-dir <path>] [--subject <aukora:1:hex>] `
      + '[--queue-dir <path>] [--queries "a;b;c"] [--json]')
  }
  return out
}

if (isMainModule(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2))
    const stateDir = preflight(args.stateDir ?? discoverStore())
    const report = await probe({
      stateDir,
      subject: args.subject,
      queueDir: args.queueDir,
      queries: args.queries ?? queriesFrom(stateDir),
    })
    if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    else {
      process.stdout.write(`store      : ${report.store.path}\n`)
      process.stdout.write(`             settled heads ${String(report.store.settledHeads)} of `
        + `${String(report.store.chainEntries)} chain entr(ies), ${String(report.store.objects)} object(s), `
        + `availability ${String(report.store.availability)}`
        + `  [${report.store.source}]\n`)
      process.stdout.write(`queue      : ${String(report.queue.pending)} pending, ${String(report.queue.settled)} `
        + `settled, ${String(report.queue.declined)} declined of ${String(report.queue.entries)}  [${report.queue.source}]\n`)
      for (const answer of report.queries) {
        process.stdout.write(`query      : ${answer.query}\n`)
        process.stdout.write(`  recall   : ${String(answer.recall.returned)} record(s) `
          + `${JSON.stringify(answer.recall.recordIds)}  [${answer.recall.source}]\n`)
        process.stdout.write(`  cite     : ${answer.cite.verdict}`
          + (answer.cite.auraSequence === undefined ? '' : ` at sequence ${String(answer.cite.auraSequence)}`)
          + (answer.cite.reason === undefined ? '' : ` — ${answer.cite.reason}`) + `  [${answer.cite.source}]\n`)
      }
    }
  } catch (error) {
    process.stderr.write(`${error instanceof RecallProbeRefusal ? `REFUSED: ${error.code}: ${error.message}`
      : `PROBE FAILED: ${String(error?.stack ?? error)}`}\n`)
    process.exit(error instanceof RecallProbeRefusal ? 2 : 3)
  }
}
