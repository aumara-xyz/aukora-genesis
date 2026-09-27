// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Recursive, fail-closed, positive-allow-list validator (Round-12 immune gate). Pure: no I/O.
 * Enforces the settled contract plus the Commit-D amendments: full vs. included content hashes
 * (recomputed from decoded bytes; equal iff complete), files/omissions/rootAllowlist exact partition,
 * relative-POSIX + NFC path discipline (file/omission/allowlist paths and test cwd, "." only for cwd),
 * canonical base64 round-trip, projection-based secret refusal (raw/NFC/zero-width/confusable) over
 * utf8 content, base64-decoded-as-text, and stdout/stderr excerpts, ASCII open-map keys + NFC values,
 * UTF-8-byte-length-framed unique test identity, registry-owned limits, bound catalogueId, and no raw NUL.
 */
import { EVIDENCE_PACK_SCHEMA, EvidenceErrorCode, ValidationResult, OMISSION_REASONS, LIMITS_PROFILES } from './types';
import { canonicalBytes } from './canonical';
import { packDigest, sha256Hex } from './digest';
import { catalogueId, textHasSecret } from './catalogue';

const SHA256_RE = /^[0-9a-f]{64}$/;
const GITSHA_RE = /^[0-9a-f]{40}$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const MAP_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const AUTHORITY_KEY_RE = /(?:^|[_-])(?:sign|signed|signature|grant|grants|authoriz\w*|token|apply|seed|privatekey|mutate|approve|unlock)(?:[_-]|$)/i;

// D2 (amendment 4): normalize an open-map key (lowercase, strip separators) before screening, so camelCase
// families like `apiKey`/`signingKey` cannot slip past a separator-anchored regex.
const AUTHORITY_TERMS = [
  'apikey', 'signingkey', 'privatekey', 'accesstoken', 'bearertoken', 'credential', 'password', 'secret',
  'seed', 'token', 'approve', 'apply', 'grant', 'grants', 'unlock', 'mutate', 'signature', 'signed', 'sign',
  'authoriz', 'key', 'cert', 'auth', 'pat', 'ssh',
];
function isAuthorityShapedKey(k: string): boolean {
  const norm = k.toLowerCase().replace(/[._-]/g, '');
  for (const t of AUTHORITY_TERMS) if (norm.indexOf(t) !== -1) return true;
  return false;
}

const PACK_KEYS = ['schema', 'advisoryOnly', 'grantsAuthority', 'repoId', 'headCommit', 'headTree', 'baseCommit', 'baseTree', 'files', 'omissions', 'testRuns', 'rootAllowlist', 'limitsProfileId', 'builderToolVersions', 'catalogueId'];
const FILE_KEYS = ['path', 'kind', 'originalSizeBytes', 'includedByteStart', 'includedByteEnd', 'truncated', 'fullSha256', 'includedSha256', 'encoding', 'content'];
const OMISSION_KEYS = ['path', 'reason', 'originalSizeBytes', 'sha256'];
const TEST_KEYS = ['command', 'cwdRelative', 'exitCode', 'stdoutSha256', 'stderrSha256', 'stdoutBytes', 'stderrBytes', 'stdoutExcerpt', 'stderrExcerpt', 'durationMs', 'toolVersions'];

const encoder = new TextEncoder();
const OK: ValidationResult = { ok: true };
function err(code: EvidenceErrorCode, path: string, message: string): ValidationResult { return { ok: false, code, path, message }; }
// D2 (amendment 2): only ordinary or null-prototype objects — reject class instances and prototype pollution.
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * D2 red-team hardening: the validated key surface must be EXACTLY the canonicalized surface. Canonical
 * bytes range over Object.keys (own-enumerable string data props). So reject any object with a non-ordinary
 * prototype (E_PROTO), a symbol own key, a non-enumerable own key, or an accessor (get/set) property — each
 * of those lets a field be read by validation yet vanish from (or diverge on re-read within) the digest.
 */
