#!/usr/bin/env bun
// scripts/peer-class-corpus-verify.ts — every declared class, and a denominator for each.
//
//     bun run scripts/peer-class-corpus-verify.ts
//
// ══ WHY ═════════════════════════════════════════════════════════════════════════════════════
//
// The reach census measured 10/14 classes of `minimal/verify.py` constructed by any gate in this
// repo. Four were reached by nothing at all — one of them a guard added the same week under attack
// pressure, with nothing exercising it. And of the ten that WERE reached, several were reached
// exactly once: A CLASS REACHED ONCE IS A CLASS WITH A DENOMINATOR OF ONE. `root_is_not_a_digest`
// hit by a single 63-character root says nothing about 65, uppercase, whitespace, or a non-string.
//
// So this gate does two things the census could not:
//   · it CONSTRUCTS at least one input for every declared class, closing the four holes;
//   · it counts DISTINCT INPUTS PER CLASS, so "reached" stops being a boolean.
//
// ══ THE CORRECTION THAT MATTERS MORE THAN THE VECTORS ═══════════════════════════════════════
//
// The four unreached classes were expected to split two-and-two: two one-liners, and two needing
// "a generator that constructs degenerate trees". THEY ARE ALL ONE-LINERS. m == 0, m > n, a
// same-size pair carrying a proof, a proof element that is 63 characters — every one is a hand-
// written literal.
//
// They were unreached for a different reason, and it is the same reason `m == n` was unreached:
// EVERY CORPUS IN THIS REPO BUILDS OBSERVATIONS FROM REAL TREES, and a real tree generator can
// never emit a zero-size retained tree, a retained size larger than the presented one, or a
// same-size pair carrying proof nodes. The cells were not hard. They were OUTSIDE THE RANGE OF THE
// MACHINE THAT MAKES CELLS — which is the whole finding, and it is why "build more vectors" was
// never going to reach them.
//
// ══ INTENT IS NOT MEASUREMENT ═══════════════════════════════════════════════════════════════
//
// Every input below declares which class it is FOR, and that declaration is never trusted. The
// subject is instrumented in a private lab and the class it ACTUALLY reaches is read back. A
// mismatch is reported as a finding about this file's model of the artifact — which is the honest
// direction, because the artifact is the authority and this corpus is a guess about it.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const REPO = join(import.meta.dir, '..');
const LAB = join(REPO, '.peer-class-lab');
const SUBJECT = join(REPO, 'minimal', 'verify.py');

let failures = 0;
const gate = (c: boolean, m: string, d = ''): void => {
  if (!c) failures++;
  (c ? console.log : console.error)(`  ${c ? 'ok  ' : 'FAIL'}  ${m}${d ? ` — ${d}` : ''}`);
};
const note = (m: string): void => console.log(`        ${m}`);

// Real merkle material, from the lane that owns it. Absent, the tree-derived classes say so.
type ObsFn = (leaves: readonly string[], size: number, gen: number) => { treeSize: number; root: string; atGeneration: number } | null;
type ProofFn = (leaves: readonly string[], s1: number, s2: number) => string[] | null;
let obsFrom: ObsFn | null = null;
let proofHex: ProofFn | null = null;
try {
  const m = await import('../core/aura-consistency');
  const o = (m as Record<string, unknown>).observationFromLeafDigests;
  const c = (m as Record<string, unknown>).consistencyProofHex;
  if (typeof o === 'function' && typeof c === 'function') { obsFrom = o as ObsFn; proofHex = c as ProofFn; }
} catch { /* not landed */ }

const H = (s: string): string => createHash('sha256').update(s).digest('hex');
const LEAVES = Array.from({ length: 200 }, (_, i) => H(`corpus-leaf-${i}`));

console.log('peer-class-corpus — every declared class of the demonstrator, with a denominator\n');

if (!existsSync(SUBJECT)) {
  console.error('  FAIL  minimal/verify.py is absent — nothing to enumerate');
  process.exit(1);
}

