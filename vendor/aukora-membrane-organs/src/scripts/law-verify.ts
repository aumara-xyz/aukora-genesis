// scripts/law-verify.ts — the verify.sh gate for the law/effect boundary (specs/0012, issue #13).
//
// Drives hooks/law.ts DIRECTLY, in a throwaway sandbox (CRUSH_PROJECT_DIR pointed at a mkdtemp),
// so the real chain is never touched by a test. Every acceptance test and mutation control from
// the issue runs here. Exit 0 = the boundary is coherent; exit 1 = named failure.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { walkChain } from '../core/aura-chain';
import { TCB_PATHS } from '../core/tcb';
import {
  tmpKeyHome, startSignService, installTeardown, teardown, assertHermeticKeyHome,
  stateRootBaseline, stateRootHarnessChecks, stateRootLeakChecks,
} from './verify-harness';

const HOOK = join(process.cwd(), 'hooks', 'law.ts');

let failures = 0;
const fail = (msg: string) => { console.error(`  FAIL  ${msg}`); failures++; };
const pass = (msg: string) => console.log(`  ok    ${msg}`);

// State-root leak accounting lives in scripts/verify-harness.ts — one home, three
// callers. The two-counter design (readdirSync AND a shelled ls) is documented there;
// it is why a blinded counter cannot report a clean run.
const ROOTS_BEFORE = stateRootBaseline();

interface Line {
  stage?: string; decision?: string; outcome?: string; reason?: string; call?: string;
  tool?: string; path?: string; epochCommitment?: string; prevEpochCommitment?: string;
}

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'law-gate-'));
  // The disposable state root is created STRUCTURALLY, inside the sandbox it belongs to, so it
  // dies with the sandbox instead of outliving it under the owner's home. Every membrane spawn
  // below is handed it explicitly — a child that has to infer its state home from wherever it
  // happens to be standing is the whole defect.
  const state = join(dir, 'state');
  mkdirSync(state, { recursive: true });
  return {
    dir,
    state,
    /** Env for any spawn in this sandbox that runs membrane code. The injection is not optional
     *  and not defaulted: it is here so no call site can forget it. */
    env(extra: Record<string, string> = {}): Record<string, string> {
      return { ...process.env as Record<string, string>, AUKORA_STATE_ROOT: state, ...extra };
    },
    run(tool: string, input: { path?: string; command?: string }, extraEnv: Record<string, string> = {}): number {
      const env: Record<string, string> = this.env({
        CRUSH_PROJECT_DIR: dir,
        CRUSH_TOOL_NAME: tool,
        CRUSH_TOOL_INPUT_FILE_PATH: input.path ?? '',
        CRUSH_TOOL_INPUT_COMMAND: input.command ?? '',
        ...extraEnv,
      });
      let r: ReturnType<typeof Bun.spawnSync> | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          r = Bun.spawnSync(['bun', 'run', HOOK], { env, stdout: 'pipe', stderr: 'pipe' });
          break;
        } catch (err: unknown) {
          if ((err as { code?: string })?.code === 'EAGAIN' && attempt < 2) {
            Bun.sleepSync(50);
            continue;
          }
          throw err;
        }
      }
      return r ? r.exitCode : 1;
    },
    lines(): Line[] {
      const f = join(dir, '.aukora', 'aura-chain.jsonl');
      if (!existsSync(f)) return [];
      return readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    },
    cleanup() { rmSync(dir, { recursive: true, force: true }); },
  };
}

// ── THE TEST SIGN SERVICE (specs/0017) ──
// law.ts signs through the service on loopback, so the gate boots one of its own: a throwaway
// key home, a scratch port, killed at the end. Nothing here touches the real node key.
const TEST_KEYS = tmpKeyHome('law-gate-keys-');
process.env.AUKORA_MEMBRANE_KEYS = TEST_KEYS;
assertHermeticKeyHome('law-verify');
installTeardown();
// Dynamic free port + fail-closed health wait, and guaranteed teardown on every exit path
// (verify-harness). A stale leftover on a fixed port (measured 2026-08-04) made every receipt
// look like "sign service unreachable" against the wrong key home.
const { port: SIGN_PORT, url: SIGN_URL } = await startSignService(TEST_KEYS, 'law-verify');
process.env.AUKORA_SIGN_URL = SIGN_URL;
process.env.AUKORA_SIGN_PORT = String(SIGN_PORT);

// ── Acceptance 1: bash that touches a file → pre (authorized) → post (outcome) ──
{
  const S = sandbox();
  const e1 = S.run('bash', { command: 'echo hi > a.txt' });
  writeFileSync(join(S.dir, 'a.txt'), 'hi\n');
  const e2 = S.run('bash', { command: 'true' }); // settles the first
  const lines = S.lines();
  const pre = lines.find((l) => l.stage === 'pre' && l.tool === 'bash');
  const post = lines.find((l) => l.stage === 'post' && l.call === pre?.call);
  if (e1 === 0 && e2 === 0 && pre?.decision === 'allowed' && post) {
    pass(`bash: pre-effect receipt (allowed) and post-effect receipt (${post.outcome}) — bash outcomes are honestly 'unavailable' to a PreToolUse hook`);
    if (post.outcome !== 'unavailable') fail(`bash post-effect outcome should be 'unavailable', got '${post.outcome}'`);
  } else {
    fail(`bash two-stage receipts missing (exits ${e1}/${e2})`);
  }
  S.cleanup();
}

// ── Acceptance 2: a file tool → same two receipts; outcome reflects reality ──
{
  const S = sandbox();
  writeFileSync(join(S.dir, 'a.txt'), 'before\n');
  const e1 = S.run('edit', { path: join(S.dir, 'a.txt') });
  writeFileSync(join(S.dir, 'a.txt'), 'after\n'); // the tool would have done this
  S.run('bash', { command: 'true' }); // settles
  const lines = S.lines();
  const pre = lines.find((l) => l.stage === 'pre' && l.tool === 'edit');
  const post = lines.find((l) => l.stage === 'post' && l.call === pre?.call);
  if (e1 === 0 && pre?.decision === 'allowed' && post?.outcome === 'succeeded') {
    pass('edit: pre (allowed) → post (succeeded) — digest moved, the write landed');
  } else {
    fail(`edit two-stage receipts wrong: pre=${pre?.decision} post=${post?.outcome}`);
  }
  S.cleanup();
}