function ordinaryDataObject(v: unknown, p: string): ValidationResult {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return err('E_NOT_OBJECT', p, 'expected object');
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return err('E_PROTO', p, 'non-ordinary prototype');
  if (Object.getOwnPropertySymbols(v).length > 0) return err('E_PROTO', p, 'symbol own property');
  const names = Object.getOwnPropertyNames(v);
  if (names.length !== Object.keys(v).length) return err('E_PROTO', p, 'non-enumerable own property');
  for (const k of names) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || d.get !== undefined || d.set !== undefined) return err('E_PROTO', `${p}.${k}`, 'accessor property');
  }
  return OK;
}

/**
 * D4: an array container must be an ordinary, dense Array whose only own properties are its contiguous
 * `0..length-1` data indices (all enumerable) plus `length`. Reject a non-standard prototype, symbol own
 * keys, holes (sparse arrays), non-index own properties, non-enumerable indices, and accessor (get/set)
 * indices — each of which lets an element read differently between validation and canonicalization, or
 * hides data from `Object.keys`/the digest. Mirrors ordinaryDataObject for array containers (which are
 * otherwise screened only with `Array.isArray`).
 */
function ordinaryDataArray(v: unknown, p: string): ValidationResult {
  if (!Array.isArray(v)) return err('E_WRONG_TYPE', p, 'expected array');
  if (Object.getPrototypeOf(v) !== Array.prototype) return err('E_PROTO', p, 'non-standard array prototype');
  if (Object.getOwnPropertySymbols(v).length > 0) return err('E_PROTO', p, 'symbol own property on array');
  const n = v.length;
  let dataCount = 0;
  for (const k of Object.getOwnPropertyNames(v)) {
    if (k === 'length') continue;
    const idx = Number(k);
    if (!Number.isInteger(idx) || idx < 0 || idx >= n || String(idx) !== k) return err('E_PROTO', `${p}.${k}`, 'non-index own property on array');
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || d.get !== undefined || d.set !== undefined) return err('E_PROTO', `${p}[${k}]`, 'accessor array element');
    if (!d.enumerable) return err('E_PROTO', `${p}[${k}]`, 'non-enumerable array element');
    dataCount++;
  }
  if (dataCount !== n) return err('E_PROTO', p, 'sparse array (holes)');
  return OK;
}
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) { const n = s.charCodeAt(i + 1); if (!(n >= 0xDC00 && n <= 0xDFFF)) return true; i++; }
    else if (c >= 0xDC00 && c <= 0xDFFF) return true;
  }
  return false;
}
function safeIntGE0(v: unknown): v is number { return typeof v === 'number' && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= 0; }
function safeInt(v: unknown): v is number { return typeof v === 'number' && Number.isSafeInteger(v) && !Object.is(v, -0); }
function utf8Len(s: string): number { return encoder.encode(s).length; }
function isNfc(s: string): boolean { return s.normalize('NFC') === s; }
function decodeBase64Canonical(s: string): Uint8Array | null {
  if (s.length % 4 !== 0 || !BASE64_RE.test(s)) return null;
  const buf = Buffer.from(s, 'base64');
  if (buf.toString('base64') !== s) return null; // canonical round-trip
  return new Uint8Array(buf);
}

/** Deterministic ASCII-byte projection (D1): keep printable ASCII + TAB/LF/CR; every other byte -> LF. */
function asciiByteProjection(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    s += ((b >= 0x20 && b <= 0x7E) || b === 0x09 || b === 0x0A || b === 0x0D) ? String.fromCharCode(b) : '\n';
  }
  return s;
}

/** D1 base64 secret scan: always scan the ASCII-byte projection (catches ASCII secrets inside invalid
 *  UTF-8 binary); additionally strict-decode UTF-8 and, on success, run raw/NFC/zero-width/confusable
 *  projections (catches confusable secrets inside valid UTF-8). */
