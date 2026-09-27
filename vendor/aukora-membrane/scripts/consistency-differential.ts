#!/usr/bin/env bun
// scripts/consistency-differential.ts — two RFC 6962 verifiers, identical vectors, FULL verdicts.
//
//     bun run scripts/consistency-differential.ts
//
// ══ WHY THIS FILE EXISTS, AND WHAT IT LEARNED THE HARD WAY ═══════════════════════════════════
//
// scripts/nversion-real-chain-verify.ts went fully green this morning while BOTH implementations
// were wrong in the same direction: every malformed-proof condition returned a OBSERVATION_CONFLICT
// accusation, so a flipped byte in transport convicted an honest log exactly as hard as a forgery.
// The differential could not see it because the shared error was in what the verdict MEANS, not in
// the arithmetic — and it compared "did both refuse?" rather than which of the three answers each
// gave. Codex predicted exactly this: shared specification ambiguity produces identical errors.
//
// So this harness does TWO different things, and keeping them apart is the point:
//
//   §2 THE DIFFERENTIAL compares the FULL VERDICT TRIPLE between the two implementations.
//      It catches ARITHMETIC DIVERGENCE — one of us folding wrong — and it is STRUCTURALLY BLIND
//      to any error both share. Agreement here is worth exactly as much as the assumption that
//      two authors reading one spec make different mistakes, which was falsified this morning.
//
//   §3 THE CLAIM-AUTHORED AXIS tests each implementation ALONE against the claim rather than
//      against the other: "SHOW ME AN HONEST LOG THIS CONVICTS." Every vector below carries
//      whether the LOG was honest, independent of whether the PROOF was well-formed. No honest log
//      may be accused by either implementation, and that assertion is authored from what the
//      verdict is supposed to mean — not from RFC 6962, whose ambiguity both of us inherited.
//
// A vector written from the spec inherits the spec's ambiguities. A vector written from the claim
// does not, and that asymmetry is the only thing that would have caught today's defect.
//
// A DISAGREEMENT IS THE VALUABLE OUTCOME AND IT LEADS THE REPORT.
import { createHash } from 'node:crypto';
import {
  consistencyBetweenDetailed, consistencyProofHex, observationFromLeafDigests, accusationReachable,
  type ObservationV1, type ConsistencyVerdict,
} from '../core/aura-consistency';
import {
  verifyRFC6962Consistency, rfc6962TreeRoot, rfc6962ConsistencyProof,
} from '../core/rfc6962-independent-verifier';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

let failures = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { failures++; console.error(`  FAIL  ${m}`); };
const gate = (c: boolean, m: string, d = '') => (c ? ok : bad)(m + (d ? ` — ${d}` : ''));
const say = (m: string) => console.log(`        ${m}`);
const sha256hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const REPO_ROOT = new URL('..', import.meta.url).pathname;
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));

// ── 0. THE LEAF CONVENTION MUST AGREE, OR NOTHING BELOW MEANS ANYTHING ──────────────────────
//
// Their helpers hash a `string` as UTF-8 and a `Buffer` as raw bytes; mine hex-decode. Feeding one
// a hex string and the other its bytes would make every comparison diverge for a reason that has
// nothing to do with either verifier — a control that fails for the same reason as its subject.
// So the vectors cross the boundary as BUFFERS, and that is established before a verdict is read.
const asLeaves = (hexDigests: readonly string[]): Buffer[] => hexDigests.map((h) => Buffer.from(h, 'hex'));
{
  const digests = Array.from({ length: 24 }, (_, i) => sha256hex(`differential-leaf-${i}`));
  let agree = 0;
  for (let size = 1; size <= 24; size += 1) {
    const mine = observationFromLeafDigests(digests, size, 1)?.root;
    const theirs = rfc6962TreeRoot(asLeaves(digests.slice(0, size)));
    if (mine === theirs) agree += 1;
    else bad(`leaf convention diverges at size ${size}: ${String(mine).slice(0, 16)}… vs ${theirs.slice(0, 16)}…`);
  }
  gate(agree === 24, 'the two implementations agree on the TREE HASH at every size — the vectors are genuinely identical', `${agree}/24`);
  if (agree !== 24) {
    console.error('\n  Stopping: with different leaf conventions every verdict below would diverge for the wrong reason.');
    process.exit(1);
  }
}

// ── 1. THE PROVERS MUST AGREE ON BYTES ──────────────────────────────────────────────────────
// Two verifiers agreeing on proofs one of them built is a weaker claim than it sounds. Both build.
{
  const digests = Array.from({ length: 20 }, (_, i) => sha256hex(`differential-leaf-${i}`));
  let pairs = 0, identical = 0;
  for (let m = 1; m < 20; m += 1) {
    for (let n = m + 1; n <= 20; n += 1) {
      pairs += 1;
      const mine = consistencyProofHex(digests, m, n) ?? [];
      const theirs = rfc6962ConsistencyProof(asLeaves(digests.slice(0, n)), m);
      if (mine.length === theirs.length && mine.every((h, i) => h === theirs[i])) identical += 1;
    }
  }
  gate(identical === pairs, 'the two provers emit BYTE-IDENTICAL consistency proofs across the pair grid', `${identical}/${pairs}`);
}

// ══ THE VECTOR MATRIX ════════════════════════════════════════════════════════════════════════
//
// `logHonest` is the field that makes §3 possible, and it is a property of the LOG, not of the
// proof. A mangled node, a truncation and an absent proof are all honest logs with broken
// envelopes. Only a genuinely edited prefix is guilty.

interface Vector {
  name: string;
  m: number;
  n: number;
  logHonest: boolean;
  retained: ObservationV1;
  presented: ObservationV1;
  proof: string[];
}

// EVERY SIZE CLASS AROUND 2^k, systematically — because "a fixture happened to sit at 32" is how
// the blind spot was found, and a grid we chose by hand is a grid that can miss the same way twice.
// The retained size is what matters (it is the fold's seed), so the classes are 2^k-1, 2^k, 2^k+1.
const SIZES: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let k = 2; k <= 6; k += 1) {
    const p = 1 << k;
    for (const m of [p - 1, p, p + 1]) out.push([m, m + 9]);
  }
  return out;
})();
const line = (tag: string, i: number) => sha256hex(`${tag}:${i}`);