// ── Acceptance 3 + mutation control: a refused call → pre (refused), NO post, no effect ──
{
  const S = sandbox();
  const before = S.lines().length;
  const e1 = S.run('bash', { command: 'rm -rf /' });
  S.run('bash', { command: 'true' }); // would settle a prior allowed call; nothing is staged
  const lines = S.lines();
  const pre = lines.find((l) => l.decision === 'refused');
  const post = lines.find((l) => l.stage === 'post' && l.call === pre?.call);
  if (e1 === 2 && pre && !post && pre.reason?.startsWith('law:destructive-command')) {
    pass(`refused bash: pre-effect receipt says refused (${pre.reason}), no post-effect receipt, exit 2, nothing executed`);
  } else {
    fail(`refused bash: exit=${e1} pre=${pre?.decision} post=${post ? 'EXISTS (wrong)' : 'none'}`);
  }
  if (lines.length === before + 0) fail('refusal produced NO receipt at all — a refusal must be witnessed');
  S.cleanup();
}

// ── Mutation control: a staged write that never lands settles as 'failed' ──
{
  const S = sandbox();
  writeFileSync(join(S.dir, 'b.txt'), 'same\n');
  S.run('write', { path: join(S.dir, 'b.txt') });
  S.run('bash', { command: 'true' }); // settles; the file was never touched
  const post = S.lines().find((l) => l.stage === 'post' && l.tool === 'write');
  if (post?.outcome === 'failed') {
    pass("a write that moved nothing settles as outcome 'failed' — allowed did NOT silently mean completed");
  } else {
    fail(`stalled write should settle as 'failed', got '${post?.outcome}'`);
  }
  S.cleanup();
}

// ── Law classes: outside-repo and protected-path refusals are named ──
{
  const S = sandbox();
  const e1 = S.run('edit', { path: join(S.dir, '..', 'outside.txt') });
  const e2 = S.run('edit', { path: join(S.dir, 'BRICK-LEDGER.md') });
  const lines = S.lines();
  const outside = lines.find((l) => l.reason === 'law:outside-repo');
  const prot = lines.find((l) => l.reason?.startsWith('law:protected-path'));
  if (e1 === 2 && e2 === 2 && outside && prot) {
    pass('law names its refusals: law:outside-repo and law:protected-path (BRICK-LEDGER.md), both exit 2');
  } else {
    fail(`law classes wrong: exits ${e1}/${e2}, outside=${outside?.reason} protected=${prot?.reason}`);
  }
  S.cleanup();
}

// ── Acceptance 4+5+6: one chain, linkage, pre-for-every-call, poverty ──
{
  const S = sandbox();
  const calls = [
    S.run('bash', { command: 'echo x > f.txt' }),
    S.run('write', { path: join(S.dir, 'f.txt') }),
    S.run('edit', { path: join(S.dir, '.git', 'config') }),
    S.run('bash', { command: 'true' }),
  ];
  const lines = S.lines();
  const pres = lines.filter((l) => l.stage === 'pre');
  const verdict = walkChain(S.dir);
  if (pres.length === calls.length) {
    pass(`no tool call produced zero receipts: ${calls.length} calls, ${pres.length} pre-effect receipts`);
  } else {
    fail(`receipt gap: ${calls.length} calls but ${pres.length} pre-effect receipts`);
  }
  if (verdict.ok && verdict.count === lines.length) {
    pass(`one chain: all ${lines.length} receipts link via prevEpochCommitment and every commitment recomputes`);
  } else {
    fail(`sandbox chain broken: ${verdict.breakReason}`);
  }
  // Post receipts pair only with allowed pres; refused pres have no post.
  const refusedPres = pres.filter((l) => l.decision === 'refused');
  const orphans = lines.filter((l) => l.stage === 'post' && refusedPres.some((r) => r.call === l.call));
  if (orphans.length === 0) pass('no refused call carries an outcome — nothing executed, nothing recorded as executed');
  else fail(`${orphans.length} post-effect receipt(s) hang off refused calls`);
  S.cleanup();
}

// ── Mutation control: tamper with the chain and the walk must name the line ──
{
  const S = sandbox();
  S.run('bash', { command: 'echo x > f.txt' });
  S.run('bash', { command: 'true' });
  const file = join(S.dir, '.aukora', 'aura-chain.jsonl');
  const raw = readFileSync(file, 'utf8');
  const flipped = raw.replace(/"epochCommitment":"([0-9a-f])/, (m, c) =>
    `"epochCommitment":"${c === 'a' ? 'b' : 'a'}`);
  if (flipped === raw) fail('tamper control could not flip a hex char (chain shape changed?)');
  else {
    writeFileSync(file, flipped);
    const v = walkChain(S.dir);
    if (!v.ok && v.breakReason) pass(`tampered chain caught: ${v.breakReason}`);
    else fail('a flipped hex char in the chain was NOT caught');
  }
  S.cleanup();
}

// ── VAULT (specs/0013): the pointer resolves, and survives the overwrite ──
import { vaultGet, vaultHas, VAULT_DIR } from '../core/vault';
import { appendFileSync } from 'node:fs';

{
  const S = sandbox();
  // Acceptance 1: a write settles into a vaulted receipt.
  S.run('write', { path: join(S.dir, 'doc.txt') });
  writeFileSync(join(S.dir, 'doc.txt'), 'the first bytes\n');
  S.run('bash', { command: 'true' }); // settles
  const post1 = S.lines().find((l: any) => l.stage === 'post' && l.tool === 'write') as any;
  if (post1?.vaultKey && vaultHas(S.dir, post1.vaultKey)
      && vaultGet(S.dir, post1.vaultKey)?.toString() === 'the first bytes\n'
      && post1.vaultKey === post1.contentDigestAfter) {
    pass('vault: write settles with a vaultKey, the vault holds the exact bytes, the key is the digest');
  } else {
    fail(`vault: first write wrong — vaultKey=${post1?.vaultKey?.slice(0, 16)} resolves=${post1 ? vaultHas(S.dir, post1.vaultKey) : 'no post'}`);
  }

  // Acceptance 2: overwrite. The old entry persists; the old receipt still verifies.
  const oldKey = post1?.vaultKey;
  S.run('edit', { path: join(S.dir, 'doc.txt') });
  writeFileSync(join(S.dir, 'doc.txt'), 'the second bytes — longer\n');
  S.run('bash', { command: 'true' }); // settles the edit
  const post2 = S.lines().filter((l: any) => l.stage === 'post').pop() as any;
  if (post2?.vaultKey && post2.vaultKey !== oldKey && vaultHas(S.dir, oldKey)
      && vaultGet(S.dir, oldKey)?.toString() === 'the first bytes\n'
      && vaultGet(S.dir, post2.vaultKey)?.toString() === 'the second bytes — longer\n') {
    pass('vault: overwrite mints a new pointer; the old entry persists and the old receipt still proves its bytes');
  } else {
    fail(`vault: overwrite semantics wrong — old resolves=${oldKey ? vaultHas(S.dir, oldKey) : '?'}`);
  }

  // Acceptance 5: forgetting a chain line leaves the vault untouched (append-only).
  const chainFile = join(S.dir, '.aukora', 'aura-chain.jsonl');
  const kept = S.lines().slice(1); // "forget" the first line
  writeFileSync(chainFile, kept.map((l) => JSON.stringify(l)).join('\n') + '\n');
  if (vaultHas(S.dir, oldKey)) pass('vault: forgetting a chain line does not touch the vault — it is append-only by structure');
  else fail('vault: an entry vanished when a chain line was removed');
  S.cleanup();
}