function decodedBytesHaveSecret(bytes: Uint8Array): boolean {
  if (textHasSecret(asciiByteProjection(bytes))) return true;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (textHasSecret(text)) return true;
  } catch { /* invalid UTF-8: the ASCII projection already covered it */ }
  return false;
}

function checkString(v: unknown, p: string): ValidationResult {
  if (typeof v !== 'string') return err('E_WRONG_TYPE', p, 'expected string');
  if (v.indexOf('\u0000') !== -1) return err('E_NUL', p, 'raw NUL in string');
  if (hasLoneSurrogate(v)) return err('E_INVALID_UTF8', p, 'lone surrogate');
  return OK;
}
function checkRelPosixPath(v: unknown, p: string): ValidationResult {
  const s = checkString(v, p); if (!s.ok) return s;
  const str = v as string;
  if (!isNfc(str)) return err('E_NOT_NFC', p, 'path not NFC');
  if (str.length === 0 || str.charAt(0) === '/' || str.indexOf('\\') !== -1 || /(?:^|\/)\.\.?(?:\/|$)/.test(str) || /^[A-Za-z]:/.test(str)) {
    return err('E_REL_PATH', p, 'not a relative POSIX path');
  }
  if (textHasSecret(str)) return err('E_SECRET_CONTENT', p, 'secret-shaped path'); // amendment 5
  return OK;
}
function checkHex(v: unknown, re: RegExp, code: EvidenceErrorCode, p: string): ValidationResult {
  const s = checkString(v, p); if (!s.ok) return s;
  if (!re.test(v as string)) return err(code, p, `bad format at ${p}`);
  return OK;
}
function closedObject(v: unknown, keys: readonly string[], p: string): ValidationResult {
  const od = ordinaryDataObject(v, p); if (!od.ok) return od; // amendment 2 + red-team hardening
  for (const k of Object.keys(v as object)) if (keys.indexOf(k) === -1) return err('E_UNKNOWN_FIELD', `${p}.${k}`, `unknown field ${k}`);
  // amendment 1: required fields must be OWN properties — an inherited field disappears from canonical
  // bytes (Object.keys) and would not bind into the digest.
  for (const k of keys) if (!Object.prototype.hasOwnProperty.call(v as object, k)) return err('E_MISSING_FIELD', `${p}.${k}`, `missing own field ${k}`);
  return OK;
}
/** Open string→string map: ASCII-syntax keys (authority-screened + secret-scanned), NFC secret-free values. */
function checkStringMap(v: unknown, p: string): ValidationResult {
  const od = ordinaryDataObject(v, p); if (!od.ok) return od;
  for (const k of Object.keys(v as object)) {
    if (!MAP_KEY_RE.test(k)) return err('E_MAP_KEY', `${p}.${k}`, 'key not pinned-ASCII syntax');
    if (isAuthorityShapedKey(k)) return err('E_AUTHORITY_SHAPED_KEY', `${p}.${k}`, `authority-shaped key ${k}`);
    if (textHasSecret(k)) return err('E_SECRET_CONTENT', `${p}.${k}`, 'secret-shaped map key'); // red-team: keys too
    const val = (v as Record<string, unknown>)[k];
    const cv = checkString(val, `${p}.${k}`); if (!cv.ok) return cv;
    if (!isNfc(val as string)) return err('E_MAP_VALUE_NFC', `${p}.${k}`, 'value not NFC');
    if (textHasSecret(val as string)) return err('E_SECRET_CONTENT', `${p}.${k}`, 'secret-shaped map value'); // amendment 5
  }
  return OK;
}
function checkPathArraySortedUnique(v: unknown, p: string): ValidationResult {
  const oa = ordinaryDataArray(v, p); if (!oa.ok) return oa;
  const arr = v as unknown[];
  for (let i = 0; i < arr.length; i++) {
    const c = checkRelPosixPath(arr[i], `${p}[${i}]`); if (!c.ok) return c;
    if (i > 0) {
      if ((arr[i - 1] as string) > (arr[i] as string)) return err('E_ARRAY_UNSORTED', `${p}[${i}]`, 'not sorted');
      if ((arr[i - 1] as string) === (arr[i] as string)) return err('E_DUP_PATH', `${p}[${i}]`, 'duplicate');
    }
  }
  return OK;
}

