// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
/**
 * 24Z.77 — OUT-OF-PROCESS SIGNER (the real fix for the write-authority HIGH). bun env-stripping proved unreliable, so the
 * HMAC key K must NOT live in the :4096 model process at all. This daemon holds K in ITS env only, listens on a 0600 unix
 * socket, and RE-DECIDES every signature: it never trusts a caller-supplied receipt/hash. Given the RAW (owner, key, value),
 * it runs the SAME gate classifier (classifyRisk) the IDE uses, checks a daemon-co-signed AUMLOK epoch, rejects replays, and
 * signs the HMAC only for ITS OWN ALLOW. A script that reaches the socket gains nothing — a secret/high-risk write is denied,
 * a benign write is exactly what an unlocked session would already permit.
 *
 * §13: the daemon AUTHORIZES (signs) only what the gate would ALLOW; it never grants more than the law.
 *
 * RESIDUALS CLOSED: C — hash-pins risk.ts at boot (no forked classifier). D — verifies an Ed25519 epoch signed by the
 * daemon's own key, not the UID-writable session boolean. E — persists redeemed nonces to a 0600 ledger (survives restart).
 * HONEST RESIDUAL (round 5): a same-UID attacker can ptrace this process to read K — only closed by a separate principal.
 */
import { createHmac, createHash, generateKeyPairSync, sign as edSign, verify as edVerify, type KeyObject, createPrivateKey, createPublicKey } from "node:crypto"
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, appendFileSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { classifyRisk } from "../../aukora-ide/gate/risk"
import { looksLikeSecretToken } from "../../aukora-ide/integration/opencode-runtime/secretShape" // 24Z.83 — pure + unit-tested anti-secret-stash backstop

const HOME = homedir()
const DIR = process.env.AUKORA_SIGNER_DIR || join(HOME, ".aukora", "signer") // env-overridable for isolated tests
const SOCK = process.env.AUKORA_SIGNER_SOCK || join(DIR, "sign.sock")
const ED_KEY = join(DIR, "daemon-ed25519.pem")        // the daemon's epoch-signing key (0600)
const NONCE_LEDGER = join(DIR, "nonces.jsonl")          // redeemed nonces (0600) — anti-replay across restarts (E)
const EPOCH_FILE = process.env.AUKORA_AUMLOK_EPOCH_FILE || join(HOME, ".aukora", "aumlok-epoch.json") // daemon-co-signed unlock epoch (D)
const KEYFILE = process.env.AUKORA_AUMLOK_KEYFILE || join(HOME, ".aukora", "aumlok-dev.json")
const RISK_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "aukora-ide", "gate", "risk.ts")
const log = (...a: unknown[]) => console.error("[signer]", ...a)

// ── K (the HMAC key) — read from the 0600 FILE into HEAP ONLY, never an env var. ─────────────────────────────────────
// 24Z.77 put K in the daemon's ENV — but `ps eww -p <pid>` / /proc/<pid>/environ print a process's env to anyone who can
// list it (Guardian caught this live). So 24Z.78 reads K from the gate-denied 0600 file into a closure const; the launcher
// starts the daemon under a CLEAN env (no AUKORA_IDE_MEMORY_SECRET). ps eww on this process reveals NOTHING. Only a
// same-UID ptrace of the heap can reach K now — the acknowledged round-5 ceiling (separate principal closes it).
const K_FILE = process.env.AUKORA_IDE_MEMORY_SECRET_FILE || join(HOME, ".aukora", "ide-memory-secret")
let __K = ""
try { __K = readFileSync(K_FILE, "utf8").trim() } catch { /* fail-closed below */ }
if (!__K) { log(`FATAL: cannot read K from ${K_FILE} (0600) — run start-kernel-backend.sh first.`); process.exit(1) }
// Belt-and-suspenders: if K WAS handed to us in env (legacy launch), strip it so ps eww can never show it.
try { delete process.env.AUKORA_IDE_MEMORY_SECRET } catch { /* heap copy holds it */ }

// ── C — HASH-PIN the classifier. The daemon's authority IS classifyRisk; a swapped risk.ts must fail-closed, not silently
// weaken. The pin is recorded on first boot (TOFU) and asserted every boot after; a mismatch refuses to start. ───────────
const PIN_FILE = join(DIR, "risk.sha256.pin")
function assertClassifierPinned() {
  const h = createHash("sha256").update(readFileSync(RISK_PATH)).digest("hex")
  if (!existsSync(PIN_FILE)) { writeFileSync(PIN_FILE, h); chmodSync(PIN_FILE, 0o600); log("classifier pinned (TOFU):", h.slice(0, 16) + "…"); return }
  const pinned = readFileSync(PIN_FILE, "utf8").trim()
  if (pinned !== h) { log("FATAL: risk.ts hash mismatch — classifier changed under the daemon. Pinned", pinned.slice(0, 16), "got", h.slice(0, 16), ". Re-pin deliberately (delete", PIN_FILE, ") only after reviewing the gate change."); process.exit(1) }
  log("classifier pin OK:", h.slice(0, 16) + "…")
}

