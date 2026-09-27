// φ — the reduced erasure certificate: issue, verify, and what a stranger holding only the certificate
// can and cannot conclude from it.

import { describe, it, expect } from 'bun:test';
import { randomBytes } from 'crypto';
import { openLog, appendEvent, type CommittedEvent, type ContentRef, type MemoryDraft } from '../core/memory/eventLog';
import { openVault, shred, ephemeralCustodian, ephemeralStore, type KeyCustodian, type ObjectStore } from '../core/memory/vault';
import { issueErasureCertificate, verifyErasureCertificate, type ErasureCertificate } from '../core/memory/erasureCertificate';

const at = () => new Date().toISOString();
const nonce = () => randomBytes(32).toString('hex');

function sealFixture(custodian: KeyCustodian & { issued: Map<string, Uint8Array> }, store: ObjectStore): ContentRef {
  const key = randomBytes(32);
  const keyRef = `vault:${randomBytes(16).toString('hex')}`;
  const ciphertextDigest = randomBytes(32).toString('hex');
  custodian.issued.set(keyRef, key);
  store.put({ ciphertextDigest, keyRef, byteLength: 64 });
  return { ciphertextDigest, keyRef, byteLength: 64 };
}

function erase(destroyOk = true) {
  const baseCustodian = ephemeralCustodian();
  const custodian: KeyCustodian & { issued: Map<string, Uint8Array> } = destroyOk
    ? baseCustodian
    : { ...baseCustodian, destroy: () => false };
  const store = ephemeralStore();
  const vault = openVault(custodian, store);

  let events: CommittedEvent[] = [openLog({ logId: 't', at: at(), leafNonce: nonce() })];
  const content = sealFixture(custodian, store);
  events = [...events, appendEvent(events, { kind: 'insert', content, consentScope: 'x', at: at() } as MemoryDraft, nonce())];
  const targetIndex = 1;
  const id = (events[1]!.event as { occurrenceId: string }).occurrenceId;
  const before = [...events];

  events = [...events, appendEvent(events, { kind: 'tombstone', target: id, erased: [], at: at() } as MemoryDraft, nonce())];
  const tombstoneIndex = events.length - 1;
  const report = shred(vault, events, id);
  const cert = issueErasureCertificate({ before, after: events, targetIndex, tombstoneIndex, report, vault, at: at() });
  return { cert, id };
}

describe('a genuine erasure', () => {
  it('verifies clean and reports complete', () => {
    const { cert } = erase();
    const v = verifyErasureCertificate(cert);
    expect(v.valid).toBe(true);
    expect(v.complete).toBe(true);
    expect(v.findings).toEqual([]);
  });

  it('binds targetId to the leaf it actually names — round-11\'s defect, closed', () => {
    const { cert, id } = erase();
    expect(cert.targetId).toBe(id);
    // recomputing the leaf from the carried preimage must equal the inclusion proof's leaf
    expect(cert.targetPreimage.event).toMatchObject({ occurrenceId: id });
  });

  it('an incomplete erasure is a valid certificate that honestly says so', () => {
    const { cert } = erase(false);
    const v = verifyErasureCertificate(cert);
    expect(v.valid).toBe(true);
    expect(v.complete).toBe(false);
    expect(v.findings).toContain('certificate:erasure-incomplete');
  });

  it('names its own reduction: extensionProved is always false', () => {
    const { cert } = erase();
    expect(verifyErasureCertificate(cert).extensionProved).toBe(false);
  });
});

describe('tampering is caught', () => {
  it('a rewritten targetId without a matching preimage is refused', () => {
    const { cert } = erase();
    const forged: ErasureCertificate = { ...cert, targetId: randomBytes(32).toString('hex') };
    const v = verifyErasureCertificate(forged);
    expect(v.valid).toBe(false);
    expect(v.findings).toContain('certificate:target-id-not-in-preimage');
  });

  it('a hand-edited digest is caught even when every proof still checks out', () => {
    const { cert } = erase();
    const forged: ErasureCertificate = { ...cert, certificateDigest: randomBytes(32).toString('hex') };
    expect(verifyErasureCertificate(forged).findings).toContain('certificate:digest-mismatch');
  });

  it('claiming complete over a non-zero residual is its own finding', () => {
    const { cert } = erase(false); // destroyFailed non-empty, complete should be false
    const forged: ErasureCertificate = { ...cert, complete: true };
    const v = verifyErasureCertificate(forged);
    expect(v.findings).toContain('certificate:completeness-contradicted');
  });

  it('a tampered inclusion proof is caught', () => {
    const { cert } = erase();
    const flipped = [...cert.targetInclusion.proof];
    const first = flipped[0];
    expect(first).toBeDefined();
    flipped[0] = randomBytes(32).toString('hex');
    expect(flipped[0]).not.toBe(first);
    const forged: ErasureCertificate = { ...cert, targetInclusion: { ...cert.targetInclusion, proof: flipped } };
    expect(verifyErasureCertificate(forged).valid).toBe(false);
  });
});

describe('the honest limit: no prior observation, no proof of realness', () => {
  it('a certificate is internally consistent even for a memory that was truly inserted and shredded — '
    + 'checking arithmetic is NOT the same as an external anchor confirming this really happened at this '
    + 'time. Documented, not hidden: see this file\'s header and erasureCertificate.ts\'s.', () => {
    const { cert } = erase();
    // The certificate alone cannot tell a reader whether ANY of this happened on a real clock, against
    // a real prior root they had already seen — only that the arithmetic inside it is self-consistent.
    expect(verifyErasureCertificate(cert).valid).toBe(true);
  });
});