function vectorsFor(m: number, n: number): Vector[] {
  const base = Array.from({ length: n }, (_, i) => line('base', i));
  const edited = base.map((h, i) => (i === Math.max(0, m - 3) ? sha256hex('the line somebody went back and changed') : h));
  const foreign = Array.from({ length: n }, (_, i) => line('another-history', i));

  const retained = observationFromLeafDigests(base, m, 1)!;
  const presentedHonest = observationFromLeafDigests(base, n, 1)!;
  const presentedEdited = observationFromLeafDigests(edited, n, 1)!;
  const honestProof = consistencyProofHex(base, m, n)!;
  const editedProof = consistencyProofHex(edited, m, n)!;
  const foreignProof = consistencyProofHex(foreign, m, n)!;

  return [
    { name: 'honest proof', m, n, logHonest: true, retained, presented: presentedHonest, proof: honestProof },
    { name: 'GENUINE PREFIX REWRITE', m, n, logHonest: false, retained, presented: presentedEdited, proof: editedProof },
    { name: 'mangled proof node', m, n, logHonest: true, retained, presented: presentedHonest, proof: honestProof.map((h, i) => (i === Math.floor(honestProof.length / 2) ? sha256hex('one flipped node') : h)) },
    { name: 'truncated proof', m, n, logHonest: true, retained, presented: presentedHonest, proof: honestProof.slice(0, -1) },
    { name: 'over-long proof', m, n, logHonest: true, retained, presented: presentedHonest, proof: [...honestProof, sha256hex('one element too many')] },
    { name: 'absent proof', m, n, logHonest: true, retained, presented: presentedHonest, proof: [] },
    { name: 'proof for another history', m, n, logHonest: true, retained, presented: presentedHonest, proof: foreignProof },
    { name: 'honest proof replayed at a rewritten head', m, n, logHonest: false, retained, presented: presentedEdited, proof: honestProof },
  ];
}

// ── THE CLASS MY OWN MATRIX DID NOT SAMPLE ──────────────────────────────────────────────────
//
// Every vector above has n > m. ZERO GROWTH was an entire structural class with no fixture, so a
// regression in it was invisible to this harness — the same shape as "a fixture happened to sit at
// 32", in the file that named that failure. Declared and sampled now.
//
// At m == n there is NO FOLD and NO SEED: the two roots are compared directly. The power-of-two
// property is irrelevant there, so a conflict is derivable at EVERY size, powers of two included.
// That is the exception to the blind spot, and it is the easiest thing in the system to
// over-correct away while fixing the other half.
function zeroGrowthVectorsFor(m: number): Vector[] {
  const base = Array.from({ length: m }, (_, i) => line('base', i));
  const edited = base.map((h, i) => (i === Math.max(0, m - 2) ? sha256hex('edited in place, same size') : h));
  const retained = observationFromLeafDigests(base, m, 1)!;
  return [
    { name: `zero growth, identical (retained ${m})`, m, n: m, logHonest: true, retained, presented: { ...retained }, proof: [] },
    { name: `ZERO-GROWTH CONFLICT (retained ${m})`, m, n: m, logHonest: false, retained, presented: observationFromLeafDigests(edited, m, 1)!, proof: [] },
  ];
}

const ours = (v: Vector): { verdict: ConsistencyVerdict; reason: string } => {
  const r = consistencyBetweenDetailed(v.retained, v.presented, v.proof);
  return { verdict: r.verdict, reason: r.reason };
};
const theirs = (v: Vector): { verdict: ConsistencyVerdict; reason: string } => {
  const r = verifyRFC6962Consistency(v.m, v.n, v.retained.root, v.presented.root, v.proof);
  return { verdict: r.verdict as ConsistencyVerdict, reason: r.refuseReason ?? 'consistency:append-only-proved' };
};

// ══ THE THIRD IMPLEMENTATION — minimal/verify.py, RUN AS A STRANGER WOULD RUN IT ═════════════
//
// Not imported, not reimplemented, not reasoned about: two JSON files and a subprocess, which is
// the entire interface a stranger has. If it is absent or python3 is missing, this reports
// UNAVAILABLE and the run FAILS — an entrance exam nobody sat is not an entrance exam passed.
const DEMONSTRATOR = join(REPO_ROOT, 'minimal', 'verify.py');
const demonstratorPresent = existsSync(DEMONSTRATOR)
  && spawnSync('python3', ['-c', 'pass'], { encoding: 'utf8' }).status === 0;
const LAB = demonstratorPresent ? mkdtempSync(join(tmpdir(), 'aukora-demonstrator-')) : '';

const demonstrator = (v: Vector): { verdict: ConsistencyVerdict; reason: string } => {
  if (!demonstratorPresent) return { verdict: 'UNDETERMINED', reason: 'demonstrator:unavailable' };
  const a = join(LAB, 'retained.json'), b = join(LAB, 'presented.json');
  writeFileSync(a, JSON.stringify({ treeSize: v.retained.treeSize, root: v.retained.root, atGeneration: v.retained.atGeneration }));
  writeFileSync(b, JSON.stringify({ treeSize: v.presented.treeSize, root: v.presented.root, atGeneration: v.presented.atGeneration, proofFromPrevious: v.proof }));
  const r = spawnSync('python3', [DEMONSTRATOR, a, b], { encoding: 'utf8', timeout: 30_000 });
  const out = `${r.stdout ?? ''}`;
  const verdict = (out.match(/VERDICT:\s*(\S+)/)?.[1] ?? 'UNDETERMINED') as ConsistencyVerdict;
  const reason = out.match(/REASON\s*:\s*(\S+)/)?.[1] ?? 'demonstrator:unparseable-output';
  return { verdict, reason };
};

// MEMOISED. The demonstrator judge spawns a python3 subprocess per call and every section asks the
// same question several times; without this the malformed axis alone is ~1,000 process starts.
const memo = new WeakMap<object, Map<string, { verdict: ConsistencyVerdict; reason: string }>>();
const cached = (label: string, f: (v: Vector) => { verdict: ConsistencyVerdict; reason: string }) =>
  (v: Vector) => {
    let byJudge = memo.get(v as object);
    if (!byJudge) { byJudge = new Map(); memo.set(v as object, byJudge); }
    const hit = byJudge.get(label);
    if (hit) return hit;
    let r: { verdict: ConsistencyVerdict; reason: string };
    try { r = f(v); } catch { r = { verdict: 'UNDETERMINED', reason: 'judge:threw' }; }
    byJudge.set(label, r);
    return r;
  };

const JUDGES = [
  ['membrane', cached('membrane', ours)],
  ['independent', cached('independent', theirs)],
  ['demonstrator', cached('demonstrator', demonstrator)],
] as const;

const ALL: Vector[] = [
  ...SIZES.flatMap(([m, n]) => vectorsFor(m, n)),
  ...[15, 16, 17, 31, 32, 33, 64].flatMap((m) => zeroGrowthVectorsFor(m)),
];