// ── Vault mutation controls: tampered bytes and a deleted entry are caught BY NAME ──
{
  const S = sandbox();
  S.run('write', { path: join(S.dir, 'doc.txt') });
  writeFileSync(join(S.dir, 'doc.txt'), 'witness me\n');
  S.run('bash', { command: 'true' });
  const post = S.lines().find((l: any) => l.stage === 'post') as any;

  // Tamper one vault byte.
  const objectAt = join(VAULT_DIR(S.dir), post.vaultKey);
  writeFileSync(objectAt, 'witness YOU\n');
  const bytes = vaultGet(S.dir, post.vaultKey);
  const { sha256hex } = await import('../core/vault');
  if (bytes && sha256hex(bytes) !== post.vaultKey) {
    pass('vault mutation: a tampered object no longer hashes to its key — detectable by name');
  } else {
    fail('vault mutation: tampered bytes still matched the key');
  }

  // Delete the entry: the pointer dangles loudly.
  rmSync(objectAt);
  if (!vaultHas(S.dir, post.vaultKey)) pass('vault mutation: a deleted entry leaves the pointer dangling — detectable as missing');
  else fail('vault mutation: deleted entry still reported present');
  S.cleanup();
}

// ── PAYLOAD BINDING (specs/0014): no field can be swapped, mutated, or deleted undetected ──
{
  // Helper: build a fresh sandbox with two vaulted receipts (different files, different keys).
  const boundSandbox = () => {
    const S = sandbox();
    S.run('write', { path: join(S.dir, 'a.txt') });
    writeFileSync(join(S.dir, 'a.txt'), 'payload A\n');
    S.run('write', { path: join(S.dir, 'b.txt') });
    writeFileSync(join(S.dir, 'b.txt'), 'payload B\n');
    S.run('bash', { command: 'true' }); // settles the second write
    return S;
  };
  const mutateChain = (S: ReturnType<typeof sandbox>, fn: (lines: any[]) => any[]) => {
    const file = join(S.dir, '.aukora', 'aura-chain.jsonl');
    const mutated = fn(readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
    writeFileSync(file, mutated.map((l) => JSON.stringify(l)).join('\n') + '\n');
  };

  // Sanity: an untouched bound chain verifies.
  {
    const S = boundSandbox();
    const v = walkChain(S.dir);
    if (v.ok) pass('payload binding: a fresh bound chain verifies (sanity)');
    else fail(`payload binding: a FRESH bound chain failed — ${v.breakReason}`);
    S.cleanup();
  }

  // Valid-key-swap: receipt A's vaultKey replaced with receipt B's VALID key.
  {
    const S = boundSandbox();
    mutateChain(S, (lines) => {
      const posts = lines.filter((l) => l.stage === 'post' && l.vaultKey);
      const target = posts[0];
      const donor = posts.find((p) => p.vaultKey !== target.vaultKey);
      target.vaultKey = donor.vaultKey;
      return lines;
    });
    const v = walkChain(S.dir);
    if (!v.ok && /payloadDigest/.test(v.breakReason || '')) {
      pass(`payload binding: valid-key-swap caught — ${v.breakReason}`);
    } else {
      fail('payload binding: a vaultKey swapped for ANOTHER VALID KEY verified — the hole GPT named is still open');
    }
    S.cleanup();
  }

  // Field mutations: decision flipped, path changed, payloadDigest itself tampered.
  for (const [name, fn] of [
    ['decision allowed→refused', (l: any) => { if (l.stage === 'pre' && l.decision === 'allowed') l.decision = 'refused'; }],
    ['path swapped', (l: any) => { if (l.stage === 'pre' && l.path) l.path = 'somewhere/else.txt'; }],
    ['payloadDigest tampered', (l: any) => { if (l.payloadDigest) l.payloadDigest = '0'.repeat(64); }],
  ] as const) {
    const S = boundSandbox();
    mutateChain(S, (lines) => { lines.forEach(fn); return lines; });
    const v = walkChain(S.dir);
    if (!v.ok && /payloadDigest|epochCommitment|link/.test(v.breakReason || '')) {
      pass(`payload binding: mutation '${name}' fails verification (${(v.breakReason || '').split(':')[0]})`);
    } else {
      fail(`payload binding: mutation '${name}' did NOT fail verification`);
    }
    S.cleanup();
  }

  // Backward compatibility: a receipt with no payloadDigest still verifies (legacy lane).
  {
    const S = boundSandbox();
    // True legacy shape predates BOTH binding layers: no payloadDigest AND no signature.
    // (Deleting the digest while leaving the signature must and does fail — the signature
    // lane catches that, as the signature-mutation gates below prove.)
    mutateChain(S, (lines) => { delete lines[0].payloadDigest; delete lines[0].signatureKey; delete lines[0].algorithm; return lines; });
    const v = walkChain(S.dir);
    if (v.ok) pass('payload binding: a legacy receipt (no payloadDigest) still verifies');
    else fail(`payload binding: legacy receipt broke the walk — ${v.breakReason}`);
    S.cleanup();
  }
}

// ── SIGNATURES (specs/0015): ML-DSA-65 + Ed25519 hybrid, fail-closed ──
import { keygenFromSeed, hybridSign, hybridVerify, loadNodeSeed } from '../core/pqc';
import { randomBytes } from 'node:crypto';

const mutateChain = (S: ReturnType<typeof sandbox>, fn: (lines: any[]) => any[]) => {
  const file = join(S.dir, '.aukora', 'aura-chain.jsonl');
  const mutated = fn(readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  writeFileSync(file, mutated.map((l) => JSON.stringify(l)).join('\n') + '\n');
};

{
  // Keygen determinism — the property AUMLOK binds on.
  const seed = randomBytes(32);
  const a = keygenFromSeed(seed);
  const b = keygenFromSeed(seed);
  if (Buffer.from(a.mlDsa65.publicKey).equals(Buffer.from(b.mlDsa65.publicKey))
      && Buffer.from(a.ed25519.publicKey).equals(Buffer.from(b.ed25519.publicKey))) {
    pass('signature: keygen is deterministic from seed — same 32 bytes, same keys, twice');
  } else {
    fail('signature: keygen is NOT deterministic from seed');
  }

  // Hybrid bundle: verifies, and a single half cannot pass alone.
  const bundle = hybridSign('a'.repeat(64), a);
  if (hybridVerify(bundle, 'a'.repeat(64), { mlDsa65: a.mlDsa65.publicKey, ed25519: a.ed25519.publicKey })) {
    pass('signature: hybrid bundle (ML-DSA-65 + Ed25519) verifies');
  } else {
    fail('signature: a freshly minted hybrid bundle did NOT verify');
  }
  // ── BOTH HALVES, SEPARATELY, AND THE ASYMMETRY THAT USED TO BE HERE ──────────────────────────
  //
  // This block forged only the Ed25519 half. That proves Ed25519 is required and says NOTHING about
  // ML-DSA-65 — which is the half the post-quantum claim rests on, and the only half an adversary
  // with a quantum computer cares about.
  //
  // MEASURED, not reasoned: hybridVerify's `return mlOk && edOk` was rewritten to `return edOk` —
  // the exact shape of a post-quantum downgrade — and this gate scored 57 ok, exit 0, byte-identical
  // to its baseline. The line it printed while a downgrade path existed was the line below that used
  // to read "no downgrade path exists". An assertion whose own words the mutant falsifies is the
  // naming-is-not-doing defect wearing a control's clothes.
  //
  // Nothing else in the repo forges the mlDsa65 field. This was the only place it could have been
  // caught, and it was one string literal away from catching it.
  const brokenEd = { ...bundle, ed25519: 'ff'.repeat(64) };
  if (!hybridVerify(brokenEd, 'a'.repeat(64), { mlDsa65: a.mlDsa65.publicKey, ed25519: a.ed25519.publicKey })) {
    pass('signature: a broken Ed25519 half fails — the classical half is required');
  } else {
    fail('signature: a bundle with a broken Ed25519 half verified');
  }
  const brokenMl = { ...bundle, mlDsa65: 'ff'.repeat(bundle.mlDsa65.length / 2) };
  if (!hybridVerify(brokenMl, 'a'.repeat(64), { mlDsa65: a.mlDsa65.publicKey, ed25519: a.ed25519.publicKey })) {
    pass('signature: a broken ML-DSA-65 half fails — the POST-QUANTUM half is required, no downgrade path');
  } else {
    fail('signature: a broken ML-DSA-65 half VERIFIED — hybridVerify has a post-quantum downgrade path');
  }
  const emptyMl = { ...bundle, mlDsa65: '' };
  if (!hybridVerify(emptyMl, 'a'.repeat(64), { mlDsa65: a.mlDsa65.publicKey, ed25519: a.ed25519.publicKey })) {
    pass('signature: an ABSENT ML-DSA-65 half fails — a missing post-quantum signature is not a passing one');
  } else {
    fail('signature: a bundle with NO ML-DSA-65 signature verified');
  }

  const signedSandbox = () => {
    const S = sandbox();
    S.run('write', { path: join(S.dir, 'a.txt') });
    writeFileSync(join(S.dir, 'a.txt'), 'signed bytes\n');
    S.run('bash', { command: 'true' });
    return S;
  };

  // Acceptance 1: every new receipt carries a signatureKey and the walk verifies it.
  {
    const S = signedSandbox();
    const v = walkChain(S.dir);
    const signed = S.lines().filter((l: any) => l.signatureKey);
    if (v.ok && signed.length >= 3) {
      pass(`signature: ${signed.length} receipts signed; the walk verified every bundle against its payloadDigest`);
    } else {
      fail(`signature: fresh signed chain failed — ${v.breakReason ?? `only ${signed.length} signed receipts`}`);
    }
    S.cleanup();
  }

  // Mutation: tampered payload → the digest AND the signature both fail.
  {
    const S = signedSandbox();
    mutateChain(S, (lines) => { const p = lines.find((l) => l.stage === 'pre'); p.path = 'elsewhere.txt'; return lines; });
    const v = walkChain(S.dir);
    if (!v.ok) pass(`signature: tampered payload fails (${(v.breakReason || '').slice(0, 60)}…)`);
    else fail('signature: a tampered payload passed a signed chain');
    S.cleanup();
  }

  // Mutation: signature swapped from another receipt → bundle message mismatch.
  {
    const S = signedSandbox();
    mutateChain(S, (lines) => {
      const signed = lines.filter((l) => l.signatureKey);
      const t = signed[0].signatureKey;
      signed[0].signatureKey = signed[1].signatureKey;
      signed[1].signatureKey = t;
      return lines;
    });
    const v = walkChain(S.dir);
    if (!v.ok && /signature/.test(v.breakReason || '')) {
      pass(`signature: a swapped signature fails — bundles are bound to their own receipt's digest`);
    } else {
      fail(`signature: a swapped signature ${v.ok ? 'PASSED' : 'failed for the wrong reason: ' + v.breakReason}`);
    }
    S.cleanup();
  }

  // Mutation: wrong key — verification uses ONLY the pinned pub file, so a different key home
  // means a different verdict. Walk the same sandbox chain in a subprocess pointed at a fresh
  // key home: every signed receipt must fail.
  {
    const S = signedSandbox();
    const altKeys = mkdtempSync(join(tmpdir(), 'law-gate-altkeys-'));
    const r = Bun.spawnSync(['bun', '-e', `
      process.env.AUKORA_MEMBRANE_KEYS = '${altKeys}';
      const { loadNodeSeed } = await import('${process.cwd()}/core/pqc.ts');
      loadNodeSeed(); // mint the WRONG key + its pub file
      const { walkChain } = await import('${process.cwd()}/core/aura-chain.ts');
      const v = walkChain('${S.dir}');
      console.log(v.ok, v.breakReason ?? '');
    `], { env: S.env(), stdout: 'pipe', stderr: 'pipe' });
    const out = new Response(r.stdout).toString?.() ?? '';
    const text = Buffer.from(r.stdout).toString();
    if (/^false .*signature/m.test(text)) {
      pass('signature: under a different pinned pub, every receipt fails (verification needs only the public key)');
    } else {
      fail(`signature: wrong-key walk printed ${JSON.stringify(text.slice(0, 120))}`);
    }
    rmSync(altKeys, { recursive: true, force: true });
    S.cleanup();
  }

  // Mutation: invalid bundle format in the vault → fail, not exception.
  {
    const S = signedSandbox();
    const key = (S.lines().find((l: any) => l.signatureKey) as any).signatureKey;
    const { VAULT_DIR } = await import('../core/vault');
    writeFileSync(join(VAULT_DIR(S.dir), key), 'not json at all');
    const v = walkChain(S.dir);
    if (!v.ok && /signature/.test(v.breakReason || '')) {
      pass('signature: an invalid bundle format fails cleanly');
    } else {
      fail(`signature: invalid bundle ${v.ok ? 'PASSED' : 'failed wrong: ' + v.breakReason}`);
    }
    S.cleanup();
  }

  // Legacy: a receipt with no signatureKey still verifies.
  {
    const S = signedSandbox();
    mutateChain(S, (lines) => { delete lines[0].signatureKey; delete lines[0].algorithm; return lines; });
    const v = walkChain(S.dir);
    if (v.ok) pass('signature: a legacy (unsigned) receipt still verifies');
    else fail(`signature: legacy unsigned receipt broke the walk — ${v.breakReason}`);
    S.cleanup();
  }

  // DOWNGRADE (specs/0016): after activation, an unsigned receipt is a break, not a legacy.
  {
    const S = signedSandbox();
    mutateChain(S, (lines) => { delete lines[2].signatureKey; delete lines[2].algorithm; return lines; });
    const v = walkChain(S.dir);
    if (!v.ok && /downgrade/.test(v.breakReason || '')) {
      pass(`downgrade: deleting signature fields off a signed-chain receipt fails — ${v.breakReason?.slice(0, 52)}…`);
    } else {
      fail(`downgrade: ${v.ok ? 'an unsigned receipt AFTER activation passed' : 'wrong reason: ' + v.breakReason}`);
    }
    S.cleanup();
  }

  // FLUSH (specs/0016): after a turn ends, nothing stays staged.
  {
    const S = signedSandbox();
    // #80: staging moved from ONE law-pending.json slot to a law-pending/ directory of one file
    // per call, because a single slot lost N-1 receipts per batch of N parallel tool calls. The
    // PROPERTY this gate asserts is unchanged — "after a turn ends, nothing stays staged" — so it
    // now reads BOTH locations. It is still able to fail: leave an entry staged and it does.
    const pendingFile = join(S.dir, '.aukora', 'law-pending.json');
    const pendingDir = join(S.dir, '.aukora', 'law-pending');
    const stagedCount = (): number => {
      let n = 0;
      try { if (readFileSync(pendingFile, 'utf8').trim() !== 'null') n += 1; } catch { /* absent is not staged */ }
      try { n += readdirSync(pendingDir).filter((f) => f.endsWith('.json')).length; } catch { /* absent is not staged */ }
      return n;
    };
    const stagedBefore = stagedCount() > 0;
    const r = Bun.spawnSync(['bun', 'run', HOOK, '--flush'], {
      env: S.env({ CRUSH_PROJECT_DIR: S.dir }),
      stdout: 'pipe', stderr: 'pipe',
    });
    const afterCount = stagedCount();
    if (stagedBefore && r.exitCode === 0 && afterCount === 0) {
      pass('flush: --flush settles every staged receipt — nothing staged in file or directory at turn end');
    } else {
      fail(`flush: staged-before=${stagedBefore} exit=${r.exitCode} staged-after=${afterCount}`);
    }
    S.cleanup();
  }

  // VAULT PRUNE (specs/0016): old unreferenced objects go; referenced objects are untouchable.
  {
    const S = signedSandbox();
    const { pruneVault, VAULT_DIR } = await import('../core/vault');
    const referenced = (S.lines().find((l: any) => l.vaultKey) as any).vaultKey;
    // Age everything in the vault past the cutoff.
    const dir = VAULT_DIR(S.dir);
    const { utimesSync } = await import('node:fs');
    const old = new Date(Date.now() - 31 * 86400_000);
    for (const n of readdirSync(dir)) { try { utimesSync(join(dir, n), old, old); } catch {} }
    // Plant an unreferenced old object.
    const { vaultPut } = await import('../core/vault');
    const orphan = vaultPut(S.dir, Buffer.from('orphan bytes'));
    utimesSync(join(dir, orphan), old, old);
    const before = walkChain(S.dir);
    const pruned = pruneVault(S.dir, 30);
    const after = walkChain(S.dir);
    if (pruned.removed === 1 && after.ok && before.ok && vaultHas(S.dir, referenced)) {
      pass('vault prune: old unreferenced object removed, referenced object kept, walk still green');
    } else {
      fail(`vault prune: removed=${pruned.removed} walk-ok=${after.ok} referenced-kept=${vaultHas(S.dir, referenced)}`);
    }
    S.cleanup();
  }
}

// ── THE SIGN SERVICE ITSELF (specs/0017) ──
{
  // Roundtrip through the live test service. specs/0021: /sign answers Bearer holders of the
  // key home's sign-token only — the gate reads the THROWAWAY home's token, never the real one.
  const { loadSignToken } = await import('../core/pqc');
  const auth = { authorization: `Bearer ${loadSignToken()}` };
  const digest = 'ab'.repeat(32);
  const sr = await fetch(`${process.env.AUKORA_SIGN_URL}/sign`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ payload: digest }),
  });
  const sj = await sr.json() as any;
  const vr = await fetch(`${process.env.AUKORA_SIGN_URL}/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: digest, bundle: sj.bundle }),
  });
  const vj = await vr.json() as any;
  if (sr.ok && vj.valid === true) pass('service: /sign → /verify roundtrip valid');
  else fail(`service roundtrip failed: sign=${sr.status} verify=${JSON.stringify(vj).slice(0, 80)}`);

  // Malformed sign request → 400, not a signature.
  const mr = await fetch(`${process.env.AUKORA_SIGN_URL}/sign`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ payload: 'not a digest' }),
  });
  if (mr.status === 400) pass('service: a non-digest payload is refused (400) — the oracle is narrowed to receipt shapes');
  else fail(`service: malformed payload returned ${mr.status}`);

  // An invalid bundle from anywhere fails verification.
  const bad = { ...(sj.bundle || {}), ed25519: 'ff'.repeat(64) };
  const br = await fetch(`${process.env.AUKORA_SIGN_URL}/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: digest, bundle: bad }),
  });
  const bj = await br.json() as any;
  if (bj.valid === false) pass('service: an invalid bundle verifies as false, not as an exception');
  else fail(`service: invalid bundle → ${JSON.stringify(bj).slice(0, 80)}`);

  // Key custody: 0600, outside the repo root.
  const { statSync: st } = await import('node:fs');
  const mode = st(join(TEST_KEYS, 'signing.seed')).mode & 0o777;
  const home = (await import('../core/pqc')).keyHome();
  if (mode === 0o600 && !home.startsWith(process.cwd())) {
    pass(`service: seed is 0600 at ${home} — outside the repository`);
  } else {
    fail(`service: seed mode=${mode.toString(8)} home=${home}`);
  }

  // No private material in chain or vault — and NOWHERE ELSE IN THE TREE (the 0019 lesson: the
  // 0017 migration left a renamed copy in .aukora/keys/ and the old chain-only grep missed it).
  const S = sandbox();
  S.run('write', { path: join(S.dir, 'a.txt') });
  writeFileSync(join(S.dir, 'a.txt'), 'witnessed\n');
  S.run('bash', { command: 'true' });
  const seedHex = readFileSync(join(TEST_KEYS, 'signing.seed'), 'utf8').trim();
  const sweepFor = (root: string, needle: string): string[] => {
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d, { withFileTypes: true })) {
        if (n.name === 'node_modules' || n.name === '.git') continue;
        const at = join(d, n.name);
        if (n.isDirectory()) walk(at);
        else {
          try { if (readFileSync(at, 'utf8').includes(needle)) hits.push(at); } catch {}
        }
      }
    };
    walk(root);
    return hits;
  };
  const treeHits = sweepFor(S.dir, seedHex);
  if (treeHits.length === 0) pass('service: the seed appears NOWHERE in the repo tree — chain, vault, or any file');
  else fail(`service: SEED BYTES LEAKED at ${treeHits.join(', ')}`);
  // The sweep itself must WORK: plant the seed and it must be found.
  writeFileSync(join(S.dir, 'planted.txt'), seedHex);
  const found = sweepFor(S.dir, seedHex);
  if (found.length === 1 && found[0].endsWith('planted.txt')) pass('service: the tree sweep actually detects a planted seed (gate is not vacuous)');
  else fail(`service: sweep found ${found.length} hits — the gate would miss a real leak`);
  S.cleanup();

  // The specific 0017 leak shape must never recur.
  if (!existsSync(join(process.cwd(), '.aukora', 'keys', 'receipt-signing-seed.migrated'))) {
    pass('0017 leak: .aukora/keys/receipt-signing-seed.migrated does not exist');
  } else {
    fail('0017 leak: the migrated seed copy is BACK in .aukora/keys/');
  }

  // Read-tool guard: view on the seed is refused BY NAME.
  {
    const S2 = sandbox();
    const e = S2.run('view', { path: join(TEST_KEYS, 'signing.seed') });
    const refused = S2.lines().find((l: any) => l.reason === 'law:key-material');
    if (e === 2 && refused) pass('read guard: view on the signing seed is refused (law:key-material)');
    else fail(`read guard: exit=${e} receipt=${refused?.reason}`);
    S2.cleanup();
  }
  // Ordinary reads stay free AND receipted (specs/0022 supersedes the old no-receipt stance):
  // allowed, with a pre and an observed post carrying the file's digest.
  {
    const S3 = sandbox();
    writeFileSync(join(S3.dir, 'ok.txt'), 'fine\n');
    const e = S3.run('view', { path: join(S3.dir, 'ok.txt') });
    const readPost = S3.lines().find((l: any) => l.tool === 'view' && l.stage === 'post');
    if (e === 0 && readPost?.outcome === 'observed') pass('read guard: ordinary reads pass, receipted pre + observed post (specs/0022)');
    else fail(`read guard: ordinary read exit=${e} post=${readPost?.outcome}`);
    S3.cleanup();
  }

  // Service down → the effect is refused FAST (0019: well under a second, not nine), the
  // refusal is witnessed unsigned, the walk stays green.
  {
    const S4 = sandbox();
    const t0 = Date.now();
    const e = S4.run('write', { path: join(S4.dir, 'b.txt') }, {
      AUKORA_SIGN_URL: 'http://127.0.0.1:1', AUKORA_SIGN_NO_AUTOSPAWN: '1',
    });
    const elapsed = Date.now() - t0;
    const outage = S4.lines().find((l: any) => l.reason === 'law:sign-service-unavailable');
    const v = walkChain(S4.dir);
    if (e === 2 && outage && outage.decision === 'refused' && !outage.signatureKey && v.ok && elapsed < 1000) {
      pass(`service down: refused in ${elapsed}ms (<1s), outage witnessed unsigned, walk green`);
    } else {
      fail(`service down: exit=${e} elapsed=${elapsed}ms outage=${outage?.reason} walk=${v.ok} ${v.breakReason ?? ''}`);
    }
    S4.cleanup();
  }
}