function checkFile(v: unknown, p: string): ValidationResult {
  const c = closedObject(v, FILE_KEYS, p); if (!c.ok) return c;
  const o = v as Record<string, unknown>;
  const cp = checkRelPosixPath(o.path, `${p}.path`); if (!cp.ok) return cp;
  if (o.kind !== 'text' && o.kind !== 'binary') return err('E_BAD_ENUM', `${p}.kind`, 'kind');
  if (!safeIntGE0(o.originalSizeBytes)) return err('E_BAD_INTEGER', `${p}.originalSizeBytes`, 'int>=0');
  if (!safeIntGE0(o.includedByteStart)) return err('E_BAD_INTEGER', `${p}.includedByteStart`, 'int>=0');
  if (!safeIntGE0(o.includedByteEnd)) return err('E_BAD_INTEGER', `${p}.includedByteEnd`, 'int>=0');
  if (typeof o.truncated !== 'boolean') return err('E_WRONG_TYPE', `${p}.truncated`, 'boolean');
  const cfs = checkHex(o.fullSha256, SHA256_RE, 'E_BAD_SHA', `${p}.fullSha256`); if (!cfs.ok) return cfs;
  const cis = checkHex(o.includedSha256, SHA256_RE, 'E_BAD_SHA', `${p}.includedSha256`); if (!cis.ok) return cis;
  if (o.encoding !== 'utf8' && o.encoding !== 'base64') return err('E_BAD_ENUM', `${p}.encoding`, 'encoding');
  const cc = checkString(o.content, `${p}.content`); if (!cc.ok) return cc;
  const start = o.includedByteStart as number, end = o.includedByteEnd as number, orig = o.originalSizeBytes as number;
  if (!(start <= end && end <= orig)) return err('E_BAD_RANGE', p, 'byte range');
  if (o.truncated !== (start > 0 || end < orig)) return err('E_BAD_RANGE', `${p}.truncated`, 'truncated flag inconsistent');
  if (o.kind === 'binary' && o.encoding !== 'base64') return err('E_BINARY_INLINE', `${p}.encoding`, 'binary must be base64');
  if (o.kind === 'text' && o.encoding !== 'utf8') return err('E_BINARY_INLINE', `${p}.encoding`, 'text must be utf8');

  const content = o.content as string;
  let bytes: Uint8Array;
  let secret: boolean;
  if (o.encoding === 'utf8') {
    bytes = encoder.encode(content);
    secret = textHasSecret(content);
  } else {
    const decoded = decodeBase64Canonical(content);
    if (decoded === null) return err('E_BASE64_NONCANONICAL', `${p}.content`, 'non-canonical base64');
    bytes = decoded;
    secret = decodedBytesHaveSecret(bytes);
  }
  const included = end - start;
  if (bytes.length !== included) return err('E_CONTENT_LENGTH', `${p}.content`, 'decoded length != included range');
  if (sha256Hex(bytes) !== o.includedSha256) return err('E_HASH_INCLUDED', `${p}.includedSha256`, 'included hash mismatch');
  if (start === 0 && end === orig && o.includedSha256 !== o.fullSha256) return err('E_HASH_COMPLETE', `${p}`, 'complete file: includedSha256 must equal fullSha256');
  if (secret) return err('E_SECRET_CONTENT', `${p}.content`, 'secret-shaped included content');
  return OK;
}