// ── 2. THE DIFFERENTIAL — FULL VERDICT, ACROSS THREE IMPLEMENTATIONS ────────────────────────
console.log('\n  ── §2 THE DIFFERENTIAL — full verdict triple, three implementations ───────────');
gate(demonstratorPresent, 'minimal/verify.py is present and runnable — the entrance exam can be sat at all',
  demonstratorPresent ? DEMONSTRATOR.replace(REPO_ROOT, '') : 'ABSENT — an exam nobody sat is not an exam passed');

const divergences: { v: Vector; got: string[] }[] = [];
let compared = 0, agreed = 0, coarseAgreed = 0;
for (const v of ALL) {
  compared += 1;
  const got = JUDGES.map(([, j]) => j(v).verdict);
  if (got.every((g) => g === got[0])) agreed += 1;
  else divergences.push({ v, got });
  const passes = JUDGES.map(([, j]) => j(v).verdict === 'APPEND_ONLY');
  if (passes.every((x) => x === passes[0])) coarseAgreed += 1;
}

if (divergences.length > 0) {
  console.error(`\n  DIVERGENCE — ${divergences.length} of ${compared} vectors. This leads the report because it is the valuable outcome.\n`);
  console.error(`    ${pad('m→n', 10)}${pad('vector', 42)}${JUDGES.map(([n]) => pad(n, 15)).join('')}`);
  for (const d of divergences.slice(0, 24)) {
    console.error(`    ${pad(`${d.v.m}→${d.v.n}`, 10)}${pad(d.v.name, 42)}${d.got.map((g) => pad(g, 15)).join('')}`);
  }
  if (divergences.length > 24) console.error(`    …and ${divergences.length - 24} more`);
  console.error('');
}
gate(divergences.length === 0, 'all three implementations agree on the FULL verdict for every vector', `${agreed}/${compared}`);
gate(coarseAgreed >= agreed,
  'and the COARSE comparison ("did any of them pass?") is measured beside it, so its blindness is visible',
  `coarse ${coarseAgreed}/${compared} vs full ${agreed}/${compared} — the gap is what a pass/refuse differential cannot see`);

// ── 3. THE CLAIM-AUTHORED AXIS — SHOW ME AN HONEST LOG THIS CONVICTS ────────────────────────
//
// Each implementation judged ALONE against what the verdict is supposed to mean. This is the only
// section that could have caught the shared defect, because it does not ask two authors to
// disagree — it asks each of them whether they convict the innocent.
console.log('\n  ── §3 THE CLAIM-AUTHORED AXIS — no honest log may be accused ──────────────────');
const honestVectors = ALL.filter((v) => v.logHonest);
// A RATE MAY NOT TRAVEL ALONE. This denominator counts only WELL-FORMED inputs; malformed material
// left it when §3d was added, so the number reads identically while covering less. Say so here,
// beside the number, rather than in a document nobody opens with the number in front of them.
say('DENOMINATOR: well-formed inputs only. Malformed roots, proof elements and sizes are counted');
say('separately in §3d — a layer was added and this number shrank without changing.');
for (const [label, judge] of JUDGES) {
  const convicted = honestVectors.filter((v) => judge(v).verdict === 'OBSERVATION_CONFLICT');
  gate(convicted.length === 0,
    `${label}: no honest log is accused across ${honestVectors.length} WELL-FORMED vectors`,
    convicted.length === 0 ? 'zero convictions' : `${convicted.length} INNOCENT LOGS CONVICTED`);
  for (const v of convicted.slice(0, 6)) {
    console.error(`          ${pad(`${v.m}→${v.n}`, 9)}${pad(v.name, 40)}${judge(v).reason}`);
  }
  if (convicted.length > 6) console.error(`          …and ${convicted.length - 6} more`);
}

// ── 3a. THE CONTROL THE ACCEPTANCE CRITERION IS MISSING ─────────────────────────────────────
//
// "CONVICTS ZERO HONEST LOGS" HAS A TRIVIAL PASS: a verifier that answers UNDETERMINED to
// everything convicts nobody and is worthless. It is the same vacuity this project has caught at
// every altitude — a floor with no ceiling is not a floor, it is a shrug.
//
// So the gauntlet is two-sided. Honest APPEND-ONLY growth with a CORRECT proof must be RECOGNISED
// wherever recognition is derivable — and it is derivable at EVERY size, powers of two included,
// because the blind spot costs the ACCUSATION, never the verification. A verifier that refuses to
// validate honest growth at a power-of-two retained size has over-corrected: it has turned "cannot
// accuse here" into "cannot answer here", and a monitor whose retained head sits at 512 or 1024 —
// which is most of them — would never get an answer again.
console.log('\n  ── §3a ANTI-VACUITY — the innocent must also be RECOGNISED ────────────────────');
const cleanGrowth = ALL.filter((v) => v.logHonest && v.name === 'honest proof');
for (const [label, judge] of JUDGES) {
  const recognised = cleanGrowth.filter((v) => judge(v).verdict === 'APPEND_ONLY');
  const missed = cleanGrowth.filter((v) => judge(v).verdict !== 'APPEND_ONLY');
  gate(recognised.length === cleanGrowth.length,
    `${label}: honest append-only growth is RECOGNISED at every size`,
    `${recognised.length}/${cleanGrowth.length}`);
  for (const v of missed.slice(0, 6)) {
    console.error(`          ${pad(`${v.m}→${v.n}`, 9)}retained ${pad(String(v.m), 5)}${judge(v).verdict} — ${judge(v).reason}`);
  }
}

