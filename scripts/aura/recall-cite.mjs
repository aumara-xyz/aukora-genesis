#!/usr/bin/env node
/**
 * recall-cite.mjs — A4's "recall with citation" leg, against whichever store the run names.
 *
 * WHY THIS EXISTS. The rehearsal's transit step recalls, but on its OWN disposable store. Nothing in
 * the runner recalled from the store the settlement had just written, so a live run would have proved
 * recall about a throwaway store while reporting a green leg — the same shape as the retain/export
 * legs before they were pointed at TARGET_STORE.
 *
 * WHY IT IS SAFE TO RUN AGAINST THE LIVE STORE. `createReadOwner(policy).read()` "spends nothing …
 * consults no grant, touches no nonce store, and cannot mutate" (memory-owner.mjs). Reading is the one
 * thing A4 asks for that needs no authorization, and this leg does only that.
 *
 * WHAT IT ASSERTS, so the leg is not decoration:
 *   1. the read reports `found` — `empty` and `undetermined` are different facts and both fail here,
 *      because a live run that settled a record must be able to cite it;
 *   2. a citation carries the fields A4 names: `auraSequence`, `contentSha256`, `verifiedHead`;
 *   3. the citation's `verifiedHead` is the store's own head — a citation pointing at some other head
 *      is a citation of something else.
 *
 * EXIT: 0 found and cited · 1 an assertion failed, named · 2 a refusal or bad usage.
 */
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

// THE CEILING PRINTS ON EVERY EXIT. This tool reports what the STORE said, and three things about that
// are worth stating rather than leaving to the reader: the citation is a POINTER whose content this
// tool does not itself verify, it is about ONE subject, and it is the same owner on one host.
const CEILINGS = [
  'CEILING: A_CITATION_IS_NOT_A_VERIFICATION — this reports what the store returned and the digest it named. It does not re-derive the content, so a citation is a pointer, not a proof about the bytes.',
  'CEILING: ONE_SUBJECT — the answer is about the one subject asked for, not about the store and not about any other row in it.',
  'CEILING: RETAINER_SAME_OWNER — same owner, one host. The store is read where it sits; nothing here is a second party agreeing.',
]
process.on('exit', () => { console.log(''); for (const line of CEILINGS) console.log(line) })

const ROOT = resolve(new URL('../..', import.meta.url).pathname)
const refuse = (code, message) => { throw Object.assign(new Error(message), { code }) }

const argv = process.argv.slice(2)
const option = (name) => {
  const i = argv.indexOf(name)
  if (i === -1) return undefined
  const value = argv[i + 1]
  if (value === undefined || value.startsWith('--')) refuse('usage', `${name} needs a value`)
  return value
}

const main = async () => {
  // VALIDATION LIVES INSIDE main, so a refusal reaches the handler below. At module top level a
  // throw is unhandled and prints a stack trace instead of a named refusal — MEASURED on the first
  // version of this file, and the same fault settle-approved.mjs had before it was wrapped.
  const state = option('--state')
  const subject = option('--subject')
  if (state === undefined || subject === undefined) refuse('usage', '--state <store> and --subject <aukora:1:hex> are required')
  if (!/^aukora:1:[0-9a-f]{64}$/.test(subject)) refuse('subject-grammar', `--subject must be aukora:1:<64 lowercase hex>, got ${subject}`)

  const { createMemoryOwner } = await import(pathToFileURL(resolve(ROOT, 'plugins/aukora-kira/lib/memory-owner.mjs')).href)
  const owner = createMemoryOwner({ stateDir: state })
  const policy = { subject, permittedPrivacy: ['local'] }
  const snapshot = await owner.createReadOwner(policy).read()

  const problems = []
  if (snapshot.availability !== 'found') {
    // `empty` and `undetermined` are named rather than collapsed: a live run that settled a record
    // must be able to cite it, and "I could not read the memory" is not "there is nothing matching".
    problems.push(`availability=${snapshot.availability}${snapshot.reason ? ` (${snapshot.reason})` : ''}`)
  }
  // MEASURED SHAPE: `records[i]` is `{record, text, citation}` and the citation is the inner object
  // carrying recordId, contentSha256, auraSequence, auraEntryHash and verifiedHead. A first version
  // read the WRAPPER as the citation and failed all three field checks against a healthy store.
  const citation = Array.isArray(snapshot.records) ? snapshot.records[0]?.citation : undefined
  if (citation === undefined) {
    problems.push('no citation was returned')
  } else {
    for (const field of ['auraSequence', 'contentSha256', 'verifiedHead']) {
      if (citation[field] === undefined) problems.push(`the citation carries no ${field}`)
    }
    const head = owner.head().head
    if (citation.verifiedHead !== undefined && citation.verifiedHead !== head) {
      problems.push(`the citation verifies against ${String(citation.verifiedHead).slice(0, 16)}… but the store head is ${String(head).slice(0, 16)}…`)
    }
  }

  if (problems.length > 0) {
    console.log(`RECALL: FAILED — ${problems.join('; ')}`)
    process.exitCode = 1
    return
  }
  // THE CITATION PRINTS contentSha256 IN FULL, because a citation is meant to be USED. It was
  // truncated to 16 hex characters plus an ellipsis, while the export names its record, receipt and
  // object files by the FULL digest — so a caller holding this line could not name the bytes it was
  // citing. MEASURED while aiming the stranger leg at "the record recall named": the lookup could not
  // be built from the citation at all, and the check went red for a reason of its own making.
  console.log(`RECALL: found — auraSequence ${citation.auraSequence}, contentSha256 ${citation.contentSha256}, verifiedHead ${String(citation.verifiedHead).slice(0, 16)}… (the store's own head)`)
}

try {
  await main()
} catch (error) {
  if (error?.code === undefined || typeof error.code !== 'string') throw error
  console.error(`REFUSED: ${error.code} — ${error.message}`)
  process.exit(2)
}