function checkOmission(v: unknown, p: string): ValidationResult {
  const c = closedObject(v, OMISSION_KEYS, p); if (!c.ok) return c;
  const o = v as Record<string, unknown>;
  const cp = checkRelPosixPath(o.path, `${p}.path`); if (!cp.ok) return cp;
  if (typeof o.reason !== 'string' || (OMISSION_REASONS as readonly string[]).indexOf(o.reason) === -1) return err('E_OMISSION_REASON', `${p}.reason`, 'reason not a closed enum code');
  if (o.originalSizeBytes !== null && !safeIntGE0(o.originalSizeBytes)) return err('E_BAD_INTEGER', `${p}.originalSizeBytes`, 'int>=0|null');
  if (o.sha256 !== null) { const cs = checkHex(o.sha256, SHA256_RE, 'E_BAD_SHA', `${p}.sha256`); if (!cs.ok) return cs; }
  return OK;
}

function checkTest(v: unknown, p: string): ValidationResult {
  const c = closedObject(v, TEST_KEYS, p); if (!c.ok) return c;
  const o = v as Record<string, unknown>;
  const oc = ordinaryDataArray(o.command, `${p}.command`); if (!oc.ok) return oc;
  const cmd = o.command as unknown[];
  for (let i = 0; i < cmd.length; i++) {
    const cs = checkString(cmd[i], `${p}.command[${i}]`); if (!cs.ok) return cs;
    if (!isNfc(cmd[i] as string)) return err('E_NOT_NFC', `${p}.command[${i}]`, 'argv not NFC');
    if (textHasSecret(cmd[i] as string)) return err('E_SECRET_CONTENT', `${p}.command[${i}]`, 'secret-shaped argv'); // amendment 5
  }
  const cw = checkString(o.cwdRelative, `${p}.cwdRelative`); if (!cw.ok) return cw;
  const cwd = o.cwdRelative as string;
  if (cwd !== '.') { const cr = checkRelPosixPath(cwd, `${p}.cwdRelative`); if (!cr.ok) return err('E_CWD', `${p}.cwdRelative`, 'cwd must be relative POSIX or "."'); }
  if (textHasSecret(cwd)) return err('E_SECRET_CONTENT', `${p}.cwdRelative`, 'secret-shaped cwd'); // amendment 5
  if (!safeInt(o.exitCode)) return err('E_BAD_INTEGER', `${p}.exitCode`, 'int');
  const so = checkHex(o.stdoutSha256, SHA256_RE, 'E_BAD_SHA', `${p}.stdoutSha256`); if (!so.ok) return so;
  const se = checkHex(o.stderrSha256, SHA256_RE, 'E_BAD_SHA', `${p}.stderrSha256`); if (!se.ok) return se;
  if (!safeIntGE0(o.stdoutBytes)) return err('E_BAD_INTEGER', `${p}.stdoutBytes`, 'int>=0');
  if (!safeIntGE0(o.stderrBytes)) return err('E_BAD_INTEGER', `${p}.stderrBytes`, 'int>=0');
  const ex = checkString(o.stdoutExcerpt, `${p}.stdoutExcerpt`); if (!ex.ok) return ex;
  const ee = checkString(o.stderrExcerpt, `${p}.stderrExcerpt`); if (!ee.ok) return ee;
  if (textHasSecret(o.stdoutExcerpt as string) || textHasSecret(o.stderrExcerpt as string)) return err('E_SECRET_CONTENT', `${p}.excerpt`, 'secret-shaped test excerpt');
  // amendment 8 (red-team-tightened): the excerpt IS the committed stream — a truncated excerpt's full-stream
  // hash is unverifiable without the preimage, so bind ALWAYS: byteLength and sha256 must match the claim.
  const soExc = o.stdoutExcerpt as string, seExc = o.stderrExcerpt as string;
  if (utf8Len(soExc) !== (o.stdoutBytes as number)) return err('E_STREAM_LENGTH', `${p}.stdoutExcerpt`, 'excerpt bytes != claimed stdout bytes');
  if (sha256Hex(encoder.encode(soExc)) !== o.stdoutSha256) return err('E_STREAM_HASH', `${p}.stdoutSha256`, 'excerpt hash != claimed stdout sha');
  if (utf8Len(seExc) !== (o.stderrBytes as number)) return err('E_STREAM_LENGTH', `${p}.stderrExcerpt`, 'excerpt bytes != claimed stderr bytes');
  if (sha256Hex(encoder.encode(seExc)) !== o.stderrSha256) return err('E_STREAM_HASH', `${p}.stderrSha256`, 'excerpt hash != claimed stderr sha');
  if (o.durationMs !== null && !safeIntGE0(o.durationMs)) return err('E_BAD_INTEGER', `${p}.durationMs`, 'int>=0|null');
  const tv = checkStringMap(o.toolVersions, `${p}.toolVersions`); if (!tv.ok) return tv;
  return OK;
}