// ── CONCURRENCY (specs/0018): one writer, locked frontier, crash-safe append ──
import { ChainWriter } from '../core/aura-chain';
import { buildAuraTraceEpoch } from '../core/aura-trace';

const toyAppend = (root: string, tag: string, ts: string) => {
  const w = new ChainWriter(root);
  w.append((prev) => {
    const epoch = buildAuraTraceEpoch({
      epochOf: 'aukora-membrane', at: ts,
      evidence: [{ chainKey: 'aukora-membrane', chainHeadHash: prev }],
      prevEpochCommitment: prev,
    });
    return { chainKey: 'aukora-membrane', chainHeadHash: prev, prevEpochCommitment: prev,
      stage: 'pre', call: tag, tool: 'bash', path: '', commandHash: tag.padEnd(8, '0').slice(0, 8),
      decision: 'allowed', reason: 'ok:allowed', ts, epochCommitment: epoch.epochCommitment };
  });
};

{
  // 12 parallel appends → unbroken, all twelve present. ORDER is not asserted (a lock gives a
  // valid total order, not a predetermined one) — the payload SET is.
  const S = sandbox();
  const safeSpawn = (code: string) => {
    const opts = { env: S.env(), stdout: 'ignore' as const, stderr: 'ignore' as const };
    try {
      return Bun.spawn(['bun', '-e', code], opts);
    } catch {
      Bun.sleepSync(50);
      return Bun.spawn(['bun', '-e', code], opts);
    }
  };
  const procs = Array.from({ length: 12 }, (_, i) =>
    safeSpawn(`
      const { ChainWriter } = await import('${process.cwd()}/core/aura-chain.ts');
      const { buildAuraTraceEpoch } = await import('${process.cwd()}/core/aura-trace.ts');
      const w = new ChainWriter('${S.dir}');
      const ts = new Date().toISOString();
      const tag = 'writer-${i}';
      w.append((prev) => {
        const epoch = buildAuraTraceEpoch({ epochOf: 'aukora-membrane', at: ts,
          evidence: [{ chainKey: 'aukora-membrane', chainHeadHash: prev }], prevEpochCommitment: prev });
        return { chainKey: 'aukora-membrane', chainHeadHash: prev, prevEpochCommitment: prev,
          stage: 'pre', call: tag, tool: 'bash', path: '', commandHash: tag,
          decision: 'allowed', reason: 'ok:allowed', ts, epochCommitment: epoch.epochCommitment };
      });
    `));
  const codes = await Promise.all(procs.map((p) => p.exited));
  const v = walkChain(S.dir);
  const tags = new Set(S.lines().map((l: any) => l.call));
  if (codes.every((c) => c === 0) && v.ok && v.count === 12 && tags.size === 12) {
    pass('concurrency: 12 parallel writers, one unbroken chain, all twelve payloads present');
  } else {
    fail(`concurrency: codes=${codes.join(',')} walk=${v.ok} count=${v.count} uniq=${tags.size} ${v.breakReason ?? ''}`);
  }
  S.cleanup();
}