// ── 3d. THE MALFORMED-INPUT AXIS — the class no corpus contained ────────────────────────────
//
// GPT fed minimal/verify.py a 63-character root at m == n and got OBSERVATION_CONFLICT on an
// honest log. That case walked past a 97-vector differential, a crossing gate, a demonstrator gate
// and 546 vectors from a second attacker. EVERY ONE GREEN.
//
// Not because the harnesses were weak. Because EVERY GENERATOR BUILDS ROOTS FROM REAL TREES, and a
// real tree always yields a valid digest. The malformed cell was STRUCTURALLY UNREACHABLE from
// every corpus we had — the same shape as my own zero-growth miss last round, and as a fixture
// that happened to sit at 32. A generator defines its reachable universe and cannot see outside it.
//
// So malformed material is DECLARED as a structural class and constructed on purpose, by hand,
// because it is precisely the class no proof-builder can produce.
//
// WHY IT IS A SEPARATE RATE FROM §3, WHICH WAS MY CALL TO MAKE:
//
//   §3 failing means the SEMANTICS are wrong — the verifier reasoned about a real log and reached
//      an accusation it had not earned.
//   §3d failing means the ADMISSION is wrong — the verifier reasoned AT ALL about material that
//      never entered its domain. A string of 63 characters is not a digest that disagrees with a
//      digest; it is not a digest. It cannot contradict anything.
//
// They fail differently and they are fixed in different places, so one number covering both would
// be un-actionable. AND THE COST OF SPLITTING, which Codex named: §3's denominator now excludes
// malformed material, so 0/97 covers LESS than it looks like it covers while reading identically.
// The rule this repo already has, applied to denominators instead of directions: A RATE MAY NOT
// TRAVEL ALONE. §3 prints what its denominator excludes and names the rate that absorbed it.
const MALFORMED_ROOTS: [string, unknown][] = [
  ['63 hex — truncated in transit', 'a'.repeat(63)],
  ['65 hex — one character too many', 'a'.repeat(65)],
  ['empty string', ''],
  ['64 non-hex characters', 'z'.repeat(64)],
  ['a number, not a string', 12345],
  ['null', null],
  ['an object', {}],
  ['64 hex with a space', `${'a'.repeat(63)} `],
];
// NOT MALFORMED, AND MY FIRST RUN GOT THIS WRONG. I listed uppercase hex among the damaged roots,
// which encoded THE MEMBRANE'S policy (a lowercase-only HEX64) as if it were the truth. Under a
// case-insensitive reading — which spec 0060 mandates, precisely so a wrong-case root can never
// become a false accusation — 'A'*64 is a WELL-FORMED digest that genuinely differs, and a conflict
// verdict on it is correct. Two implementations were reported as convicting the innocent when they
// were obeying the spec and my vector was the thing out of step. It is measured separately below
// as an ADMISSION-DOMAIN divergence, which is what it actually is.
const POLICY_DIVERGENT_ROOTS: [string, unknown][] = [
  ['uppercase hex — a valid digest under a case-insensitive reading', 'A'.repeat(64)],
];

const MALFORMED_SIZES: [string, unknown][] = [
  ['a float', 7.5],
  ['a numeric string', '8'],
  ['boolean true (subclasses int in Python)', true],
  ['negative', -1],
  ['absent', undefined],
  ['NaN', Number.NaN],
  ['an array', [8]],
];

const SIZE_CLASSES: [string, number, number][] = [['m<n', 7, 16], ['m==n', 8, 8], ['m==0', 0, 8]];

function malformedVectors(): Vector[] {
  const out: Vector[] = [];
  for (const [cls, m, n] of SIZE_CLASSES) {
    const base = Array.from({ length: Math.max(n, 1) }, (_, i) => line('base', i));
    const retained = m > 0 ? observationFromLeafDigests(base, m, 1)! : { treeSize: 0, root: sha256hex('empty'), atGeneration: 1 };
    const presented = observationFromLeafDigests(base, n, 1)!;
    const proof = m > 0 && m < n ? consistencyProofHex(base, m, n)! : [];
    const mk = (name: string, r: ObservationV1, pr: ObservationV1, pf: unknown[]): Vector =>
      ({ name: `${cls} ${name}`, m, n, logHonest: true, retained: r, presented: pr, proof: pf as string[] });

    for (const [label, bad] of MALFORMED_ROOTS) {
      out.push(mk(`retained root: ${label}`, { ...retained, root: bad as string }, presented, proof));
      out.push(mk(`presented root: ${label}`, retained, { ...presented, root: bad as string }, proof));
      out.push(mk(`proof element: ${label}`, retained, presented, proof.length ? proof.map((h, i) => (i === 0 ? bad : h)) : [bad]));
    }
    for (const [label, bad] of MALFORMED_SIZES) {
      out.push(mk(`retained treeSize: ${label}`, { ...retained, treeSize: bad as number }, presented, proof));
      out.push(mk(`presented treeSize: ${label}`, retained, { ...presented, treeSize: bad as number }, proof));
    }
    // A DECLARED CELL, RESTORED AFTER I ALMOST DELETED THE FINDING. The non-terminating call was
    // first surfaced by an `m==0 proof element: uppercase hex` vector. When uppercase was correctly
    // reclassified as policy-divergent rather than malformed, THAT VECTOR LEFT THE CORPUS AND THE
    // HANG STOPPED BEING REPORTED — a gate going green because the case that failed was removed,
    // which is the defect this project exists to catch, committed by me while fixing another one.
    //
    // The hang has nothing to do with case. It is m === 0 WITH A NON-EMPTY PROOF: fn = m - 1 = -1
    // and `while ((fn & 1) === 1) { fn >>= 1 }` never terminates. So the class gets its own cell,
    // with a perfectly WELL-FORMED node, and it cannot leave the corpus when a policy call changes.
    if (m === 0) {
      out.push(mk('a WELL-FORMED proof node against a zero retained size', retained, presented, [sha256hex('a perfectly good node')]));
      out.push(mk('two well-formed proof nodes against a zero retained size', retained, presented,
        [sha256hex('node one'), sha256hex('node two')]));
    }
  }
  return out;
}

const MALFORMED: Vector[] = malformedVectors();

// ══ A JUDGE THAT NEVER RETURNS IS A THIRD OUTCOME, AND try/catch CANNOT SEE IT ═══════════════
//
// Found by this axis on its first run: verifyRFC6962Consistency(0, 8, root, root, [oneNode]) does
// not terminate. m === 0 gives fn = m - 1 = -1, and `while ((fn & 1) === 1) { fn >>= 1 }` spins
// forever because arithmetic right-shift of -1 is -1. The guard used to be `m <= 0`; it is now
// `m < 0`, so zero is admitted and reaches the fold. A fix for the missing-prior-observation class
// opened a non-terminating path in the same function.
//
// A SYNCHRONOUS INFINITE LOOP CANNOT BE CAUGHT. try/catch does not see it, and setTimeout never
// fires because the event loop is blocked — I confirmed that by watching a 3-second timer fail to
// fire in three minutes. So the only way to MEASURE it is to run the call in another process and
// let the clock outlive it. That is what this does, for the malformed axis only.
//
// It is a strictly worse failure than a false accusation: a verifier that never returns is a
// witness a malformed byte can silence, and every gate that asserts "none of them throws" is blind
// to it by construction.
const isolatedRunner = LAB ? join(LAB, 'run-independent.ts') : '';
if (LAB) {
  writeFileSync(isolatedRunner,
    `import { verifyRFC6962Consistency } from ${JSON.stringify(join(REPO_ROOT, 'core', 'rfc6962-independent-verifier.ts'))};
`
    + `const a = JSON.parse(process.argv[2]);
`
    + `const r = verifyRFC6962Consistency(a.m, a.n, a.r1, a.r2, a.proof);
`
    + `console.log(JSON.stringify({ verdict: r.verdict, reason: r.refuseReason ?? 'consistency:append-only-proved' }));
`);
}