function checkArraySorted(v: unknown, p: string, each: (x: unknown, pp: string) => ValidationResult, key: (x: unknown) => string, dupCode: EvidenceErrorCode | null): ValidationResult {
  const oa = ordinaryDataArray(v, p); if (!oa.ok) return oa;
  const arr = v as unknown[];
  let prev: string | null = null;
  for (let i = 0; i < arr.length; i++) {
    const c = each(arr[i], `${p}[${i}]`); if (!c.ok) return c;
    const k = key(arr[i]);
    if (prev !== null) {
      if (prev > k) return err('E_ARRAY_UNSORTED', `${p}[${i}]`, 'not sorted');
      if (dupCode !== null && prev === k) return err(dupCode, `${p}[${i}]`, 'duplicate identity');
    }
    prev = k;
  }
  return OK;
}

/** UTF-8 byte-length-framed injective identity (contract decision 10). */
function testIdentity(t: unknown): string {
  const o = t as Record<string, unknown>;
  const cmd = Array.isArray(o.command) ? (o.command as string[]) : [];
  const parts = cmd.map((a) => `${utf8Len(a)}:${a}`).join(',');
  const cwd = String(o.cwdRelative);
  return `${parts}#${utf8Len(cwd)}:${cwd}`;
}

export function validatePackBody(x: unknown): ValidationResult {
  const c = closedObject(x, PACK_KEYS, 'body'); if (!c.ok) return c;
  const b = x as Record<string, unknown>;

  if (b.schema !== EVIDENCE_PACK_SCHEMA) return err('E_SCHEMA', 'body.schema', 'wrong schema');
  if (b.advisoryOnly !== true) return err('E_ADVISORY_LITERAL', 'body.advisoryOnly', 'must be literal true');
  if (b.grantsAuthority !== false) return err('E_ADVISORY_LITERAL', 'body.grantsAuthority', 'must be literal false');

  const cr = checkString(b.repoId, 'body.repoId'); if (!cr.ok) return cr;
  if (!isNfc(b.repoId as string)) return err('E_NOT_NFC', 'body.repoId', 'repoId not NFC'); // amendment 12
  if (textHasSecret(b.repoId as string)) return err('E_SECRET_CONTENT', 'body.repoId', 'secret-shaped repoId'); // amendment 5
  const ch = checkHex(b.headCommit, GITSHA_RE, 'E_BAD_GITSHA', 'body.headCommit'); if (!ch.ok) return ch;
  const ct = checkHex(b.headTree, GITSHA_RE, 'E_BAD_GITSHA', 'body.headTree'); if (!ct.ok) return ct;
  const baseNull = b.baseCommit === null && b.baseTree === null;
  if (!baseNull) {
    if (b.baseCommit === null || b.baseTree === null) return err('E_BASE_PAIR', 'body.base', 'baseCommit and baseTree must both be present or both null');
    const cbc = checkHex(b.baseCommit, GITSHA_RE, 'E_BAD_GITSHA', 'body.baseCommit'); if (!cbc.ok) return cbc;
    const cbt = checkHex(b.baseTree, GITSHA_RE, 'E_BAD_GITSHA', 'body.baseTree'); if (!cbt.ok) return cbt;
  }

  const cf = checkArraySorted(b.files, 'body.files', checkFile, (f) => (f as Record<string, unknown>).path as string, 'E_DUP_PATH'); if (!cf.ok) return cf;
  const co = checkArraySorted(b.omissions, 'body.omissions', checkOmission, (f) => (f as Record<string, unknown>).path as string, 'E_DUP_PATH'); if (!co.ok) return co;
  const cte = checkArraySorted(b.testRuns, 'body.testRuns', checkTest, testIdentity, 'E_DUP_TEST'); if (!cte.ok) return cte;
  const cal = checkPathArraySortedUnique(b.rootAllowlist, 'body.rootAllowlist'); if (!cal.ok) return cal;

  // Exact partition: files.path ∪ omissions.path = rootAllowlist, files ∩ omissions = ∅ (decision 6/amendment 6).
  const filePaths = (b.files as Array<Record<string, unknown>>).map((f) => f.path as string);
  const omitPaths = (b.omissions as Array<Record<string, unknown>>).map((f) => f.path as string);
  const union = new Set([...filePaths, ...omitPaths]);
  if (union.size !== filePaths.length + omitPaths.length) return err('E_PARTITION', 'body', 'files and omissions overlap');
  const allow = new Set(b.rootAllowlist as string[]);
  if (union.size !== allow.size) return err('E_PARTITION', 'body.rootAllowlist', 'allowlist != files ∪ omissions');
  for (const pth of union) if (!allow.has(pth)) return err('E_PARTITION', 'body.rootAllowlist', `path not in allowlist: ${pth}`);

  const cli = checkString(b.limitsProfileId, 'body.limitsProfileId'); if (!cli.ok) return cli;
  const profile = LIMITS_PROFILES[b.limitsProfileId as string];
  if (!profile) return err('E_LIMIT_PROFILE', 'body.limitsProfileId', 'unknown limits profile');
  // amendment 3: the file ceiling is TOTAL — the exact partition makes rootAllowlist = files ∪ omissions,
  // so cap the allowlist length (a large omissions[] can no longer bypass maxFiles).
  if ((b.rootAllowlist as string[]).length > profile.maxFiles) return err('E_LIMIT_ALLOWLIST', 'body.rootAllowlist', 'files + omissions exceeds maxFiles');

  const cbt2 = checkStringMap(b.builderToolVersions, 'body.builderToolVersions'); if (!cbt2.ok) return cbt2;
  const cci = checkHex(b.catalogueId, SHA256_RE, 'E_BAD_SHA', 'body.catalogueId'); if (!cci.ok) return cci;
  if (b.catalogueId !== catalogueId()) return err('E_CATALOGUE_ID', 'body.catalogueId', 'catalogueId not bound to the library catalogue');

  const files = b.files as Array<Record<string, unknown>>;
  if (files.length > profile.maxFiles) return err('E_LIMIT_FILES', 'body.files', 'exceeds maxFiles');
  for (let i = 0; i < files.length; i++) {
    if ((files[i].includedByteEnd as number) - (files[i].includedByteStart as number) > profile.maxFileBytes) return err('E_LIMIT_FILE_BYTES', `body.files[${i}]`, 'included bytes exceed maxFileBytes');
  }
  if (canonicalBytes(b).length > profile.maxPackBytes) return err('E_LIMIT_PACK_BYTES', 'body', 'canonical size exceeds maxPackBytes');
  return OK;
}

export function validateEnvelope(x: unknown): ValidationResult {
  const c = closedObject(x, ['body', 'packDigest'], 'envelope'); if (!c.ok) return c;
  const e = x as Record<string, unknown>;
  const vb = validatePackBody(e.body); if (!vb.ok) return vb;
  const cd = checkHex(e.packDigest, SHA256_RE, 'E_BAD_SHA', 'envelope.packDigest'); if (!cd.ok) return cd;
  if (e.packDigest !== packDigest(e.body)) return err('E_DIGEST_MISMATCH', 'envelope.packDigest', 'digest echo mismatch');
  return OK;
}

export { AUTHORITY_KEY_RE, testIdentity };