{
  // kill -9 a writer mid-sequence → the chain is intact on the next read (O_APPEND under the
  // 4096-byte bound: a line lands whole or not at all).
  const S = sandbox();
  const writer = Bun.spawn(['bun', '-e', `
    const { ChainWriter } = await import('${process.cwd()}/core/aura-chain.ts');
    const { buildAuraTraceEpoch } = await import('${process.cwd()}/core/aura-trace.ts');
    const w = new ChainWriter('${S.dir}');
    for (let i = 0; i < 500; i++) {
      const ts = new Date().toISOString();
      w.append((prev) => {
        const epoch = buildAuraTraceEpoch({ epochOf: 'aukora-membrane', at: ts,
          evidence: [{ chainKey: 'aukora-membrane', chainHeadHash: prev }], prevEpochCommitment: prev });
        return { chainKey: 'aukora-membrane', chainHeadHash: prev, prevEpochCommitment: prev,
          stage: 'pre', call: 'k' + i, tool: 'bash', path: '', commandHash: 'k' + i,
          decision: 'allowed', reason: 'ok:allowed', ts, epochCommitment: epoch.epochCommitment };
      });
    }
  `], { env: S.env(), stdout: 'pipe', stderr: 'pipe' });
  await new Promise((r) => setTimeout(r, 60));
  writer.kill(9);
  await writer.exited;
  const v = walkChain(S.dir);
  if (v.ok) pass(`kill -9 mid-write: chain intact (${v.count} whole receipts, no partial line)`);
  else fail(`kill -9 mid-write: ${v.breakReason}`);
  S.cleanup();
}

