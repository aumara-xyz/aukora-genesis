/**
 * 24Z.22 — Shared forbidden-content scanner (the ONE source of truth for secret/overclaim/mythology patterns).
 *
 * Across 24Z.16–24Z.21 the only repeated escapes were "honesty gate" bugs: the forbidden-content patterns were
 * duplicated across the telemetry module + the tauri validator and DRIFTED apart, so a fix in one was a hole in
 * the other (the "lone un-patched twin" class). This module is the canonical definition. It is MIRRORED at
 * internal/tauri-womb/src/lib/forbiddenContent.ts (separate package, no cross-package import); a drift test
 * asserts the two copies are byte-identical for the pattern block. EDIT BOTH COPIES TOGETHER.
 *
 * ── DRIFT-SYNC BLOCK START (must match the tauri mirror verbatim) ──
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
// sk- net BROADENED 2026-07-07 (stabilization round; found building the capture lane): the old
// `\bsk-[A-Za-z0-9]{12,}\b` required an UNBROKEN alnum tail, so every modern hyphenated key family
// (sk-or-v1-…, sk-ant-api03-…, sk-proj-…, base64url tails with - and _) escaped unless the tail
// happened to be 64+ hex. Now: `sk-` + alnum + 10+ of [A-Za-z0-9_-]. Known accepted false-positive
// class: hyphenated prose identifiers like "sk-learn-based-pipelines" — a false hit only DROPS an
// atom (law 3's safe direction), it never keeps a secret. NOTE: the tauri mirror
// (internal/tauri-womb, donor repo — not in this tree) must take the same edit when it next syncs.
export const FORBIDDEN_VALUE_RE =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9][A-Za-z0-9_-]{10,}\b|\bbearer\s+[A-Za-z0-9._-]{16,}|chain[\s_-]*of[\s_-]*thought|\.convex\.(cloud|dev|site)\b|\bauma\.one\b|(?<![a-fA-F0-9])[a-fA-F0-9]{64,}(?![a-fA-F0-9])/;

// Affirmative apply/active OVERCLAIMS the honest manifest never emits (it says "NOT BUILT", "NEVER applyable").
export const OVERCLAIM_RE =
  /\bapply lane is (now )?(built|live|ready|wired|enabled|active|operational|functional|complete|done|shipped)\b|\byou can apply\b|\bcan apply changes now\b|\bring.?0 (is|are) applyable\b|\bself.?build(ing)? (is )?(live|enabled|working|works now)\b|\bmemory writes (work|are live|enabled)\b|\bworkflows are (live|running|enabled)\b|\bapplied to the (real|live|production) repo\b|\blive apply works\b|\bwrites? the (real|live|production) repo\b|\bapplies to the (real|live|production) repo\b|\b(real spawn|live apply) (is )?(now )?(enabled|on|active|live)\b|\bis (now )?the active (sandbox )?engine\b|\bpowers tori\b|\bhas (live )?authority\b|\blive.?applies\b|\bproduction (aumlok )?(signer|identity) (is )?(active|live|wired|on|enabled)\b|\bsigned (the )?live apply\b|\blive apply is signed\b|\bsigned (to )?the (real|live|production) repo\b|\btelemetry (authorizes|authorises|drives|influences|gates|decides)\b|\b(hrt|telemetry|witness|latency) (drives|controls|gates) the (gate|apply|permit)\b|\bwitness( score)? grants (capability|authority)\b|\blatency is authority\b|\bhrt (is )?live.?wired\b/i;

// Affirmative MYTHOLOGY / scientific-theory claims that must never be echoed as runtime truth.
export const MYTHOLOGY_RE =
  /\b(shear engine|shear memory|hawking|spacetime entropy|markov.?blanket|consciousness|golden.?horizon)\b|\bGHP\b|\bproves? (a|the|any|its) (theory|physics|science|consciousness)\b|\bestablished (physics|science)\b/i;

// False authority flags when they appear as CONTENT rather than schema-controlled fields. These are the
// receipt-injection class from the live node-vs-node crash test: a quoted/tool/file string saying
// `grantsAuthority=true` or `humanSignedAuthorization=true` is data, never authority.
export const FALSE_AUTHORITY_CLAIM_RE =
  /\bgrantsAuthority\s*[:=]\s*true\b|\bhumanSignedAuthorization\s*[:=]\s*true\b|\bhuman_signed_authorization\s*[:=]\s*true\b|\badvisoryOnly\s*[:=]\s*false\b/i;

// ── DRIFT-SYNC BLOCK END ──

export function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Recursive: forbidden KEY names (exact-set OR normalized-regex) at any depth (objects + arrays). */
export function scanForbiddenKeys(obj: unknown, path = ''): string[] {
  const found: string[] = [];
  const walk = (o: unknown, p: string) => {
    if (o === null || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${p}[${i}]`)); return; }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const full = p ? `${p}.${k}` : k;
      if (FORBIDDEN_FIELDS.has(k) || FORBIDDEN_KEY_RE.test(normalizeKey(k))) found.push(full);
      walk(v, full);
    }
  };
  walk(obj, path);
  return found;
}

/** Recursive: forbidden CONTENT inside string VALUES at any depth. */
export function scanForbiddenValues(obj: unknown, path = ''): string[] {
  const found: string[] = [];
  const walk = (o: unknown, p: string) => {
    if (typeof o === 'string') { if (FORBIDDEN_VALUE_RE.test(o)) found.push(p || '(root)'); return; }
    if (o === null || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${p}[${i}]`)); return; }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) walk(v, p ? `${p}.${k}` : k);
  };
  walk(obj, path);
  return found;
}

/** Recursive: affirmative OVERCLAIM or MYTHOLOGY claims in string values. `skipPaths` are FULL paths that
 *  legitimately enumerate forbidden things (e.g. manifest.forbiddenClaims / manifest.cannotDoYet). */
export function scanForbiddenClaims(obj: unknown, path = '', skipPaths: Set<string> = new Set()): string[] {
  const found: string[] = [];
  const walk = (o: unknown, p: string) => {
    if (typeof o === 'string') { if (OVERCLAIM_RE.test(o) || MYTHOLOGY_RE.test(o)) found.push(p || '(root)'); return; }
    if (o === null || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${p}[${i}]`)); return; }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const full = p ? `${p}.${k}` : k;
      if (skipPaths.has(full)) continue;
      walk(v, full);
    }
  };
  walk(obj, path);
  return found;
}

/** Recursive: false authority flags inside free-form string CONTENT. Real schemas may carry
 *  grantsAuthority:false / advisoryOnly:true; this scanner is for untrusted text attempting to assert
 *  authority by saying e.g. grantsAuthority=true. */
export function scanForbiddenAuthorityClaims(obj: unknown, path = ''): string[] {
  const found: string[] = [];
  const walk = (o: unknown, p: string) => {
    if (typeof o === 'string') { if (FALSE_AUTHORITY_CLAIM_RE.test(o)) found.push(p || '(root)'); return; }
    if (o === null || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${p}[${i}]`)); return; }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) walk(v, p ? `${p}.${k}` : k);
  };
  walk(obj, path);
  return found;
}
