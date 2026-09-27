export const MEMORY_SCOPES = ['identity', 'architecture', 'evidence', 'doc', 'test', 'code', 'general'];
// Donor `isTestFile` (kiraBrain.ts): `/(^|\/)tests?\//` on the path, or `\.(test|spec)\.[tj]sx?$` on the name.
// Applied here to the record's `provenance` (which may carry a `links`/path reference) and content.
const TEST_PATH = /(^|\/)tests?\//i;
const TEST_NAME = /\.(test|spec)\.[tj]sx?(\b|$)/i;
const TEST_BODY = /\b(describe|it|expect|vitest|beforeAll|afterAll)\s*\(/;
// Identity signal — the anchor vocabulary #62 names ("who am I", maternal anchor, the five values).
const IDENTITY = /\b(maternal[\s_-]?anchor|who\s+am\s+i|the\s+five\s+values|MATERNAL_ANCHOR|identity[\s_-]?corpus|my\s+name\s+is)\b/i;
const ARCHITECTURE = /\b(architecture|boundary|boundaries|safety\s+law|ARCHITECTURE\.md|invariant)\b/i;
const EVIDENCE = /\b(receipt|evidence|proof|attestation|chain\s?hash|merkle)\b/i;
const DOC = /\b(readme|\.md\b|documentation|runbook|spec\b)\b/i;
const CODE = /\b(export\s+(function|const|class|interface|type)|import\s+\{|=>\s*\{|module\.exports)\b/;
function haystack(record) {
    return `${record.provenance}\n${record.content}`;
}
/**
 * Classify a record's scope. Precedence is DONOR-AUTHORITATIVE on structure (falsification cycle 2): a record
 * whose provenance is a test PATH/NAME, or whose content is literally test code (`describe(`/`it(`/`expect(`),
 * is TEST — even if it mentions identity vocabulary. This closes the re-pollution hole where a test file quoting
 * "maternal anchor" would masquerade as an identity atom and re-fill the empty shelf with noise (the exact #62
 * failure, inverted). Only AFTER structural test-detection does content-signal apply: identity, then
 * architecture, evidence, doc, code, general. So genuine identity CONTENT under a non-test provenance surfaces,
 * while a test that merely discusses identity does not.
 */
export function classifyScope(record) {
    const hay = haystack(record);
    if (TEST_PATH.test(hay) || TEST_NAME.test(hay) || TEST_BODY.test(record.content))
        return 'test';
    if (IDENTITY.test(hay))
        return 'identity';
    if (ARCHITECTURE.test(hay))
        return 'architecture';
    if (EVIDENCE.test(hay))
        return 'evidence';
    if (DOC.test(hay))
        return 'doc';
    if (CODE.test(record.content))
        return 'code';
    return 'general';
}
/** Live-only scope census — the #62 diagnostic (`identity:0, tests:70, …`). Forgotten records are excluded. */
export function scopeCensus(records, forgotten = new Set()) {
    const census = { identity: 0, architecture: 0, evidence: 0, doc: 0, test: 0, code: 0, general: 0 };
    for (const r of records)
        if (!forgotten.has(r.recordId))
            census[classifyScope(r)] += 1;
    return census;
}
/**
 * Does the LIVE corpus hold any record of `scope`? The honest "is the shelf empty?" signal: a consumer can tell
 * "identity corpus absent" (`false`) from "retrieval bias" (`true` but the query missed) — the exact distinction
 * #62 demands. Forgotten records do not count (a forgotten identity atom is gone, not present).
 */
export function hasScope(records, scope, forgotten = new Set()) {
    for (const r of records)
        if (!forgotten.has(r.recordId) && classifyScope(r) === scope)
            return true;
    return false;
}