// ── Ed25519 epoch key (D). Generated once, persisted 0600. The daemon signs the unlock epoch with this; only the daemon
// can mint a valid epoch, so a forged session-file {"unlocked":true} is ignored. ─────────────────────────────────────────
function loadOrCreateEdKey(): { priv: KeyObject; pub: KeyObject; pubHex: string } {
  if (!existsSync(ED_KEY)) {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519")
    writeFileSync(ED_KEY, privateKey.export({ type: "pkcs8", format: "pem" }) as string); chmodSync(ED_KEY, 0o600)
    const pub = publicKey.export({ type: "spki", format: "pem" }) as string
    writeFileSync(ED_KEY + ".pub", pub); chmodSync(ED_KEY + ".pub", 0o644)
    log("minted daemon Ed25519 epoch key")
  }
  const priv = createPrivateKey(readFileSync(ED_KEY))
  const pub = createPublicKey(priv)
  const pubHex = createHash("sha256").update(pub.export({ type: "spki", format: "der" })).digest("hex")
  return { priv, pub, pubHex }
}

// ── AUMLOK keyfile hash (the daemon verifies the phrase itself — it is the unlock authority, not the session file). ──────
function aumlokHash(): string | null { try { return JSON.parse(readFileSync(KEYFILE, "utf8")).approvalKeyHash ?? null } catch { return null } }
const normPhrase = (p: string) => p.toLowerCase().trim().replace(/\s+/g, " ")

// ── E — persistent nonce ledger. A redeemed nonce can never be reused, even across a kill+restart. ─────────────────────
const redeemed = new Set<string>()
function loadNonces() { try { for (const line of readFileSync(NONCE_LEDGER, "utf8").split("\n")) { const n = line.trim(); if (n) redeemed.add(n) } } catch { /* none yet */ } }
function redeem(nonce: string): boolean { if (redeemed.has(nonce)) return false; redeemed.add(nonce); appendFileSync(NONCE_LEDGER, nonce + "\n"); try { chmodSync(NONCE_LEDGER, 0o600) } catch {} return true } // 24Z.78 A4 — 0600

// ── the daemon's own copies of the memory-write hashing (mirrors memory.ts EXACTLY so the Convex mutation verifies). ────
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex")
const hmacHex = (msg: string) => createHmac("sha256", __K).update(msg).digest("hex")
function normalizeKey(k: string): string { return k.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) || "fact" }
// looksLikeSecretToken moved to aukora-ide/integration/opencode-runtime/secretShape.ts (24Z.83 — pure + unit-tested; the
// daemon imports it above). Codex's gap (letters-only/hex-shaped tokens that lacked a digit) is closed there.
function receiptHashFor(normKey: string, gated: string): string {
  return sha256(JSON.stringify({ tool: "memory", permission: "memory", patterns: [normKey], filepath: null, diff: gated, command: null, files: null }))
}

let ED: ReturnType<typeof loadOrCreateEdKey>

// ── EPOCH: mint (on a verified phrase) + check (on every sign). The epoch is { unlocked, expiresAt } + Ed25519 sig. ─────
function mintEpoch(ttlMin: number) {
  const epoch = { unlocked: true, expiresAt: Date.now() + ttlMin * 60_000, ts: Date.now() }
  const body = JSON.stringify(epoch)
  const sig = edSign(null, Buffer.from(body), ED.priv).toString("hex")
  writeFileSync(EPOCH_FILE, JSON.stringify({ ...epoch, sig, alg: "ed25519", pubFp: ED.pubHex }, null, 2)); chmodSync(EPOCH_FILE, 0o600)
}
function epochUnlocked(): { ok: boolean; reason?: string } {
  let j: any
  try { j = JSON.parse(readFileSync(EPOCH_FILE, "utf8")) } catch { return { ok: false, reason: "no AUMLOK epoch (unlock first)" } }
  if (!j.sig || j.pubFp !== ED.pubHex) return { ok: false, reason: "epoch not signed by this daemon (forged unlock refused)" }
  const body = JSON.stringify({ unlocked: j.unlocked, expiresAt: j.expiresAt, ts: j.ts })
  let valid = false
  try { valid = edVerify(null, Buffer.from(body), ED.pub, Buffer.from(j.sig, "hex")) } catch { valid = false }
  if (!valid) return { ok: false, reason: "epoch signature invalid (forged unlock refused)" }
  if (!j.unlocked) return { ok: false, reason: "AUMLOK locked" }
  if (j.expiresAt && j.expiresAt < Date.now()) return { ok: false, reason: "AUMLOK session expired — unlock again" }
  return { ok: true }
}