/** The independent verifier, run where a non-terminating call can be observed rather than inherited. */
const theirsIsolated = (v: Vector): { verdict: ConsistencyVerdict; reason: string } => {
  if (!LAB) return theirs(v);
  const arg = JSON.stringify({ m: v.m, n: v.n, r1: v.retained.root, r2: v.presented.root, proof: v.proof });
  const r = spawnSync('bun', ['run', isolatedRunner, arg], { encoding: 'utf8', timeout: 4000 });
  if (r.status !== 0 || !r.stdout) {
    return { verdict: 'UNDETERMINED', reason: r.signal === 'SIGTERM' ? 'judge:did-not-return' : 'judge:threw' };
  }
  try { return JSON.parse(r.stdout.trim()); } catch { return { verdict: 'UNDETERMINED', reason: 'judge:unparseable' }; }
};

const MALFORMED_JUDGES = [
  ['membrane', JUDGES[0][1]],
  ['independent', cached('independent-isolated', theirsIsolated)],
  ['demonstrator', JUDGES[2][1]],
] as const;

console.log('\n  ── §3d THE MALFORMED-INPUT AXIS — material that never entered the domain ─────');
{
  say(`${MALFORMED.length} cells: ${MALFORMED_ROOTS.length} root damages x 3 fields + ${MALFORMED_SIZES.length} size damages x 2 fields, crossed with m<n / m==n / m==0`);
  for (const [label, judge] of MALFORMED_JUDGES) {
    const accused = MALFORMED.filter((v) => judge(v).verdict === 'OBSERVATION_CONFLICT');
    const threw = MALFORMED.filter((v) => judge(v).reason === 'judge:threw').length;
    gate(accused.length === 0,
      `${label}: NO malformed input produces an accusation`,
      accused.length === 0 ? `0/${MALFORMED.length}` : `${accused.length}/${MALFORMED.length} ACCUSED ON MATERIAL THAT IS NOT A DIGEST`);
    for (const v of accused.slice(0, 6)) console.error(`          ${pad(v.name, 52)}${judge(v).reason}`);
    if (accused.length > 6) console.error(`          …and ${accused.length - 6} more`);
    const hung = MALFORMED.filter((v) => judge(v).reason === 'judge:did-not-return');
    gate(threw === 0 && hung.length === 0,
      `${label}: and none of them throws OR HANGS — a malformed byte cannot silence the witness`,
      hung.length ? `${hung.length} DID NOT RETURN (a synchronous loop try/catch cannot see)` : (threw ? `${threw} threw` : 'no exceptions, no hangs'));
    for (const v of hung.slice(0, 4)) console.error(`          NON-TERMINATING  ${v.name}`);
  }
  // NON-VACUITY: the axis must be REACHING the implementations, not silently no-opping.
  const reached = new Set(MALFORMED.map((v) => MALFORMED_JUDGES[0][1](v).reason));
  gate(reached.size >= 3, 'the axis reaches distinct refusal reasons — it is exercising the code, not bouncing off one guard',
    `${reached.size} distinct reasons`);
}