// ══ THE PARTITION, READ OFF THE SUBJECT ═════════════════════════════════════════════════════
const subjectSrc = readFileSync(SUBJECT, 'utf8');
// READ OFF BOTH SHAPES. The first version enumerated only `return (VERDICT, reason)` tuples inside
// verify_consistency — and missed every verdict PRINTED DIRECTLY IN main(). Antigravity's lexical
// pre-parse guard emits invalid_tree_sizes before verify_consistency is ever called, and
// parse_or_io_error is printed from the exception handler. A partition that reads one shape of exit
// is a partition with holes in it, which is the defect this whole gate exists to measure.
const CLASSES = [...new Set([
  ...[...subjectSrc.matchAll(/return \("([A-Z_]+)", "([^"]+)"\)/g)].map((m) => `${m[1]}/${m[2]}`),
  ...[...subjectSrc.matchAll(/VERDICT: ([A-Z_]+)\\nREASON : ([^"\\]+)/g)].map((m) => `${m[1]}/${m[2]}`),
])].sort();

// ══ MEASURED FROM STDOUT, WHICH IS WHAT A STRANGER SEES ═════════════════════════════════════
// The census had to instrument the subject because gates swallow its output. Here the subject is
// run directly, so its own printed verdict is authoritative — and it covers paths that never reach
// a tuple-return, which instrumentation alone would have missed.
rmSync(LAB, { recursive: true, force: true });
mkdirSync(LAB, { recursive: true });

interface Vec { forClass: string; label: string; retained: unknown; presented: unknown; rawRetained?: string; rawPresented?: string; latin1?: boolean; deleteRetained?: boolean; retainedIsDir?: boolean; presentedIsDir?: boolean; padTo?: number }
const V: Vec[] = [];
const add = (forClass: string, label: string, retained: unknown, presented: unknown): void => {
  // A GUARD ADDED AT THE FRONT OF main() SHADOWS EVERY CLASS BEHIND IT. `proof_field_absent` landed
  // one commit after this corpus was written and immediately absorbed 15 inputs that were written
  // for other classes — they simply did not carry the field, because when they were authored no
  // check looked for it. The corpus now states the field explicitly, which is the honest form: a
  // vector that does not say what it carries is a vector whose meaning depends on the order of
  // guards it happens to meet.
  const p = presented as Record<string, unknown> | null;
  if (p && typeof p === 'object' && !('proofFromPrevious' in p) && forClass !== 'UNDETERMINED/proof_field_absent') {
    presented = { ...p, proofFromPrevious: [] };
  }
  V.push({ forClass, label, retained, presented });
};
/** RAW BYTES, because some classes are unreachable through a JSON serializer. `parse_or_io_error`
 *  cannot be produced by anything that emits valid JSON — the corpus had a denominator of zero for
 *  it purely because the machine that makes cells could only make well-formed ones. Same shape,
 *  third time: a generator's reachable universe, not a missing idea. */
const addRaw = (forClass: string, label: string, rawRetained: string, rawPresented: string,
  opts: { latin1?: boolean; deleteRetained?: boolean; retainedIsDir?: boolean; presentedIsDir?: boolean; padTo?: number } = {}): void => {
  V.push({ forClass, label, retained: null, presented: null, rawRetained, rawPresented, ...opts });
};
const obs = (treeSize: unknown, root: unknown, extra: Record<string, unknown> = {}): unknown =>
  ({ treeSize, root, atGeneration: 1, ...extra });
const R = (n: number): string => H(`root-${n}`);

// ── THE FOUR THAT NOTHING REACHED, and every one is a literal ────────────────────────────────
add('UNDETERMINED/invalid_tree_sizes', 'retained larger than presented', obs(9, R(1)), obs(4, R(2)));
// MOVED BY THE ONE-TOKENIZER REFACTOR: `-1` is refused as a non-canonical integer TOKEN at
// admission, before any size comparison. Earlier and stricter — reclassified, not deleted.
add('UNDETERMINED/document_is_not_admissible', 'negative retained size — refused as a token', obs(-1, R(1)), obs(4, R(2)));
add('UNDETERMINED/invalid_tree_sizes', 'treeSize is a string', obs('4', R(1)), obs(9, R(2)));
add('UNDETERMINED/invalid_tree_sizes', 'treeSize is a boolean', obs(true, R(1)), obs(9, R(2)));

add('UNDETERMINED/missing_prior_observation', 'zero retained, positive presented', obs(0, R(1)), obs(9, R(2)));
add('UNDETERMINED/missing_prior_observation', 'zero on both sides', obs(0, R(1)), obs(0, R(2)));
add('UNDETERMINED/missing_prior_observation', 'zero retained with a proof', obs(0, R(1)), obs(9, R(2), { proofFromPrevious: [R(3)] }));

add('UNDETERMINED/non_empty_proof_for_same_size', 'same size, one proof node', obs(5, R(1)), obs(5, R(2), { proofFromPrevious: [R(3)] }));
add('UNDETERMINED/non_empty_proof_for_same_size', 'same size, three proof nodes', obs(5, R(1)), obs(5, R(2), { proofFromPrevious: [R(3), R(4), R(5)] }));
add('UNDETERMINED/non_empty_proof_for_same_size', 'same size, IDENTICAL roots but a proof', obs(5, R(1)), obs(5, R(1), { proofFromPrevious: [R(3)] }));

add('UNDETERMINED/proof_element_is_not_a_digest', '63-character element', obs(4, R(1)), obs(9, R(2), { proofFromPrevious: [R(3).slice(0, 63)] }));
add('UNDETERMINED/proof_element_is_not_a_digest', '65-character element', obs(4, R(1)), obs(9, R(2), { proofFromPrevious: [`${R(3)}a`] }));
add('UNDETERMINED/proof_element_is_not_a_digest', 'non-string element', obs(4, R(1)), obs(9, R(2), { proofFromPrevious: [7] }));
add('UNDETERMINED/proof_element_is_not_a_digest', 'non-hex characters', obs(4, R(1)), obs(9, R(2), { proofFromPrevious: ['z'.repeat(64)] }));
add('UNDETERMINED/proof_element_is_not_a_digest', 'proof is not a list', obs(4, R(1)), obs(9, R(2), { proofFromPrevious: R(3) }));

// ── AND DEPTH FOR THE ONES REACHED ONCE ──────────────────────────────────────────────────────
add('UNDETERMINED/root_is_not_a_digest', '63-character retained root', obs(4, R(1).slice(0, 63)), obs(9, R(2)));
add('UNDETERMINED/root_is_not_a_digest', '65-character presented root', obs(4, R(1)), obs(9, `${R(2)}a`));
// UPPERCASE HEX IS ADMITTED, NOT REFUSED — measured, and my intent was the thing that was wrong.
// This corpus expected rejection; the demonstrator accepts uppercase and lowercases it at every
// comparison. That is the SAME admission-domain divergence Coder 1 found across implementations in
// §3e, arriving here from a different direction and confirming it independently. It is declared for
// what it actually is rather than edited out of the corpus, because a vector deleted for failing is
// the defect this project exists to catch.
add('UNDETERMINED/empty_proof_for_different_sizes', 'UPPERCASE hex root is ADMITTED as a digest', obs(4, R(1).toUpperCase()), obs(9, R(2)));
add('UNDETERMINED/root_is_not_a_digest', 'root is a number', obs(4, 12345), obs(9, R(2)));
add('UNDETERMINED/root_is_not_a_digest', 'empty root', obs(4, ''), obs(9, R(2)));
add('UNDETERMINED/root_is_not_a_digest', 'root with a trailing space', obs(4, `${R(1).slice(0, 63)} `), obs(9, R(2)));

addRaw('UNDETERMINED/document_is_not_admissible', 'retained is not JSON at all — the admissibility guard now catches what parse_or_io_error used to', '{"treeSize": 4, "root": ', '{"treeSize": 9, "root": "' + R(2) + '"}');
// RECLASSIFIED, NOT DELETED. Intended for parse_or_io_error; it reaches invalid_tree_sizes,
// because the LEXICAL guard runs before json.loads and a file with no "treeSize" token fails there
// first. That is correct behaviour and a real fact about the artifact: the lexical stage SHADOWS the
// parse stage for any input missing the token. The vector stays with a corrected expectation —
// deleting a vector because it failed is the defect that made a gate go green last week.
addRaw('UNDETERMINED/document_is_not_admissible', 'presented is a bare word — admission refuses it before any size check', '{"treeSize": 4, "root": "' + R(1) + '"}', 'not-json');
addRaw('UNDETERMINED/document_is_not_admissible', 'trailing comma — also admissibility, not IO', '{"treeSize": 4, "root": "' + R(1) + '",}', '{"treeSize": 9, "root": "' + R(2) + '"}');

// ── THE THREE THAT APPEARED ONE COMMIT AFTER THIS GATE WAS WRITTEN ──────────────────────────
addRaw('UNDETERMINED/document_is_not_admissible', 'duplicate root keys',
  '{"treeSize": 4, "root": "' + R(1) + '", "root": "' + R(2) + '"}',
  '{"treeSize": 9, "root": "' + R(2) + '", "proofFromPrevious": []}');
addRaw('UNDETERMINED/document_is_not_admissible', 'duplicate treeSize keys',
  '{"treeSize": 4, "treeSize": 5, "root": "' + R(1) + '"}',
  '{"treeSize": 9, "root": "' + R(2) + '", "proofFromPrevious": []}');

// GPT'S ATTACK, NOW A REGRESSION TEST THAT THE ONE-TOKENIZER FIX HOLDS.
//
// The nested treeSize is 99 DELIBERATELY. Under the old two-reader design the regex found the first
// `treeSize` in the document — the nested one — while json.loads kept the top-level 4. With 99 the
// two readings land in DIFFERENT CLASSES: 99 > 9 is invalid_tree_sizes, 4 < 9 is a normal
// empty-proof case. So the verdict itself says which reader won, and the vector cannot pass by
// accident the way `6` did when both readings happened to reach the same class.
//
// MEASURED AT 82e275c: reaches empty_proof_for_different_sizes. The top-level value won, the nested
// one was ignored, and `readers_disagree_about_this_document` no longer exists in the source —
// the refactor deleted the guard along with the second reader it was refereeing. No vestigial
// guard was left behind, which is the thing to check after removing a mechanism.
addRaw('UNDETERMINED/empty_proof_for_different_sizes', 'nested treeSize=99 is IGNORED — one reader, and it reads the top level',
  '{"note": {"treeSize": 99}, "treeSize": 4, "root": "' + R(1) + '"}',
  '{"treeSize": 9, "root": "' + R(2) + '", "proofFromPrevious": []}');
addRaw('UNDETERMINED/empty_proof_for_different_sizes', 'nested treeSize=99 on the presented side, likewise ignored',
  '{"treeSize": 4, "root": "' + R(1) + '", "proofFromPrevious": []}',
  '{"note": {"treeSize": 99}, "treeSize": 9, "root": "' + R(2) + '", "proofFromPrevious": []}');

// ── THE SUBSTRATE DOORS: parse_or_io_error is reachable ONLY through the operating system now,
// every malformed-JSON path having been taken over by the admissibility guard. ────────────────
addRaw('UNDETERMINED/parse_or_io_error', 'retained path does not exist',
  '{"treeSize": 4, "root": "' + R(1) + '"}',
  '{"treeSize": 9, "root": "' + R(2) + '", "proofFromPrevious": []}', { deleteRetained: true });
addRaw('UNDETERMINED/input_is_not_a_regular_file', 'retained path is a DIRECTORY, not a file',
  '{"treeSize": 4, "root": "' + R(1) + '"}',
  '{"treeSize": 9, "root": "' + R(2) + '", "proofFromPrevious": []}', { retainedIsDir: true });
addRaw('UNDETERMINED/input_is_not_a_regular_file', 'presented path is a DIRECTORY',
  '{"treeSize": 4, "root": "' + R(1) + '", "proofFromPrevious": []}',
  '{"treeSize": 9, "root": "' + R(2) + '", "proofFromPrevious": []}', { presentedIsDir: true });
addRaw('UNDETERMINED/input_exceeds_size_limit', 'retained padded past the 1 MiB cap',
  '{"treeSize": 4, "root": "' + R(1) + '"}',
  '{"treeSize": 9, "root": "' + R(2) + '", "proofFromPrevious": []}', { padTo: 2_200_000 });
addRaw('UNDETERMINED/input_exceeds_size_limit', 'retained far past the cap',
  '{"treeSize": 4, "root": "' + R(1) + '"}',
  '{"treeSize": 9, "root": "' + R(2) + '", "proofFromPrevious": []}', { padTo: 5_000_000 });
addRaw('UNDETERMINED/parse_or_io_error', 'invalid UTF-8 in the retained document',
  '{"treeSize": 4, "root": "\xff\xfe' + R(1).slice(4) + '", "proofFromPrevious": []}',
  '{"treeSize": 9, "root": "' + R(2) + '", "proofFromPrevious": []}', { latin1: true });

add('UNDETERMINED/proof_field_absent', 'presented carries no proofFromPrevious', obs(4, R(1)), obs(9, R(2)));
add('UNDETERMINED/proof_field_absent', 'absent at a power-of-two retained size', obs(16, R(1)), obs(48, R(2)));


add('UNDETERMINED/empty_proof_for_different_sizes', 'explicit empty list', obs(4, R(1)), obs(9, R(2), { proofFromPrevious: [] }));

add('APPEND_ONLY/identical_trees_match', 'same size, same root', obs(5, R(1)), obs(5, R(1)));
add('APPEND_ONLY/identical_trees_match', 'same size, same root, size one', obs(1, R(7)), obs(1, R(7)));
add('OBSERVATION_CONFLICT/same_size_root_mismatch', 'same size, different roots', obs(5, R(1)), obs(5, R(2)));
add('OBSERVATION_CONFLICT/same_size_root_mismatch', 'same size, power-of-two — an accusation IS derivable here', obs(16, R(1)), obs(16, R(2)));

// ── TREE-DERIVED CLASSES ─────────────────────────────────────────────────────────────────────
if (obsFrom && proofHex) {
  const mk = (m: number, n: number, leaves: readonly string[] = LEAVES) => ({
    o: obsFrom!(LEAVES, m, 1)!, p: obsFrom!(leaves, n, 2)!, pr: proofHex!(leaves, m, n) ?? [],
  });
  for (const [m, n] of [[3, 9], [5, 21], [31, 47]]) {
    const { o, p, pr } = mk(m, n);
    add('APPEND_ONLY/valid_append_only_extension', `honest ${m}->${n}`, obs(o.treeSize, o.root), obs(p.treeSize, p.root, { proofFromPrevious: pr }));
  }
  for (const [m, n] of [[3, 9], [31, 47]]) {
    const rw = [...LEAVES]; rw[1] = H(`rewritten-${m}`);
    const { o, p, pr } = mk(m, n, rw);
    add('OBSERVATION_CONFLICT/consistency:prefix-mismatch', `genuine conflict ${m}->${n}`, obs(o.treeSize, o.root), obs(p.treeSize, p.root, { proofFromPrevious: pr }));
  }
  for (const [m, n] of [[16, 48], [32, 48]]) {
    const rw = [...LEAVES]; rw[1] = H(`rewritten-p2-${m}`);
    const { o, p, pr } = mk(m, n, rw);
    add('UNDETERMINED/POWER_OF_TWO_PREFIX_NOT_INDEPENDENTLY_DERIVABLE', `power-of-two retained ${m}`, obs(o.treeSize, o.root), obs(p.treeSize, p.root, { proofFromPrevious: pr }));
  }
  for (const [m, n] of [[3, 9], [5, 21]]) {
    const { o, p, pr } = mk(m, n);
    add('UNDETERMINED/proof_path_truncated', `truncated proof ${m}->${n}`, obs(o.treeSize, o.root), obs(p.treeSize, p.root, { proofFromPrevious: pr.slice(0, 1) }));
    add('UNDETERMINED/unconsumed_proof_elements', `one node too many ${m}->${n}`, obs(o.treeSize, o.root), obs(p.treeSize, p.root, { proofFromPrevious: [...pr, R(99)] }));
    add('UNDETERMINED/proof_did_not_connect_to_presented_head', `wrong presented root ${m}->${n}`, obs(o.treeSize, o.root), obs(p.treeSize, R(88), { proofFromPrevious: pr }));
  }
}

// ══ RUN AND MEASURE ═════════════════════════════════════════════════════════════════════════
const reached = new Map<string, Set<string>>();
const mismatches: string[] = [];
for (const [i, v] of V.entries()) {
  const rp = join(LAB, `r${i}.json`);
  const pp = join(LAB, `p${i}.json`);
  writeFileSync(rp, v.rawRetained ?? JSON.stringify(v.retained), v.latin1 ? 'latin1' : 'utf8');
  writeFileSync(pp, v.rawPresented ?? JSON.stringify(v.presented));
  if (v.deleteRetained) rmSync(rp, { force: true });
  if (v.retainedIsDir) { rmSync(rp, { force: true }); mkdirSync(rp, { recursive: true }); }
  if (v.presentedIsDir) { rmSync(pp, { force: true }); mkdirSync(pp, { recursive: true }); }
  if (v.padTo) writeFileSync(rp, (v.rawRetained ?? '') + ' '.repeat(v.padTo));
  const r = Bun.spawnSync(['python3', SUBJECT, rp, pp], { stdout: 'pipe', stderr: 'pipe' });
  const out = r.stdout.toString();
  const verdict = (out.match(/VERDICT:\s*(\S+)/) ?? [])[1];
  const reason = (out.match(/REASON\s*:\s*(\S+)/) ?? [])[1];
  const actual = verdict && reason ? `${verdict}/${reason}` : 'NO_VERDICT_PRINTED';
  if (!reached.has(actual)) reached.set(actual, new Set());
  // Distinctness is by the BYTES, so two labels over one input do not inflate a denominator.
  // DISTINCTNESS BY BYTES ALONE WAS BLIND TO THE FILESYSTEM. A missing path and a directory carry
  // IDENTICAL content and are genuinely different inputs; hashing only the bytes counted them as
  // one and left parse_or_io_error sitting at a denominator of one. The instrument could not see
  // the axis the input varied on — this month's law, arriving inside the metric that measures it.
  const shape = `${v.latin1 ? 'L' : ''}${v.deleteRetained ? 'D' : ''}${v.retainedIsDir ? 'X' : ''}${v.presentedIsDir ? 'P' : ''}${v.padTo ?? ''}`;
  reached.get(actual)!.add(H(`${v.rawRetained ?? JSON.stringify(v.retained)}|${v.rawPresented ?? JSON.stringify(v.presented)}|${shape}`));
  if (actual !== v.forClass) mismatches.push(`${v.label}: intended ${v.forClass}, reached ${actual}`);
}

console.log(`  ── ${V.length} inputs over ${CLASSES.length} declared classes`);
let zero = 0;
let single = 0;
for (const c of CLASSES) {
  const n = reached.get(c)?.size ?? 0;
  if (n === 0) zero++;
  else if (n === 1) single++;
  const tag = n === 0 ? 'FAIL' : n === 1 ? 'thin' : 'ok  ';
  console.log(`  ${tag}  ${String(n).padStart(2)} distinct input(s)   ${c}`);
}

// ══ THE PARTITION MUST BE FALSIFIABLE BY OBSERVATION ════════════════════════════════════════
//
// A PARTITION READ FROM SOURCE GOES STALE THE MOMENT SOURCE MOVES — and it did, within one commit:
// three verdicts appeared in main() that this file's extraction had never seen. Re-deriving more
// often does not fix that, because the failure is not staleness, it is that MY EXTRACTOR IS A
// SECOND READER OF THE ARTIFACT'S STRUCTURE. Two readers of one document is the exact defect that
// bit the lexical guard: a regex and a parser disagreeing about the same bytes.
//
// I cannot remove the second reader — the artifact does not publish its own partition, and adding
// a --classes flag is another lane's file. So the reader is made FALSIFIABLE instead: if a run ever
// observes a class the extraction did not predict, that is a hole in the partition and it is RED,
// by name. The corpus becomes the thing that checks the extractor, rather than trusting it.
const unpredicted = [...reached.keys()].filter((c) => c !== 'NO_VERDICT_PRINTED' && !CLASSES.includes(c));
gate(unpredicted.length === 0,
  'RED: every class OBSERVED was PREDICTED by the partition — the extractor is checked by the run',
  unpredicted.join(', ') || `${CLASSES.length} predicted, ${reached.size} observed, no surprises`);
note('This is the cure for a partition that goes stale. It cannot stop the extractor missing a');
note('shape — it makes the miss LOUD the first time an input reaches the shape, instead of silent');
note('until somebody re-reads the source. An extractor that cannot be surprised is not checked.');

gate(zero === 0, 'EVERY declared class is constructed by at least one input', `${zero} class(es) with a denominator of zero`);
gate(mismatches.length === 0, 'and every input reaches the class it was written for',
  mismatches.length ? mismatches.slice(0, 4).join(' | ') : `${V.length}/${V.length} as intended`);
note(`${single} class(es) still have a denominator of ONE. Reached is not explored, and this gate`);
note('reports the difference rather than rounding it up to coverage.');

console.log('\n  ── what this closes, and what it does not');
note('CLOSED: the four classes nothing reached. All four turned out to be hand-written literals —');
note('m == 0, m > n, a same-size pair carrying a proof, a 63-character proof element. NOT hard, and');
note('not needing a tree generator: they were OUTSIDE THE RANGE OF THE MACHINE THAT MAKES CELLS.');
note('Every corpus here builds observations from real trees, and a real tree cannot be zero-sized,');
note('cannot exceed the tree that extends it, and cannot carry a proof to itself. Same shape as');
note('m == n being invisible to 546 vectors: not an oversight, a generator\'s reachable universe.');
note('');
note('NOT CLOSED: a denominator is not a measure of adversarial depth. Six distinct malformed roots');
note('is better than one and is still six things I thought of. The corpus is authored by the same');
note('mind that authored the lane, which is exactly the limit the outside attackers exist to cover.');
note('');
note('AND THE PARTITION STILL ONLY NAMES WHAT THE ARTIFACT DISTINGUISHES. If the demonstrator does');
note('not branch on a condition, no class exists for it and this gate is silent about it — which is');
note('how a 63-character root hid before there was a branch to name it.');

rmSync(LAB, { recursive: true, force: true });
console.log('');
console.log(failures ? `peer-class-corpus: ${failures} failure(s)` : `peer-class-corpus: ${CLASSES.length}/${CLASSES.length} classes constructed, ${V.length} inputs`);
process.exit(failures ? 1 : 0);
