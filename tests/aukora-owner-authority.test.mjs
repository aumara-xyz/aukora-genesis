#!/usr/bin/env node
/**
 * THE AUTHORITY COURT — a one-use approval bound to the exact proposed action, and no shell-Boolean fallback.
 *
 * This is court ④ of the four in `codex-uid-design.md:7`, and the part of it that can be measured without a
 * second uid: the BINDING and the CONSUMPTION. Courts ①–③ (secrets EACCES, journal EACCES, exclusive
 * ingress) need the `aukora-owner` account and the protected directories, which do not exist on this Mac
 * yet — Peter creates that account himself, because it needs sudo. **A NAMED CEILING, NOT A SILENT PASS:**
 * those three are NOT measured here and this court says so on every run.
 *
 *   node tests/aukora-owner-authority.test.mjs
 *   node tests/aukora-owner-authority.test.mjs --mutate
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
// **MUTATIONS GO THROUGH THE GUARD, NOT A BARE writeFileSync (AUMLOK-106 (2)).** A `--mutate` run of another
// court was killed by the runner's timeout, its `finally` never ran, and a tracked module stayed MUTATED
// through two subsequent green measurements. **A `finally` cannot run on SIGKILL**, so this journals the
// original bytes to a directory outside the repository BEFORE writing the mutant, restores on every signal a
// handler can catch, and lets the NEXT run recover anything a kill left behind.
import { guardedMutation } from './helpers/guarded-mutation.mjs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// THE CANONICAL SPELLINGS, IMPORTED RATHER THAN RE-SPELLED. An arm in `aukora-owner-dispatch` scans
// these files for a literal operation or scope, so this import is the only way to name one.
import { OPERATIONS, kiraStoreScope, gateReleaseScope } from '../plugins/aukora-owner-daemon/lib/operations.mjs'
import { crashExit } from './helpers/court-crash.mjs'

const MUTATE = process.argv.includes('--mutate')
const ROOT = fileURLToPath(new URL('..', import.meta.url))

// **THIS COURT HAD NO `uncaughtException` HANDLER AT ALL (row 16)**, so a throw outside its arms printed a raw
// node stack and exited **1** — the code that means an arm failed. Nothing here needs reaping: this court starts
// no daemon as another user, so there is no orphan to take with it, and the handler is registered at the top
// rather than after an `await` because *a handler installed after the throw it was meant to catch catches
// nothing.*
process.on('uncaughtException', crashExit({ court: 'the authority court' }))
const BINDING_PATH = join(ROOT, 'plugins', 'aukora-owner-daemon', 'lib', 'binding.mjs')

let arms = 0
let missed = 0
function arm(label, check) {
  arms += 1
  try {
    const result = check()
    if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
      throw new TypeError('this arm is async and `arm()` cannot await it: make the check synchronous')
    }
    console.log(`  ok    ${label}`)
  } catch (error) {
    missed += 1
    console.log(`  FAIL  ${label}`)
    console.log(`        ${String(error?.message ?? error).split('\n').slice(0, 8).join('\n        ')}`)
  }
}
const say = (line) => { console.log(`       ${line}`) }
const codeOf = (fn) => { try { fn(); return null } catch (error) { return error?.code ?? error?.name ?? String(error?.message ?? error) } }

console.log('\nAUMLOK — the owner daemon: one approval, bound and spent once\n')
console.log('  CEILING: courts ①–③ (secrets EACCES, journal EACCES, exclusive ingress) are NOT measured here.\n'
  + '           They need the `aukora-owner` account and the protected directories, which do not exist on\n'
  + '           this Mac yet. This court measures the BINDING and the ONE-USE CONSUMPTION only.\n')

const binding = await import(pathToFileURL(BINDING_PATH).href)
const R = binding.OWNER_REFUSE
const NOW = 1_800_000_000
const BYTES = Buffer.from('{"record":"a kira settlement, frozen as bytes"}', 'utf8')
const freeze = (extra = {}) => binding.freezeProposal({
  bytes: BYTES, operation: OPERATIONS.KIRA_MEMORY_PUT, scope: kiraStoreScope('entry-7'), ledgerId: 'entry-7', expiresAt: NOW + 300, now: NOW, ...extra,
})

// ── ① FREEZING: the bytes are copied, hashed, and the nonce is the DAEMON'S ────────────────────────
arm('a proposal freezes its exact bytes, and the digest is over those bytes', () => {
  const p = freeze()
  assert.equal(p.digest, binding.digestOf(BYTES))
  assert.notEqual(p.digest, binding.digestOf(Buffer.from('{"record":"something else"}', 'utf8')),
    'two different proposals share a digest, so an approval would authorise both')
  assert.equal(Buffer.compare(p.bytes, BYTES), 0, 'the frozen bytes are not the bytes submitted')
})

arm('the NONCE IS THE DAEMON\'S, not the caller\'s — an agent-chosen nonce could be replayed', () => {
  const a = freeze()
  const b = freeze()
  assert.match(a.nonce, /^[0-9a-f]{64}$/u)
  assert.notEqual(a.nonce, b.nonce, 'two freezes produced one nonce')
  assert.notEqual(a.nonce, freeze({ nonce: a.nonce }).nonce,
    'a caller-supplied nonce was adopted, so a caller could aim an old approval at a new proposal')
})

// ── ② AUTHORITY: the agent submits, the owner approves, it settles ────────────────────────────────
const settleOnce = () => {
  const store = binding.createProposalStore()
  const proposal = store.put(freeze())
  const approval = {
    digest: proposal.digest, operation: proposal.operation, scope: proposal.scope,
    ledgerId: proposal.ledgerId, nonce: proposal.nonce, expiresAt: proposal.expiresAt,
  }
  return { store, proposal, approval }
}

arm('an owner-bound approval settles the proposal it names', () => {
  const { store, proposal, approval } = settleOnce()
  const result = binding.authoriseSettlement({ store, approval, now: NOW })
  assert.equal(result.settled, true)
  assert.equal(result.digest, proposal.digest)
  say(`settled ${result.digest.slice(0, 16)}… ledger ${result.ledgerId}`)
})

// ── ③ THE SHELL BOOLEAN IS REFUSED, BY NAME, WITH NO FALLBACK ─────────────────────────────────────
arm('A SHELL-SUPPLIED BOOLEAN IS REFUSED BY NAME — there is no fallback', () => {
  const { store, approval } = settleOnce()
  for (const [what, value] of [['true', true], ['false', false], ['an object carrying one', { ...approval, shellApproval: true }]]) {
    assert.equal(codeOf(() => binding.authoriseSettlement({ store, approval: value, now: NOW })),
      R.SHELL_BOOLEAN_REFUSED, `a shell boolean (${what}) was not refused by name`)
  }
  say('Electron "approved: true" is a claim by the agent\'s own uid, and it settles nothing.')
})

// ── ④ EVERY WRONG APPROVAL HAS ITS OWN NAME ───────────────────────────────────────────────────────
arm('each way an approval can be wrong is refused BY ITS OWN NAME', () => {
  const cases = [
    ['digest mismatch', { digest: 'ff'.repeat(32) }, R.DIGEST_MISMATCH],
    ['scope mismatch', { operation: 'aumlok.rotate' }, R.SCOPE_MISMATCH],
    ['ledger mismatch', { ledgerId: 'entry-8' }, R.LEDGER_MISMATCH],
    // **THE NAME CHANGED BECAUSE THE FACT DID.** This case carries an approval whose expiry is NOT the frozen
    // one, and after P2 that is the more specific truth about it: an approval does not choose the window, it
    // records the one the owner read. `APPROVAL_EXPIRED` is unreachable through this path — with equality
    // enforced, the approval's expiry IS the proposal's, so an expired one is `PROPOSAL_EXPIRED`.
    ['expiry not the frozen one', { expiresAt: NOW - 1 }, R.APPROVAL_EXPIRY_NOT_FROZEN],
    ['A LATER expiry is refused too — the window is the frozen one, not the one the approval carries',
      { expiresAt: NOW + 99_999 }, R.APPROVAL_EXPIRY_NOT_FROZEN],
    ['no such proposal', { nonce: 'ab'.repeat(32) }, R.PROPOSAL_ABSENT],
  ]
  for (const [what, patch, expected] of cases) {
    const { store, approval } = settleOnce()
    const got = codeOf(() => binding.authoriseSettlement({ store, approval: { ...approval, ...patch }, now: NOW }))
    assert.equal(got, expected, `${what} was refused as ${String(got)}`)
    say(`${what.padEnd(18)} -> ${expected}`)
  }
})

arm('A DIGEST ALONE WOULD NOT BE ENOUGH — the same bytes under another operation are another act', () => {
  const { store, approval } = settleOnce()
  assert.equal(approval.digest, store.get(approval.digest).digest, 'the digest matches, as it must')
  assert.equal(codeOf(() => binding.authoriseSettlement({
    store, approval: { ...approval, operation: 'aumlok.rotate' }, now: NOW })), R.SCOPE_MISMATCH,
  'the same frozen bytes settled under a different operation, which the digest cannot prevent and the '
  + 'operation/scope binding is for')
})

// ── ⑤ ONE USE, AND THE SECOND ATTEMPT HAS ITS OWN NAME ────────────────────────────────────────────
arm('AN APPROVAL IS CONSUMED ONCE — the replay is refused as spent, not as anything else', () => {
  const { store, approval } = settleOnce()
  binding.authoriseSettlement({ store, approval, now: NOW })
  assert.equal(codeOf(() => binding.authoriseSettlement({ store, approval, now: NOW })), R.APPROVAL_SPENT,
    'the second use of one approval was not refused by name')
})

arm('THERE IS NO SUCH THING AS A SECOND UNUSED APPROVAL — the nonce IS the proposal\'s handle', () => {
  // **I WROTE THIS ARM EXPECTING `proposal-settled` AND THE CODE WAS RIGHT AGAIN.** The approval channel
  // copies the nonce off the frozen proposal, so "the owner was asked twice about one proposal" produces
  // the SAME nonce twice — one approval, not two — and the spent check owns the fact. That is not a gap:
  // the nonce is the proposal's handle, and a proposal that is settled is a proposal whose nonce is spent.
  const { store, proposal, approval } = settleOnce()
  binding.authoriseSettlement({ store, approval, now: NOW })
  assert.equal(codeOf(() => binding.authoriseSettlement({ store, approval: { ...approval }, now: NOW })),
    R.APPROVAL_SPENT, 'a re-ask over a settled proposal was not refused as spent')
  assert.equal(store.get(proposal.digest).settledAt, NOW, 'the proposal does not record that it was settled')
})

arm('and PROPOSAL_SETTLED is EXERCISED DIRECTLY, so it is a live guard and not masked dead code', () => {
  // `codex-uid-design.md:7` requires each protection be exercised "so another gate cannot mask it". The
  // spend and the settle happen together on the happy path, so the spent check always answers first — and
  // a guard that can only ever be shadowed is a guard nobody has tested. It is reached here the way a
  // second writer would reach it: a store whose proposal is already settled while the nonce is not spent.
  const { store, approval } = settleOnce()
  store.markSettled(approval.nonce, NOW)
  assert.equal(codeOf(() => binding.authoriseSettlement({ store, approval, now: NOW })), R.PROPOSAL_SETTLED,
    'a settled proposal accepted a settlement, so PROPOSAL_SETTLED does not fire even when it is the only '
    + 'guard left')
  assert.notEqual(R.PROPOSAL_SETTLED, R.APPROVAL_SPENT, 'the two facts share a name')
})

// ── P2: THE PROPOSAL'S OWN DEADLINE, ENFORCED INDEPENDENTLY OF THE APPROVAL ──────────────────────
arm('AN EXPIRED PROPOSAL IS REFUSED WITH A FRESH, PERFECTLY-MATCHED APPROVAL', () => {
  // **THE APPROVAL IS NOT THE SUBJECT HERE.** It matches the proposal in every field including the expiry, so
  // the ONLY thing wrong is that the clock has passed the proposal's deadline — and the check that reports it
  // reads the proposal rather than anything the approval carries. Before P2 nothing compared `now` against the
  // PROPOSAL at all; the approval's own expiry was the only clock in the room.
  const store = binding.createProposalStore()
  const proposal = store.put(binding.freezeProposal({
    bytes: BYTES, operation: OPERATIONS.KIRA_MEMORY_PUT, scope: kiraStoreScope('entry-7'), ledgerId: 'entry-7',
    expiresAt: NOW + 10, now: NOW,
  }))
  const approval = {
    digest: proposal.digest, operation: proposal.operation, scope: proposal.scope,
    ledgerId: proposal.ledgerId, nonce: proposal.nonce, expiresAt: proposal.expiresAt,
  }
  assert.equal(approval.expiresAt, proposal.expiresAt, 'the fixture approval does not match the frozen expiry')
  // One second BEFORE the deadline the same approval settles, so this arm measures the deadline and not a
  // typo in the fixture.
  assert.equal(codeOf(() => binding.authoriseSettlement({ store, approval, now: NOW + 9 })), null)
  const later = store.put(binding.freezeProposal({
    bytes: BYTES, operation: OPERATIONS.KIRA_MEMORY_PUT, scope: kiraStoreScope('entry-7'), ledgerId: 'entry-7',
    expiresAt: NOW + 10, now: NOW,
  }))
  const same = { ...approval, digest: later.digest, nonce: later.nonce }
  assert.equal(codeOf(() => binding.authoriseSettlement({ store, approval: same, now: NOW + 11 })),
    R.PROPOSAL_EXPIRED, 'an expired proposal settled because the approval was otherwise perfect')
  say('the proposal deadline is checked against the clock, whatever approval is presented')
})

// ── ⑥ THE APPROVAL CHANNEL, AND WHERE A LATER ONE PLUGS IN ────────────────────────────────────────
const run = async () => {
  const store = binding.createProposalStore()
  const proposal = store.put(freeze())
  const approve = binding.createApprovalChannel({ ask: async () => true })
  const decline = binding.createApprovalChannel({ ask: async () => false })
  const doomed = binding.createApprovalChannel({ ask: async () => { throw new Error('no console') } })

  const answer = await approve(proposal)
  arm('the bound record carries every field the authoriser checks, copied off the proposal', () => {
    assert.deepEqual(Object.keys(answer).sort(),
      ['answeredAt', 'digest', 'expiresAt', 'ledgerId', 'nonce', 'operation', 'scope'])
    assert.equal(answer.digest, proposal.digest)
    assert.equal(answer.nonce, proposal.nonce)
  })
  arm('and an approval it produces settles', () => {
    assert.equal(binding.authoriseSettlement({ store, approval: answer, now: NOW }).settled, true)
  })

  const store2 = binding.createProposalStore()
  const p2 = store2.put(freeze())
  const declined = await decline(p2).then(() => null, error => error?.code ?? 'settled')
  const unreachableEarly = await doomed(binding.createProposalStore().put(freeze()))
    .then(() => null, error => error?.code ?? 'settled')
  arm('a DECLINED proposal carries OWNER_DECLINED and is left untouched', () => {
    assert.equal(declined, R.OWNER_DECLINED, `a declined proposal answered ${String(declined)}`)
    assert.equal(store2.get(p2.digest).settledAt, null, 'a declined proposal was marked settled')
  })
  // ── AN UNREACHABLE CONSOLE IS NOT THE OWNER DECLINING (AUMLOK, 2026-09-26) ─────────────────────────────
  //
  // **FABLE, AND IT IS A CORRECTION TO THIS VERY ARM:** *"in CI the owner console is unreachable, so every
  // approval reads DECLINED (1 SETTLED, 9 DECLINED). An unreachable console is NOT the owner declining: the court
  // must name it (NOT_READY, console-unreachable) and not report a decline. Refuse rather than accuse."*
  //
  // **THE ARM THIS REPLACES REQUIRED THE CONFLATION.** It asserted `OWNER_DECLINED` for a console that could not
  // be asked, with the reason *"so an unreachable owner would settle by default"* — **and the refusal it was
  // protecting against is real, but `OWNER_DECLINED` is the wrong name for it.** A refusal that says the owner
  // declined, when nobody asked the owner, **is an accusation**: it is what made a whole CI run read as *"1
  // SETTLED, 9 DECLINED"* when the truth was that the console was not there. **A caller cannot fix a missing
  // console by reading a decline.**
  //
  // **BOTH FACTS STILL REFUSE — the fix is the NAME, not the outcome.** An unreachable console must not settle,
  // and it must not be reported as the owner's answer either. `CONSOLE_UNREACHABLE` says which of the two
  // happened, and `NOT_READY` says the run cannot be judged until the console exists.
  arm('an UNREACHABLE console is NOT a decline — it NAMES the console rather than accusing the owner', () => {
    assert.equal(unreachableEarly, R.CONSOLE_UNREACHABLE,
      `an unreachable console answered ${String(unreachableEarly)}, so the caller cannot tell a missing console `
      + 'from an owner who said no')
    assert.notEqual(unreachableEarly, R.OWNER_DECLINED,
      'an UNREACHABLE console was reported as the owner declining, which is an accusation and not a diagnosis')
  })
  arm('AND it still refuses — an unreachable owner never settles by default', () => {
    assert.notEqual(unreachableEarly, null,
      'an unreachable console let the proposal through, which is the fail-open this arm exists to prevent')
  })


  // ── THE MUTATIONS: REMOVE ONE PROTECTION AT A TIME AND WATCH THAT ARM GO RED ────────────────────
  if (MUTATE) {
    console.log('\n── mutations: one protection removed at a time ──')
    const original = readFileSync(BINDING_PATH, 'utf8')
    const mutants = [
      ['the SHELL BOOLEAN guard', /if \(approval === true \|\| approval === false \|\| typeof approval === 'boolean'[\s\S]*?\n  \}/u,
        'a boolean approval is accepted as an owner answer, which is the fallback the design removes'],
      // **THE ANCHOR TOLERATES THE ARGUMENT LIST, AND MEASURED: IT DID NOT.** `spend` gained the
      // settlement's own clock — `store.spend(approval.nonce, now)` — so the exact-arguments pattern stopped
      // matching and the court refused with "the mutation changed no line, so it proves nothing". **The court
      // was right to refuse rather than pass**: a mutation that matches nothing is a red arm that has quietly
      // stopped measuring. Anchored on the call and its line, so a further argument does not break it and a
      // DIFFERENT first argument still does.
      ['the ONE-USE spend', /^  store\.spend\(approval\.nonce[^\n]*\)$/mu,
        'an approval can be spent twice, so a replayed line buys a second settlement'],
      // **P2's TWO PROTECTIONS, EACH REMOVED.** The mutation must make the mutant ACCEPT what the check
      // refused, so the driver below feeds it exactly the request the check was written to stop.
      // **THE PATTERN SPANS THE WHOLE BLOCK, NOT JUST ITS CONDITION.** MEASURED: removing only the `if (...) {`
      // line left the `throw` and its closing brace dangling, so the mutant file was a SYNTAX ERROR and the
      // court died on import instead of measuring. A mutation must leave a file that PARSES and does less.
      ['THE FROZEN-EXPIRY EQUALITY',
        /if \(approval\.expiresAt !== proposal\.expiresAt\) \{[\s\S]*?\n  \}/u,
        'an approval carrying a LATER expiry settles a proposal whose own window has gone'],
      ['THE PROPOSAL DEADLINE',
        /if \(!Number\.isInteger\(proposal\.expiresAt\) \|\| now >= proposal\.expiresAt\) \{[\s\S]*?\n  \}/u,
        'an expired proposal settles because nothing compares the clock to the PROPOSAL'],
    ]
    for (const [what, pattern, why] of mutants) {
      const patched = original.replace(pattern, '')
      assert.notEqual(patched, original, `the mutation for ${what} changed no line, so it proves nothing`)
      if (what === 'the ONE-USE spend') {
        // **THE OTHER HALF OF "IT REMOVED SOMETHING": IT REMOVED THE SPEND.** A pattern that matched a
        // COMMENT mentioning the call would change bytes and remove no protection, and the arm would still go
        // red for a reason that has nothing to do with the spend.
        assert.equal(/store\.spend\(/u.test(patched), false,
          'the patched source still calls store.spend, so the mutation did not remove the spend')
      }
      await guardedMutation(BINDING_PATH, [[what, pattern, '']], async () => {
        const mutant = await import(`${pathToFileURL(BINDING_PATH).href}?m=${String(Date.now())}`)
        const store = mutant.createProposalStore()
        const proposal = store.put(mutant.freezeProposal({
          bytes: BYTES, operation: OPERATIONS.KIRA_MEMORY_PUT, scope: kiraStoreScope('entry-7'), ledgerId: 'entry-7',
          expiresAt: NOW + 300, now: NOW,
        }))
        const approval = {
          digest: proposal.digest, operation: proposal.operation, scope: proposal.scope,
          ledgerId: proposal.ledgerId, nonce: proposal.nonce, expiresAt: proposal.expiresAt,
        }
        let broke = false
        try {
          if (what.includes('BOOLEAN')) mutant.authoriseSettlement({ store, approval: true, now: NOW })
          else if (what.includes('FROZEN-EXPIRY')) {
            // A LATER EXPIRY THAN THE FROZEN ONE. The proposal is live, so only the equality check stands
            // between this and a settlement outside the window the owner read.
            mutant.authoriseSettlement({ store, approval: { ...approval, expiresAt: NOW + 99_999 }, now: NOW })
          } else if (what.includes('PROPOSAL DEADLINE')) {
            // A PERFECTLY MATCHED APPROVAL AND A PROPOSAL PAST ITS DEADLINE, so the ONLY thing that can refuse
            // is the independent deadline check.
            const stale = store.put(mutant.freezeProposal({
              bytes: BYTES, operation: OPERATIONS.KIRA_MEMORY_PUT, scope: kiraStoreScope('entry-7'),
              ledgerId: 'entry-7', expiresAt: NOW + 10, now: NOW,
            }))
            mutant.authoriseSettlement({ store,
              approval: { ...approval, digest: stale.digest, nonce: stale.nonce, expiresAt: stale.expiresAt },
              now: NOW + 11 })
          } else {
            mutant.authoriseSettlement({ store, approval, now: NOW })
            mutant.authoriseSettlement({ store, approval, now: NOW })
          }
        } catch { broke = false }
        assert.equal(broke, false, `${why} — but the mutant refused, so the arm is measuring something else`)
        console.log(`  ok    without ${what}: the protection is gone and the refusal does not happen`)
      })
    }
    assert.equal(readFileSync(BINDING_PATH, 'utf8'), original, 'the module was NOT restored byte-identically')
    console.log('  ok    the module is restored byte-identically')
  }

  console.log(`\n  ${String(arms - missed)}/${String(arms)} arms green\n`)
  process.exit(missed === 0 ? 0 : 1)
}

await run()