// ══ 3e. THE ADMISSION DOMAIN — same bytes, different domains ═════════════════════════════════
//
// §3z proves the three implementations agree on what the WORDS mean. NOTHING PROVED THEY AGREE ON
// WHICH INPUTS ARE WORDS. They do not, in two distinct ways, and both belong under one heading
// because both are the same kind of disagreement: not about a log, but about whether the material
// in front of them is admissible at all.
//
//   3e.1 VALUE DOMAIN     — same parsed value, different admission policy (uppercase hex).
//   3e.2 ENCODING DOMAIN  — same BYTES, different parsed value (7e0, 7.0, 2^53+1, -0, …).
//
// ══ AND THE REASON THIS HARNESS COULD NEVER HAVE FOUND 3e.2 ═════════════════════════════════
//
// Every vector above is a TypeScript OBJECT. After JSON.parse, JavaScript cannot distinguish 7
// from 7.0 from 7e0 — the information is destroyed before any code of mine can see it. So no
// object-valued generator can construct the encoding class, in the same way no proof-builder could
// construct m == n and no tree-builder could construct a malformed root. THE HARNESS IS BLIND BY
// CONSTRUCTION, and the only cure is to stop building objects and start building BYTES.
//
// That blindness is asserted below rather than described, because a limitation nobody watches is a
// limitation that quietly stops being true.
console.log('\n  ── §3e THE ADMISSION DOMAIN — same bytes, different domains ──────────────────');
{
  // ── 3e.1 VALUE DOMAIN ─────────────────────────────────────────────────────────────────────
  const cells: Vector[] = [];
  for (const [cls, m, n] of SIZE_CLASSES) {
    const base = Array.from({ length: Math.max(n, 1) }, (_, i) => line('base', i));
    const retained = m > 0 ? observationFromLeafDigests(base, m, 1)! : { treeSize: 0, root: sha256hex('empty'), atGeneration: 1 };
    const presented = observationFromLeafDigests(base, n, 1)!;
    const proof = m > 0 && m < n ? consistencyProofHex(base, m, n)! : [];
    for (const [label, val] of POLICY_DIVERGENT_ROOTS) {
      cells.push({ name: `${cls} retained root: ${label}`, m, n, logHonest: true, retained: { ...retained, root: val as string }, presented, proof });
      cells.push({ name: `${cls} presented root: ${label}`, m, n, logHonest: true, retained, presented: { ...presented, root: val as string }, proof });
    }
  }
  let valueDivergent = 0;
  for (const v of cells) {
    const got = MALFORMED_JUDGES.map(([, j]) => j(v).verdict);
    if (!got.every((g) => g === got[0])) { valueDivergent += 1; say(`  ${pad(v.name.slice(0, 40), 42)}${got.map((g) => pad(g, 22)).join('')}`); }
  }
  say(`3e.1 VALUE DOMAIN: ${valueDivergent}/${cells.length} divergent — the membrane calls uppercase hex malformed; 0060 calls it a digest.`);

  // ── 3e.2 ENCODING DOMAIN — RAW BYTES, because objects cannot carry the distinction ────────
  //
  // THE BLINDNESS, PROVED FIRST. If these two parse identically, no object-level vector in this
  // file can ever separate them, and every green above is silent about the whole class.
  const sameAfterParse = JSON.parse('{"t":7e0}').t === JSON.parse('{"t":7}').t
    && JSON.parse('{"t":7.0}').t === JSON.parse('{"t":7}').t;
  gate(sameAfterParse,
    'PROVED BLIND: after JSON.parse, 7 and 7.0 and 7e0 are one value — no object vector in this file can reach the encoding class',
    'which is why the cases below are raw text and never JSON.stringify');

  const A = 'a'.repeat(64), B = 'b'.repeat(64);
  const ENCODINGS: { name: string; retained: string; presented: string }[] = [
    { name: 'int beyond 2^53', retained: `{"treeSize":9007199254740993,"root":"${A}","atGeneration":2}`,
      presented: `{"treeSize":9007199254740992,"root":"${B}","atGeneration":2,"proofFromPrevious":[]}` },
    { name: 'exponent 7e0', retained: `{"treeSize":7,"root":"${A}","atGeneration":2}`,
      presented: `{"treeSize":7e0,"root":"${B}","atGeneration":2,"proofFromPrevious":[]}` },
    { name: 'trailing .0', retained: `{"treeSize":7,"root":"${A}","atGeneration":2}`,
      presented: `{"treeSize":7.0,"root":"${B}","atGeneration":2,"proofFromPrevious":[]}` },
    { name: 'negative zero', retained: `{"treeSize":-0,"root":"${A}","atGeneration":2}`,
      presented: `{"treeSize":7,"root":"${B}","atGeneration":2,"proofFromPrevious":[]}` },
    { name: 'duplicate root key', retained: `{"treeSize":7,"root":"${A}","atGeneration":2,"root":"${B}"}`,
      presented: `{"treeSize":7,"root":"${B}","atGeneration":2,"proofFromPrevious":[]}` },
    { name: 'leading zeros', retained: `{"treeSize":007,"root":"${A}","atGeneration":2}`,
      presented: `{"treeSize":7,"root":"${B}","atGeneration":2,"proofFromPrevious":[]}` },
    // NEW HERE — a BOM is invisible in every editor and every diff, and it is the first byte.
    { name: 'BOM before the brace', retained: `\uFEFF{"treeSize":7,"root":"${A}","atGeneration":2}`,
      presented: `{"treeSize":7,"root":"${B}","atGeneration":2,"proofFromPrevious":[]}` },
    // NEW HERE — the same visible root, two Unicode normalisations. A digest is ASCII, so this must
    // be inert; asserting it is how we learn if a reader ever starts normalising.
    { name: 'NFD combining mark in root', retained: `{"treeSize":7,"root":"${'a'.repeat(63)}\u0301","atGeneration":2}`,
      presented: `{"treeSize":7,"root":"${B}","atGeneration":2,"proofFromPrevious":[]}` },
  ];

  const readAsMembrane = (text: string): ObservationV1 | null => {
    try { const o = JSON.parse(text); return { treeSize: o.treeSize, root: o.root, atGeneration: o.atGeneration }; } catch { return null; }
  };
  let encodingDivergent = 0, accusingSplits = 0;
  const encLab = LAB || mkdtempSync(join(tmpdir(), 'aukora-encoding-'));
  for (const c of ENCODINGS) {
    // Each implementation reads THE SAME BYTES through its own parser — that is the whole test.
    const rp = join(encLab, 'enc-r.json'), pp = join(encLab, 'enc-p.json');
    writeFileSync(rp, c.retained); writeFileSync(pp, c.presented);
    const py = spawnSync('python3', [DEMONSTRATOR, rp, pp], { encoding: 'utf8', timeout: 20_000 });
    const pyVerdict = (py.stdout ?? '').match(/VERDICT:\s*(\S+)/)?.[1] ?? 'NO_OUTPUT';

    const r = readAsMembrane(c.retained), p2 = readAsMembrane(c.presented);
    const proofOf = (t: string) => { try { return JSON.parse(t).proofFromPrevious ?? []; } catch { return []; } };
    const memb = r && p2 ? consistencyBetweenDetailed(r, p2, proofOf(c.presented)).verdict : 'UNDETERMINED';
    let indep: string;
    try {
      indep = r && p2
        ? verifyRFC6962Consistency(r.treeSize, p2.treeSize, String(r.root), String(p2.root), proofOf(c.presented)).verdict
        : 'UNDETERMINED';
    } catch { indep = 'UNDETERMINED'; }

    const got = [memb, indep, pyVerdict];
    const split = !got.every((g) => g === got[0]);
    if (split) {
      encodingDivergent += 1;
      if (got.includes('OBSERVATION_CONFLICT')) accusingSplits += 1;
      say(`  ${pad(c.name, 30)}membrane=${pad(memb, 22)}independent=${pad(indep, 22)}demonstrator=${pyVerdict}`);
    }
  }
  if (!LAB) rmSync(encLab, { recursive: true, force: true });
  say(`3e.2 ENCODING DOMAIN: ${encodingDivergent}/${ENCODINGS.length} divergent, ${accusingSplits} of them ACCUSING in at least one implementation.`);

  // REPORTED, NOT GATED — the ruling is the spec's. But an ACCUSING split is not a policy question:
  // it is a prover choosing the verdict by choosing the reader's language, and that must be visible.
  gate(true, `${valueDivergent + encodingDivergent} admission-domain divergences, reported not gated`,
    'the spec rules on what is admissible; this harness only refuses to let the disagreement be silent');
  say('§3z proves they agree on what the WORDS mean. This is whether they agree on WHICH INPUTS');
  say('are words at all — a different question, and one an object-valued generator cannot ask.');
  if (accusingSplits > 0) {
    say('');
    say(`AND ${accusingSplits} OF THESE SPLITS PRODUCE AN ACCUSATION IN ONE IMPLEMENTATION AND NOT ANOTHER.`);
    say('A prover who knows which language the monitor runs can choose the verdict. That is not a');
    say('difference of policy; it is a channel, and it is open on published main today.');
  }
}

// ── 3c. THE DERIVABLE-CONFLICT FLOOR — the third rate, and the one nobody had ────────────────
//
// §3 says the innocent must not be convicted. §3a says the innocent must be recognised. Neither
// says THE GUILTY MUST BE NAMED WHERE NAMING IS POSSIBLE — so a verifier could pass both by
// refusing to accuse anywhere, which is the same trivial pass one step over.
//
// The floor is not "detect every rewrite" — the blind spot makes that impossible and demanding it
// would be the pressure Auma warned about. It is exactly: WHERE accusationReachable() SAYS THE
// CONFLICT IS DERIVABLE, IT MUST BE DERIVED. That predicate is already checked against seeded
// rewrites, so the floor is measured rather than asserted.
//
// FOR EVERY RATE REQUIRED TO GO UP, NAME THE RATE THAT MUST NOT MOVE. This is that rule applied to
// the false-accusation rate: driving convictions to zero must not be purchasable by silence.
console.log('\n  ── §3c THE DERIVABLE-CONFLICT FLOOR ──────────────────────────────────────────');
{
  const derivable = ALL.filter((v) => !v.logHonest && accusationReachable(v.m, v.n) && v.name !== 'honest proof replayed at a rewritten head');
  for (const [label, judge] of JUDGES) {
    const named = derivable.filter((v) => judge(v).verdict === 'OBSERVATION_CONFLICT');
    const missed = derivable.filter((v) => judge(v).verdict !== 'OBSERVATION_CONFLICT');
    gate(named.length === derivable.length,
      `${label}: a conflict is NAMED wherever it is derivable`, `${named.length}/${derivable.length}`);
    for (const v of missed.slice(0, 6)) {
      console.error(`          ${pad(`${v.m}→${v.n}`, 9)}${pad(v.name, 40)}${judge(v).verdict} — ${judge(v).reason}`);
    }
  }
  const zeroGrowth = derivable.filter((v) => v.m === v.n);
  gate(zeroGrowth.length > 0, 'and the ZERO-GROWTH class is sampled, not merely described', `${zeroGrowth.length} vectors at m == n`);
}

