// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Shared forbidden-content law (recursive) — the ONE source of truth for secret / authority / overclaim /
 * mythology patterns that may never appear in a scrubbed public trace.
 *
 * PROVENANCE: ported from the donor `core/src/forbiddenContent.ts` (aukora-symbiote, 24Z.22). The pattern block
 * below is the canonical AURA fence: exact forbidden KEY names, a normalized forbidden-key regex, forbidden VALUE
 * content (secret material / production wires), affirmative apply/authority OVERCLAIMS, MYTHOLOGY claims, and
 * false-authority CONTENT flags. The scanners are RECURSIVE — a forbidden key or value at ANY depth (objects and
 * arrays) is found, so a nested blob cannot smuggle a secret past a shallow check.
 *
 * This module is pure: no I/O, clock, randomness, signing, mutation, or authority grant. Evidence never authority.
 *
 * ── DRIFT-SYNC BLOCK START (keep this pattern block verbatim across copies) ──
 */

// Forbidden KEY names (exact set) — secret/authority/biometric fields that may never appear as a key.
export const FORBIDDEN_FIELDS: ReadonlySet<string> = new Set([
  'apiKey', 'api_key', 'privateKey', 'private_key',
  'seed', 'secretSeed', 'pop', 'proofOfPossession',
  'signedHead', 'signed_head', 'rawSignature', 'raw_signature',
  'kvCache', 'kv_cache', 'hiddenState', 'hidden_state',
  'rawActivations', 'raw_activations', 'privateSeed', 'private_seed',
  'modelWeights', 'model_weights', 'password', 'secret', 'token',
  'signingSeed', 'signing_seed', 'rawJwk', 'raw_jwk', 'mnemonicSecret', 'mnemonic',
  'bearerToken', 'rawPhrase', 'phrasePlaintext', 'unlockPhrase',
  'voiceEmbedding', 'voice_embedding', 'rawAudio', 'raw_audio',
  'biometricTemplate', 'biometric_template', 'spokenChallengeHash',
  'secretKey', 'secret_key',
]);

// Forbidden KEY names (normalized regex) — catches separator/case variants at any depth.
export const FORBIDDEN_KEY_RE =
  /(chainofthought|cot|rawprompt|rawmodel|hiddenstate|privatekey|signingseed|signingsecret|signaturebody|rawsignature|\bpop\b|proofofpossession|secretbody|authoritytoken|verifierinternals|evidencebundle|mnemonic|apikey|\bsecret\b|\btoken\b|password|seedphrase|privateseed)/;

// Forbidden VALUE content — secret material / production wires smuggled into an allowlisted STRING value.
// R55: includes the PLANNED provider token shapes (HuggingFace `hf_…`; Tinker `tinker_…` / `tml_…`) so a pasted
// provider credential is refused BEFORE those integrations exist. R55.2: the `sk-` branch allows separators
// throughout the suffix, so SEGMENTED keys (`sk-proj-…`, `sk-ant-api03-…`, `sk-tinker-…`) are covered by ONE
// shape, not a per-vendor list. R55.3: the WHOLE pattern is CASE-INSENSITIVE — `Bearer`/`BEARER` (the standard
// header casings) match like `bearer`, and every prefix/wire shape refuses regardless of case; strictly broader
// refusal, never narrower (the 64-hex class was already case-symmetric). Shape-only: the scanners report the
// PATH of the offending string, never the matched bytes.
export const FORBIDDEN_VALUE_RE =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9._-]{12,}(?![A-Za-z0-9._-])|\bhf_[A-Za-z0-9]{16,}\b|\btinker_[A-Za-z0-9]{12,}\b|\btml_[A-Za-z0-9]{12,}\b|\bbearer\s+[A-Za-z0-9._-]{16,}|chain[\s_-]*of[\s_-]*thought|\.convex\.(cloud|dev|site)\b|\bauma\.one\b|(?<![a-fA-F0-9])[a-fA-F0-9]{64,}(?![a-fA-F0-9])/i;

// Affirmative apply/active OVERCLAIMS an honest manifest never emits (it says "NOT BUILT", "NEVER applyable").
export const OVERCLAIM_RE =
  /\bapply lane is (now )?(built|live|ready|wired|enabled|active|operational|functional|complete|done|shipped)\b|\byou can apply\b|\bcan apply changes now\b|\bring.?0 (is|are) applyable\b|\bself.?build(ing)? (is )?(live|enabled|working|works now)\b|\bmemory writes (work|are live|enabled)\b|\bworkflows are (live|running|enabled)\b|\bapplied to the (real|live|production) repo\b|\blive apply works\b|\bwrites? the (real|live|production) repo\b|\bapplies to the (real|live|production) repo\b|\b(real spawn|live apply) (is )?(now )?(enabled|on|active|live)\b|\bis (now )?the active (sandbox )?engine\b|\bhas (live )?authority\b|\blive.?applies\b|\bproduction (aumlok )?(signer|identity) (is )?(active|live|wired|on|enabled)\b|\bsigned (the )?live apply\b|\blive apply is signed\b|\bsigned (to )?the (real|live|production) repo\b|\btelemetry (authorizes|authorises|drives|influences|gates|decides)\b|\b(trace|telemetry|witness|latency) (drives|controls|gates) the (gate|apply|permit)\b|\bwitness( score)? grants (capability|authority)\b|\blatency is authority\b/i;