{
  // A truncated tail is NAMED, never silently absorbed.
  const S = sandbox();
  toyAppend(S.dir, 't1', new Date().toISOString());
  const file = join(S.dir, '.aukora', 'aura-chain.jsonl');
  const raw = readFileSync(file, 'utf8');
  writeFileSync(file, raw.slice(0, raw.length - 20)); // bite the last line
  const v = walkChain(S.dir);
  if (!v.ok && /truncated/.test(v.breakReason || '')) {
    pass(`truncated tail: named — ${v.breakReason}`);
  } else {
    fail(`truncated tail: ${v.ok ? 'PASSED' : 'wrong name: ' + v.breakReason}`);
  }
  S.cleanup();
}

{
  // Swapped receipts break linkage, named.
  const S = sandbox();
  toyAppend(S.dir, 's1', new Date().toISOString());
  toyAppend(S.dir, 's2', new Date().toISOString());
  toyAppend(S.dir, 's3', new Date().toISOString());
  const file = join(S.dir, '.aukora', 'aura-chain.jsonl');
  const ls = readFileSync(file, 'utf8').trim().split('\n');
  [ls[1], ls[2]] = [ls[2], ls[1]];
  writeFileSync(file, ls.join('\n') + '\n');
  const v = walkChain(S.dir);
  if (!v.ok && /link broken/.test(v.breakReason || '')) {
    pass(`swapped receipts: linkage break named — ${v.breakReason}`);
  } else {
    fail(`swapped receipts: ${v.ok ? 'PASSED' : 'wrong name: ' + v.breakReason}`);
  }
  S.cleanup();
}