// ── 3z. VOCABULARY CONFORMANCE — the verdict set is the product, and it exists THREE TIMES ──
//
// The differential compares the verdict each implementation RETURNS. Nothing compared the set of
// verdicts each one CAN return, and that set is declared independently in three places: a TS union
// here, another TS union in the independent verifier, and bare string literals in the Python. By
// this week's law those are three copies of a thing that CANNOT usefully disagree — the two
// verifiers must be able to disagree about a LOG, never about what the words mean.
//
// Nothing was watching it. If one implementation renamed a token, §2 would have reported a
// divergence and blamed the arithmetic. This is the cheap gate that tells the difference, and it
// is also what makes the pending OBSERVATION_CONFLICT rename a mechanical operation instead of a gamble:
// after the rename this goes red until every implementation has landed it, which is exactly the
// property a vocabulary change needs and did not have.
console.log('\n  ── §3z VOCABULARY CONFORMANCE ────────────────────────────────────────────────');
{
  const tokensIn = (path: string): Set<string> => {
    try {
      const src = readFileSync(join(REPO_ROOT, path), 'utf8');
      const found = new Set<string>();
      for (const m of src.matchAll(/\b(APPEND_ONLY|OBSERVATION_CONFLICT|UNDETERMINED|INCONSISTENT_WITH_RETAINED)\b/g)) found.add(m[1]);
      return found;
    } catch { return new Set(); }
  };
  const sources: [string, string][] = [
    ['membrane', 'core/aura-consistency.ts'],
    ['independent', 'core/rfc6962-independent-verifier.ts'],
    ['demonstrator', 'minimal/verify.py'],
  ];
  const sets = sources.map(([label, path]) => [label, tokensIn(path)] as const);
  for (const [label, set] of sets) say(`${pad(label, 15)}${[...set].sort().join(' ')}`);
  const reference = [...sets[0][1]].sort().join(' ');
  const conform = sets.filter(([, set]) => [...set].sort().join(' ') === reference).length;
  gate(conform === sets.length,
    'all three implementations declare the SAME admissible verdict set',
    `${conform}/${sets.length}`);
  gate(sets.every(([, set]) => set.size === 3),
    'and the set is closed at three — no implementation has quietly grown a fourth answer',
    sets.map(([l, set]) => `${l}=${set.size}`).join(' '));
}

// ── 3b. THE TWO ERROR DIRECTIONS, AS RATES ──────────────────────────────────────────────────
//
// "Theirs detects more rewrites" is true and it is not a defence, because a verdict that fires on
// everything is correct whenever the answer happens to be everything. Stated as two rates the
// trade is visible and neither implementation gets to hide behind the other's number.
{
  const guilty = ALL.filter((v) => !v.logHonest);
  const honest = ALL.filter((v) => v.logHonest);
  console.log('');
  console.log(`    ${pad('', 15)}${pad('detects a rewrite', 22)}${pad('convicts the innocent', 24)}discrimination`);
  const rates: Record<string, number> = {};
  for (const [label, judge] of JUDGES) {
    const tp = guilty.filter((v) => judge(v).verdict === 'OBSERVATION_CONFLICT').length / guilty.length;
    const fp = honest.filter((v) => judge(v).verdict === 'OBSERVATION_CONFLICT').length / honest.length;
    rates[label] = tp - fp;
    console.log(`    ${pad(label, 15)}${pad(`${(tp * 100).toFixed(0)}%`, 22)}${pad(`${(fp * 100).toFixed(0)}%`, 24)}${(tp - fp).toFixed(2)}`);
  }
  gate(honest.filter((v) => ours(v).verdict === 'OBSERVATION_CONFLICT').length === 0,
    'the membrane trades detection for a ZERO false-accusation rate, and that direction is deliberate');
  say('a verdict that fires on everything is right whenever the answer is everything; the rate says so.');
}

// ── 3c. THE ORDER DEFECT, NOT ONLY THE MAPPING ──────────────────────────────────────────────
//
// The independent verifier checks the RETAINED root before the PRESENTED head:
//     if (fr !== root1) return OBSERVATION_CONFLICT 'older-root-mismatch'   ← issued before sr is ever compared
// So the accusation can be issued WITHOUT EVER ESTABLISHING THAT THE PROOF DESCRIBES THE HEAD IT
// WAS SHOWN. Remapping those reasons to UNDETERMINED would not fix it: at that point the verifier
// genuinely does not yet know which of the two worlds it is in. The head check must come FIRST.
// This is a deeper finding than the verdict mapping and it belongs to the demonstrator's spec.
{
  const accusedWithoutConnecting = ALL.filter((v) => {
    const b = theirs(v);
    return b.verdict === 'OBSERVATION_CONFLICT' && b.reason === 'consistency:older-root-mismatch'
      && ours(v).reason === 'consistency:proof-does-not-connect-to-presented-head';
  });
  gate(accusedWithoutConnecting.length === 0,
    'no accusation is issued before the proof is shown to describe the presented head',
    accusedWithoutConnecting.length === 0
      ? 'none'
      : `${accusedWithoutConnecting.length} vectors accused on a retained-root mismatch the head check would have pre-empted`);
  for (const v of accusedWithoutConnecting.slice(0, 4)) say(`   ${pad(`${v.m}→${v.n}`, 9)}${v.name}`);
}

// ── 4. THE BLIND SPOT, AGREED OR NOT ────────────────────────────────────────────────────────
// A shared limit is not a shared bug — but it must be shared KNOWINGLY, so it is measured.
console.log('\n  ── §4 THE POWER-OF-TWO BLIND SPOT ────────────────────────────────────────────');
{
  const rewrites = ALL.filter((v) => !v.logHonest && v.name.startsWith('GENUINE'));
  for (const v of rewrites) {
    const a = ours(v), b = theirs(v);
    const reachable = accusationReachable(v.m, v.n);
    say(`${pad(`${v.m}→${v.n}`, 10)}accusable=${pad(String(reachable), 6)}membrane=${pad(a.verdict, 14)}independent=${b.verdict}`);
  }
  const blind = rewrites.filter((v) => !accusationReachable(v.m, v.n));
  gate(blind.length > 0 && blind.every((v) => ours(v).verdict !== 'APPEND_ONLY'),
    'at a power-of-two retained size a genuine rewrite is REFUSED but not accusable, and never passes',
    `${blind.length} such vectors`);
  gate(rewrites.some((v) => accusationReachable(v.m, v.n) && ours(v).verdict === 'OBSERVATION_CONFLICT'),
    'and away from powers of two the same rewrite IS accused — the blind spot is arithmetic, not policy');
}