// ── RPC handlers ───────────────────────────────────────────────────────────────────────────────────────────────────
function handleUnlock(req: any): any {
  // D — the daemon is the unlock authority: it verifies the phrase against the keyfile hash, then mints a SIGNED epoch.
  const h = aumlokHash()
  if (!h) return { ok: false, reason: "no AUMLOK identity (run aumlok set first)" }
  if (typeof req.phrase !== "string" || !req.phrase) return { ok: false, reason: "no phrase" }
  if (sha256Phrase(req.phrase) !== h) return { ok: false, reason: "phrase mismatch" }
  const ttl = Math.max(1, Math.min(Number(req.ttlMin) || 2880, 10080))
  mintEpoch(ttl)
  return { ok: true, expiresAt: Date.now() + ttl * 60_000, durationMin: ttl }
}
function sha256Phrase(p: string): string { return createHash("sha256").update(normPhrase(p)).digest("hex") }

function handleSignWrite(req: any): any {
  const owner = String(req.owner ?? ""), rawKey = String(req.key ?? ""), value = String(req.value ?? ""), nonce = String(req.nonce ?? "")
  if (!owner || !rawKey || !nonce) return { ok: false, reason: "missing owner/key/nonce" }
  // 1) RE-DECIDE: run the gate's own classifier on the SAME content the IDE gates (rawKey + value). Secret/high-risk → deny.
  const gated = `${rawKey}\n${value}`
  const decision = classifyRisk({ paths: [], addedContent: gated })
  if (decision.risk === "high") return { ok: false, reason: "re-decided DENY — " + (decision.reasons[0] ?? "high-risk content") }
  // 1b) C(ii) — MEMORY-SCOPED entropy backstop (here, NOT in the shared SECRET_CONTENT — that would over-block normal code
  // edits). An unlabeled high-entropy token (K's own 64-hex shape, or a base64 secret) must not be storable as a "fact".
  if (looksLikeSecretToken(rawKey) || looksLikeSecretToken(value)) return { ok: false, reason: "re-decided DENY — high-entropy token can't be stored as memory (anti-secret-stash)" }
  // 2) AUMLOK epoch (D) — daemon-signed, not the bare session boolean.
  const unlock = epochUnlocked()
  if (!unlock.ok) return { ok: false, reason: unlock.reason }
  // 3) anti-replay (E).
  if (!redeem(nonce)) return { ok: false, reason: "replay — nonce already redeemed" }
  // 4) sign (only now, for the daemon's OWN allow). Recompute every hash from the raw input — never trust the caller.
  const key = normalizeKey(rawKey)
  const contentHash = sha256(value)
  const receiptHash = receiptHashFor(key, gated)
  const writeSecret = hmacHex(`${owner}:${key}:${receiptHash}:${contentHash}`)
  return { ok: true, key, writeSecret, receiptHash, contentHash }
}

function handle(reqLine: string): string {
  let req: any
  try { req = JSON.parse(reqLine) } catch { return JSON.stringify({ ok: false, reason: "bad json" }) }
  try {
    if (req.op === "ping") return JSON.stringify({ ok: true, pong: true, pubFp: ED.pubHex })
    if (req.op === "unlock") return JSON.stringify(handleUnlock(req))
    if (req.op === "sign-write") return JSON.stringify(handleSignWrite(req))
    return JSON.stringify({ ok: false, reason: "unknown op" })
  } catch (e) { return JSON.stringify({ ok: false, reason: "daemon error: " + String((e as Error)?.message ?? e).slice(0, 120) }) }
}

// ── boot ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function main() {
  mkdirSync(DIR, { recursive: true }); chmodSync(DIR, 0o700)
  assertClassifierPinned()
  ED = loadOrCreateEdKey()
  loadNonces()
  try { if (existsSync(SOCK)) unlinkSync(SOCK) } catch {}
  // @ts-ignore — Bun.listen unix socket
  const server = Bun.listen({
    unix: SOCK,
    socket: {
      data(socket: any, data: Buffer) { for (const line of data.toString("utf8").split("\n")) { if (line.trim()) socket.write(handle(line) + "\n") } },
      error(_s: any, e: any) { log("socket error:", String(e)) },
    },
  })
  try { chmodSync(SOCK, 0o600) } catch (e) { log("WARN could not chmod socket:", String(e)) }
  log(`listening on ${SOCK} (0600) · epoch-key ${ED.pubHex.slice(0, 12)}… · ${redeemed.size} redeemed nonces · K held in-daemon only`)
  void server
}
main()