// Affirmative MYTHOLOGY / scientific-theory claims that must never be echoed as runtime truth.
export const MYTHOLOGY_RE =
  /\b(shear engine|shear memory|hawking|spacetime entropy|markov.?blanket|consciousness|golden.?horizon)\b|\bproves? (a|the|any|its) (theory|physics|science|consciousness)\b|\bestablished (physics|science)\b/i;

// False authority flags when they appear as CONTENT rather than schema-controlled fields. Real schemas may carry
// grantsAuthority:false / advisoryOnly:true; this scanner is for untrusted TEXT asserting authority by saying
// e.g. grantsAuthority=true — the receipt-injection class (a quoted/tool/file string is data, never authority).
export const FALSE_AUTHORITY_CLAIM_RE =
  /\bgrantsAuthority\s*[:=]\s*true\b|\bhumanSignedAuthorization\s*[:=]\s*true\b|\bhuman_signed_authorization\s*[:=]\s*true\b|\badvisoryOnly\s*[:=]\s*false\b/i;

// ── DRIFT-SYNC BLOCK END ──

export function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** R55.4: an object KEY can itself be credential-shaped (a token used as a map key). Reported paths must stay
 *  CONTENT-FREE, so any path segment that matches the forbidden VALUE shapes is replaced by this marker — the
 *  scanner report can never re-leak the very credential it found (neither as a finding nor as a parent segment). */
export const REDACTED_KEY_MARKER = '<redacted-key>';
function pathSegment(k: string): string {
  return FORBIDDEN_VALUE_RE.test(k) ? REDACTED_KEY_MARKER : k;
}

/** Recursive: forbidden KEY names (exact-set OR normalized-regex) at any depth (objects + arrays). Paths are
 *  content-free: a credential-shaped key appears as `<redacted-key>` in every reported path. */
export function scanForbiddenKeys(obj: unknown, path = ''): string[] {
  const found: string[] = [];
  const walk = (o: unknown, p: string): void => {
    if (o === null || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${p}[${i}]`)); return; }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const full = p ? `${p}.${pathSegment(k)}` : pathSegment(k);
      if (FORBIDDEN_FIELDS.has(k) || FORBIDDEN_KEY_RE.test(normalizeKey(k))) found.push(full);
      walk(v, full);
    }
  };
  walk(obj, path);
  return found;
}

/** Recursive: forbidden CONTENT inside string VALUES at any depth — and (R55.4) inside object KEYS: a
 *  credential-shaped key is itself a finding, reported as the content-free `<redacted-key>` marker. */
export function scanForbiddenValues(obj: unknown, path = ''): string[] {
  const found: string[] = [];
  const walk = (o: unknown, p: string): void => {
    if (typeof o === 'string') { if (FORBIDDEN_VALUE_RE.test(o)) found.push(p || '(root)'); return; }
    if (o === null || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${p}[${i}]`)); return; }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const seg = pathSegment(k);
      const full = p ? `${p}.${seg}` : seg;
      if (seg === REDACTED_KEY_MARKER) found.push(full); // the KEY is credential-shaped — a finding in itself
      walk(v, full);
    }
  };
  walk(obj, path);
  return found;
}

/** Recursive: affirmative OVERCLAIM or MYTHOLOGY claims in string values. `skipPaths` are FULL paths that
 *  legitimately enumerate forbidden things (e.g. a manifest's own forbidden-claims list). */
export function scanForbiddenClaims(obj: unknown, path = '', skipPaths: Set<string> = new Set()): string[] {
  const found: string[] = [];
  const walk = (o: unknown, p: string): void => {
    if (typeof o === 'string') { if (OVERCLAIM_RE.test(o) || MYTHOLOGY_RE.test(o)) found.push(p || '(root)'); return; }
    if (o === null || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${p}[${i}]`)); return; }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const full = p ? `${p}.${k}` : k;
      if (skipPaths.has(full)) continue;
      walk(v, p ? `${p}.${pathSegment(k)}` : pathSegment(k)); // reported paths stay content-free (R55.4)
    }
  };
  walk(obj, path);
  return found;
}

/** Recursive: false authority flags inside free-form string CONTENT (the receipt-injection class). */
export function scanForbiddenAuthorityClaims(obj: unknown, path = ''): string[] {
  const found: string[] = [];
  const walk = (o: unknown, p: string): void => {
    if (typeof o === 'string') { if (FALSE_AUTHORITY_CLAIM_RE.test(o)) found.push(p || '(root)'); return; }
    if (o === null || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${p}[${i}]`)); return; }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) walk(v, p ? `${p}.${pathSegment(k)}` : pathSegment(k));
  };
  walk(obj, path);
  return found;
}

/** The forbidden-content law grants no authority — it only finds and refuses. Constant, by construction. */
export function forbiddenContentGrantsAuthority(): false {
  return false;
}