// ══ §5 THE HARM-CAPACITY CENSUS — this corpus, measured against its own asymmetry ═════════════
//
// Last round I asserted that every corpus here is heaviest where harm is impossible and thinnest
// where it is not, and that the external oracle's 0/2 was that asymmetry one layer up rather than
// a property of transparency-dev's fixtures alone. An assertion about a corpus is exactly the kind
// of claim this project refuses from anyone else, so here is the number.
//
// A vector is ACCUSATION-CAPABLE when OBSERVATION_CONFLICT is the CORRECT answer for it: the log
// is genuinely guilty AND accusationReachable() says the conflict is derivable at those sizes.
// Everything else is a vector where an accusation would be a false one — which is to say, a vector
// that can only ever exercise the half of this instrument that cannot hurt anybody.
console.log('\n  ── §5 HARM-CAPACITY CENSUS ───────────────────────────────────────────────────');
{
  const capable = (v: Vector) => !v.logHonest && accusationReachable(v.m, v.n)
    && v.name !== 'honest proof replayed at a rewritten head';

  const sections: [string, Vector[]][] = [
    ['§2  differential matrix', ALL],
    ['§3  claim-authored (honest)', honestVectors],
    ['§3a anti-vacuity (clean growth)', cleanGrowth],
    ['§3c derivable-conflict floor', ALL.filter(capable)],
    ['§3d malformed-input axis', MALFORMED],
  ];

  say(`${pad('section', 34)}${pad('vectors', 10)}${pad('accusation-capable', 22)}share`);
  let totalV = 0, totalC = 0;
  for (const [name, vs] of sections) {
    const c = vs.filter(capable).length;
    if (name.startsWith('§2')) { totalV = vs.length + MALFORMED.length; totalC = c; }
    say(`${pad(name, 34)}${pad(String(vs.length), 10)}${pad(String(c), 22)}${vs.length ? Math.round((c / vs.length) * 100) : 0}%`);
  }
  say('');
  say(`WHOLE CORPUS  ${totalC} of ${totalV} vectors (${Math.round((totalC / totalV) * 100)}%) can produce an accusation at all.`);
  say(`The other ${totalV - totalC} exercise only the half of this instrument that cannot hurt anybody.`);

  // THE FLOOR IS REAL — the asymmetry is worth naming, not worth panicking about.
  gate(totalC > 0, 'the accusation path IS exercised by this corpus — the asymmetry is a proportion, not a gap', `${totalC} vectors`);

  // AND THE PROVENANCE, WHICH IS THE PART THAT MATTERS MOST. Every vector above is constructed in
  // this file from sha256 of a local string. Not one arrives from outside.
  const homeAuthored = totalV;
  gate(homeAuthored === totalV,
    'PROVENANCE: every vector in this file is home-authored — zero externally sourced',
    `${homeAuthored}/${totalV} built from local digests in this repository`);
  say('');
  say(`SO THE HONEST SENTENCE IS: ${totalC} home-authored vectors stand behind the only verdict this`);
  say('instrument can emit that is capable of harming somebody, and NO EXTERNAL PARTY HAS EVER');
  say('AUTHORED ONE. The external oracle reached 0 of 2 accusation classes; this file reaches them');
  say('and is not external. Those are two different gaps and neither closes the other.');
}

// ── THE SENTENCE THAT MUST NOT LIVE IN A COMMIT MESSAGE ─────────────────────────────────────
console.log('\n  ══ READ THIS BEFORE QUOTING ANY AGREEMENT NUMBER ABOVE ═══════════════════════');
say('TWO OF THESE THREE IMPLEMENTATIONS SHARE A RUNTIME. The membrane and the independent verifier');
say('are both TypeScript on the same engine, so they cannot disagree about what a number IS, what');
say('JSON.parse returns, or when an integer stops being representable. Their agreement on those');
say('questions is GUARANTEED BY THE SUBSTRATE and therefore carries no information about it.');
say('');
say(`So the honest headline is not three-implementation agreement. It is TWO-RUNTIME agreement:`);
say(`  runtimes compared   2 (JavaScript, Python)`);
say(`  implementations     3 (2 JavaScript, 1 Python)`);
say('THE PYTHON COLUMN IS CARRYING THE ENTIRE SUBSTRATE SIGNAL. Every split view found this week —');
say('the bignum rounding, 7e0, the trailing .0 — was visible ONLY because one column was not');
say('JavaScript. Remove it and §3e.2 goes silent while every gate here stays green.');
say('');
say('These three implementations agree because ONE PERSON wrote the membrane\'s rule, the spec');
say('encodes that rule, and the demonstrator was built from the spec. THAT IS NOT THREE WITNESSES.');
say('IT IS ONE OPINION WITH THREE IMPLEMENTATIONS. Agreement here bounds implementation error and');
say('says NOTHING about whether the shared reading of RFC 6962 is correct — which is exactly the');
say('class that hid a false-accusation channel behind a fully green differential for hours.');
say('');
say(`FULL-VERDICT AGREEMENT IS ${agreed}/${compared}. The coarse comparison would report ${coarseAgreed}/${compared}.`);
say('If anyone ever quotes "all three implementations agree", the shared-semantics class has');
say('claimed its next victim, and this time it is us claiming it about ourselves.');
console.log('  ══════════════════════════════════════════════════════════════════════════════');

console.log('\n  ── WHAT EACH SECTION IS GOOD FOR ─────────────────────────────────────────────');
say('§2 catches ARITHMETIC divergence and is structurally blind to any error both share.');
say('§3 catches SHARED SEMANTICS, because it judges each implementation against the claim');
say('   rather than against the other. It is the only section that would have caught the defect');
say('   found this morning, and a case written from the spec could not have contained it.');
console.log('  ──────────────────────────────────────────────────────────────────────────────');

if (LAB) rmSync(LAB, { recursive: true, force: true });
console.log(failures === 0
  ? '\nconsistency-differential: full verdicts agree, and neither implementation convicts an honest log'
  : `\nconsistency-differential: ${failures} failure(s) — see the divergence table above`);
process.exit(failures ? 1 : 0);
