/**
 * QUARANTINED LAB SURFACE — NOT A VERIFIED SURFACE, NOT A PRODUCTION PATH.
 *
 * This tree was `src/` at the repository root until it was moved here. It is
 * the transplant lab: an earlier, ungoverned implementation kept because
 * `scripts/run-gate.mjs` still exercises parts of it (the organism court reads
 * `kernel/aumlok.mjs`, `witness/chain.mjs`, and `storage/kira.mjs`; the four
 * `test/*.test.mjs` suites read this barrel). Deleting it would turn those
 * green rows into carpentry, so it is quarantined rather than removed.
 *
 * The production governed path is `@deepseek-ai/dsh-aukora-memory` over
 * `aukora/`. Nothing in `aukora/` or `packages/` imports this tree.
 *
 * MEASURED DEFECTS IN WHAT THIS BARREL STILL EXPORTS. These are not
 * hypothetical; each was reproduced against this code:
 *
 * - `staging/journal.mjs` (`StagingJournal`) accepts path traversal. Its only
 *   normalization is `relPath.replace(/\\/g, '/')` at `_ensureTracked` and
 *   `writeFile`; there is no `..` rejection and no containment check, so a
 *   `relPath` of `../../x` escapes `workspaceDir` and still commits `ok: true`.
 * - `broker/provenance.mjs` (`ChannelProvenanceTracker`) treats an empty
 *   declaration as success — `verifyEmissionProvenance` returns
 *   `{ ok: true, note: 'zero-provenance-dependencies' }` when `declaredTokens`
 *   is empty, and the caller declares its own dependencies, so declaring none
 *   passes the anti-laundering check. Its constructor also defaults
 *   `brokerSecret` to a hardcoded literal.
 *
 * Both remain exported ONLY because the gate suites above construct them.
 * Do not import either from anything that is not one of those suites.
 *
 * DELIBERATELY NOT EXPORTED (zero consumers in this repository; verified by
 * symbol search before removal):
 * - `guardian/protector.mjs` — `ProtectorGuardian.requestMicroGrant` mints a
 *   grant with no envelope at all (`this.envelope = envelope || null`, every
 *   policy check guarded by `if (this.envelope)`), and `verifyMasterEnvelope`
 *   is defined but never called from the mint path, so even a supplied
 *   envelope is trusted as passed.
 * - `worker/worker.mjs` — `WorkerClient.spawnBroker` launches
 *   `broker/broker.mjs`, the ungoverned BrokerDaemon this barrel already
 *   excludes. Excluding the daemon while exporting its launcher excluded
 *   nothing.
 * - `broker/broker.mjs` (`BrokerDaemon`) — the old ungoverned effect path.
 *   Imported directly by two gate suites; never through this barrel.
 * - signing primitives (`mintGrant`, `signGrant`, `signPreimage`) from
 *   `kernel/verify.mjs`. The only minter on the production path is
 *   `aukora/issuer/mint.mjs`.
 *
 * @module archive/lab/index
 */
export * from './kernel/canonical.mjs';
// kernel/verify.mjs: everything EXCEPT mintGrant/signGrant/signPreimage
// (signing primitives live only in aukora/issuer/mint.mjs)
export {
  canonicalJSON,
  GRANT_DOMAIN, MAX_TTL_SECONDS, REFUSE, GRANT_KEYS,
  payloadDigest, operationDigest, receiptKeyIdForPublicKey, grantPreimage, verifyGrant,
  importPublicKey, importPrivateKey,
  exportPublicKeyHex, exportPublicKeyPem,
  generateKeypair, newNonce,
  verifySignature,
} from './kernel/verify.mjs';
export * from './kernel/aumlok.mjs';
export * from './kernel/tcb.mjs';
export * from './kernel/provide_once.mjs';
export * from './storage/nonce_store.mjs';
export * from './storage/kira.mjs';
// ./broker/broker.mjs excluded: ungoverned BrokerDaemon (lab-only effect path)
export * from './broker/receipt.mjs';
export * from './broker/gatekeeper.mjs';
export * from './broker/withholding.mjs';
export * from './broker/provenance.mjs';
export * from './staging/journal.mjs';
export * from './staging/confluence.mjs';
export * from './renderer/two_column.mjs';
export * from './guardian/policy_meet.mjs';
export { leafHash, nodeHash, merkleRoot, inclusionProof, verifyInclusion, consistencyProof, emptyRootHash, MerkleWitness } from './witness/merkle.mjs';
// rootFromLeafHashes excluded: internal fold for MerkleWitness only
export * from './witness/chain.mjs';