{
  for (const c of stateRootHarnessChecks()) (c.ok ? pass : fail)(`${c.name}${c.detail ? ' — ' + c.detail : ''}`);
}

{
  for (const c of stateRootLeakChecks(ROOTS_BEFORE)) (c.ok ? pass : fail)(`${c.name}${c.detail ? ' — ' + c.detail : ''}`);
}


// ══ THE BASH DOOR IS A WITNESS, AND THE CHAIN SURVIVES ITS OWN REFUSALS ═══════════════════════
// Two owner-decided changes, each with the RED that would notice its absence. The harness red
// carries a NEGATIVE CONTROL by requirement: a tripwire that always reports drift passes the
// subject red perfectly and proves nothing, so only a clean run separates it from a working one.
// A subject RED alone certifies the broken instrument — that is the whole lesson.

const REPO = join(import.meta.dir, '..');
const FIXED = join(REPO, 'hooks', 'law.ts');


/** A governed tree the law may write receipts into. The real .aukora is never touched. */
function governed(): string {
  const d = mkdtempSync(join(tmpdir(), 'reds-'));
  mkdirSync(join(d, '.aukora'), { recursive: true });
  writeFileSync(join(d, '.aukora', 'aura-chain.jsonl'), '');
  // the TCB set has to exist for a digest to move when one of them changes
  // Every TCB path must exist: tcbDigest() throws on an incomplete set, and a scratch tree with
  // three of twenty-nine would be testing the throw rather than the tripwire.
  for (const p of TCB_PATHS) {
    mkdirSync(join(d, dirname(p)), { recursive: true });
    writeFileSync(join(d, p), `// ${p} original\n`);
  }
  return d;
}
function callLaw(law: string, root: string, env: Record<string, string>) {
  const r = spawnSync('bun', ['run', law], {
    input: '{}',
    env: { ...process.env, ...env, CRUSH_PROJECT_DIR: root, AUKORA_SIGN_NO_AUTOSPAWN: '1' },
    encoding: 'utf8', timeout: 20_000,
  });
  return `${r.stdout || ''}${r.stderr || ''}`;
}
const chain = (root: string) =>
  readFileSync(join(root, '.aukora', 'aura-chain.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return {}; }
  });

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('── RED 1 · a refusal at a 200-char path must not break the chain it writes to');
{
  const long = '/private/tmp/claude-501/' + 'x'.repeat(151) + '/deep/BOUNDARY-CROSSED.ts';
  if (long.length < 200) fail(`the probe path is only ${long.length} chars`);
  for (const [label, law] of [['fixed', FIXED]] as const) {
    const root = governed();
    callLaw(law, root, { CRUSH_TOOL_NAME: 'edit', CRUSH_TOOL_INPUT_FILE_PATH: long });
    const paths = chain(root).map((d) => String(d.path || '')).filter((p) => p.length > 0);
    const worst = Math.max(0, ...paths.map((p) => p.length));
    const named = paths.some((p) => p.includes('BOUNDARY-CROSSED.ts'));
    {
      if (worst > 0 && worst <= 128) pass(`fixed writes ${worst} chars — inside the 128-char poverty rule`);
      else fail(`fixed wrote ${worst} chars — still over the rule, or wrote no path at all`);
      if (named) pass('and the receipt STILL names the crossing (the tail survived)');
      else fail('the path was truncated but no longer names what was reached — the tail was lost');
    }
    rmSync(root, { recursive: true, force: true });
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('── RED 2 · the bash door as a witness: git apply must not be quiet');
/** Drive a call, then corrupt the TCB the way an unlisted verb would, then settle. */
function driftRun(law: string, corrupt: boolean, root = governed()): { out: string; posts: any[] } {
  callLaw(law, root, { CRUSH_TOOL_NAME: 'bash', CRUSH_TOOL_INPUT_COMMAND: 'echo hello' });
  if (corrupt) {
    // exactly what `git apply` did: bytes at a TCB path change, by no listed verb
    writeFileSync(join(root, TCB_PATHS[0]), '// REWRITTEN BY AN UNLISTED WRITER\n');
  }
  const out = callLaw(law, root, { CRUSH_TOOL_NAME: 'bash', CRUSH_TOOL_INPUT_COMMAND: 'echo second' });
  const posts = chain(root).filter((d) => d.stage === 'post');
  rmSync(root, { recursive: true, force: true });
  return { out, posts };
}
{

  const attacked = driftRun(FIXED, true);
  if (/TCB DRIFT/.test(attacked.out)) pass('fixed NAMES the drift on stderr');
  else fail('fixed did not name the drift');
  if (attacked.posts.some((d) => d.tcbDrift === 'law:tcb-drift')) pass('and the post receipt carries law:tcb-drift — it is on the chain, not just the console');
  else fail('the drift was printed but never receipted');

  // THE NEGATIVE CONTROL, AND IT IS MANDATORY. A tripwire that always reports drift passes the
  // subject red perfectly and proves nothing; only a clean run separates it from a working one.
  const clean = driftRun(FIXED, false);
  if (!/TCB DRIFT/.test(clean.out)) pass('a run that changes nothing produces NO drift — it does not accuse everything');
  else fail('a clean run reported drift — the tripwire accuses everything, and its silence would mean nothing');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('── RED 3 · the harness red: a tripwire that is OFF, and one that PASSES FOR THE WRONG REASON');
{
  const mut = mkdtempSync(join(tmpdir(), 'reds-mutant-'));
  mkdirSync(join(mut, 'hooks'), { recursive: true });
  for (const l of ['core', 'node_modules', 'package.json']) spawnSync('ln', ['-sfn', join(REPO, l), join(mut, l)]);
  const src = readFileSync(FIXED, 'utf8');

  // A mutant that did not apply is not a mutant. The needles below are the LIVE source lines; if
  // one stops matching, this says so instead of quietly reporting a result about the unmutated
  // file — which is exactly what happened on the first run of this test.
  const mutate = (needle: string, repl: string, name: string): string | null => {
    if (!src.includes(needle)) { fail(`MUTANT "${name}": the needle no longer matches the source — the mutation did not apply`); return null; }
    return src.replace(needle, repl);
  };

  // (a) OFF — no baseline is ever taken, so the comparison can never move.
  const lateSrc = mutate("try { pending.tcbBefore = tcbDigest(ROOT); } catch { pending.tcbBefore = ''; }",
    "pending.tcbBefore = '';", 'no baseline');
  const late = join(mut, 'hooks', 'late.ts');
  if (lateSrc) writeFileSync(late, lateSrc);
  if (lateSrc) {
    const lateRun = driftRun(late, true);
    if (!/TCB DRIFT/.test(lateRun.out)) pass('MUTANT "no baseline": the TCB is rewritten and nothing is reported — caught by the subject red');
    else fail('the no-baseline mutant still reported drift');
  }

  // (b) WRONG REASON — always drifts. It catches the attack AND accuses a clean run.
  const always = join(mut, 'hooks', 'always.ts');
  const alwaysSrc = mutate('const drifted = witnessed && baseline !== tcbAfter;', 'const drifted = true;', 'always drifts');
  if (!alwaysSrc) { rmSync(mut, { recursive: true, force: true }); throw new Error('mutation control unusable'); }
  writeFileSync(always, alwaysSrc);
  const alwaysAttacked = driftRun(always, true);
  const alwaysClean = driftRun(always, false);
  const catchesAttack = /TCB DRIFT/.test(alwaysAttacked.out);
  const accusesClean = /TCB DRIFT/.test(alwaysClean.out);
  if (catchesAttack && accusesClean) {
    pass('MUTANT "always drifts": passes the subject red, then FAILS the negative control — caught for the right reason');
  } else if (catchesAttack && !accusesClean) {
    fail('the always-drifts mutant passed BOTH controls — the negative control is not doing its job');
  } else {
    fail('the always-drifts mutant did not behave as constructed');
  }
  rmSync(mut, { recursive: true, force: true });
}


teardown();
process.exit(failures ? 1 : 0);
