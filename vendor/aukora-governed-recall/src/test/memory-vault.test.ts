// φ — the vault contract: govern-before-execute, and the two questions `isReadable` and
// `keyMaterialSurvives` answer differently. Pure — `ephemeralCustodian`/`ephemeralStore`, no filesystem.
// `test/memory-filevault.test.ts` covers the real AES-256-GCM adapter.

import { describe, it, expect } from 'bun:test';
import { randomBytes } from 'crypto';
import { openLog, appendEvent, type CommittedEvent, type ContentRef, type MemoryDraft } from '../core/memory/eventLog';
import {
  openVault, releaseKey, shred, isReadable, keyMaterialSurvives, VaultRefusal,
  ephemeralCustodian, ephemeralStore, type KeyCustodian, type ObjectStore,
} from '../core/memory/vault';

const at = () => new Date().toISOString();
const nonce = () => randomBytes(32).toString('hex');

/** Seal a fixture value into an ephemeral custodian/store, mirroring `fileVaultAdapter.sealBytes`. */
function sealFixture(custodian: KeyCustodian & { issued: Map<string, Uint8Array> }, store: ObjectStore): ContentRef {
  const key = randomBytes(32);
  const keyRef = `vault:${randomBytes(16).toString('hex')}`;
  const ciphertextDigest = randomBytes(32).toString('hex');
  custodian.issued.set(keyRef, key);
  store.put({ ciphertextDigest, keyRef, byteLength: 64 });
  return { ciphertextDigest, keyRef, byteLength: 64 };
}

function setup() {
  const custodian = ephemeralCustodian();
  const store = ephemeralStore();
  const vault = openVault(custodian, store);
  let events: CommittedEvent[] = [openLog({ logId: 'test-log', at: at(), leafNonce: nonce() })];
  const content = sealFixture(custodian, store);
  const inserted = appendEvent(events, { kind: 'insert', content, consentScope: 'x', at: at() } as MemoryDraft, nonce());
  events = [...events, inserted];
  const id = (inserted.event as { occurrenceId: string }).occurrenceId;
  return { custodian, store, vault, events, id };
}

describe('govern before execute', () => {
  it('shred refuses without an accepted tombstone naming the target', () => {
    const { vault, events, id } = setup();
    expect(() => shred(vault, events, id)).toThrow(VaultRefusal);
    try { shred(vault, events, id); } catch (e) { expect((e as VaultRefusal).reasonClass).toBe('vault:shred-unrecorded'); }
  });

  it('once the tombstone is recorded, shred destroys the key and drops the ciphertext', () => {
    const { custodian, store, vault, events, id } = setup();
    const insertEvent = events[1]!.event as { content: ContentRef };
    const { keyRef, ciphertextDigest } = insertEvent.content;
    expect(custodian.issued.has(keyRef)).toBe(true);
    expect(store.has(ciphertextDigest)).toBe(true);

    const tombstoned = [...events, appendEvent(events, { kind: 'tombstone', target: id, erased: [], at: at() } as MemoryDraft, nonce())];
    const report = shred(vault, tombstoned, id);
    expect(report.complete).toBe(true);
    expect(report.shredded).toEqual([id]);
    expect(custodian.issued.has(keyRef)).toBe(false);
    expect(store.has(ciphertextDigest)).toBe(false);
  });
});

describe('isReadable vs keyMaterialSurvives — the audit is not the retrieval layer', () => {
  it('before shredding, both agree the memory is live and keyed', () => {
    const { vault, events, id } = setup();
    expect(isReadable(vault, events, id)).toBe(true);
    expect(keyMaterialSurvives(vault, events, id)).toBe(true);
  });

  it('a recorded tombstone alone (no shred yet) makes isReadable false while the key still survives', () => {
    const { vault, events, id } = setup();
    const tombstoned = [...events, appendEvent(events, { kind: 'tombstone', target: id, erased: [], at: at() } as MemoryDraft, nonce())];
    expect(isReadable(vault, tombstoned, id)).toBe(false);
    expect(keyMaterialSurvives(vault, tombstoned, id)).toBe(true);
  });

  it('after a real shred, both are false — the certificate can actually report a clean erasure', () => {
    const { vault, events, id } = setup();
    const tombstoned = [...events, appendEvent(events, { kind: 'tombstone', target: id, erased: [], at: at() } as MemoryDraft, nonce())];
    shred(vault, tombstoned, id);
    expect(isReadable(vault, tombstoned, id)).toBe(false);
    expect(keyMaterialSurvives(vault, tombstoned, id)).toBe(false);
  });

  it('a custodian that FAILS to destroy is caught by keyMaterialSurvives, not smoothed into alreadyGone', () => {
    const custodian: KeyCustodian & { issued: Map<string, Uint8Array> } = {
      ...ephemeralCustodian(),
      destroy: () => false, // lies: refuses to actually destroy
    };
    const store = ephemeralStore();
    const vault = openVault(custodian, store);
    let events: CommittedEvent[] = [openLog({ logId: 't', at: at(), leafNonce: nonce() })];
    const content = sealFixture(custodian, store);
    events = [...events, appendEvent(events, { kind: 'insert', content, consentScope: 'x', at: at() } as MemoryDraft, nonce())];
    const id = (events[1]!.event as { occurrenceId: string }).occurrenceId;
    events = [...events, appendEvent(events, { kind: 'tombstone', target: id, erased: [], at: at() } as MemoryDraft, nonce())];

    const report = shred(vault, events, id);
    expect(report.complete).toBe(false);
    expect(report.destroyFailed).toEqual([id]);
    expect(keyMaterialSurvives(vault, events, id)).toBe(true); // the honest, non-flattering answer
  });
});

describe('releaseKey', () => {
  it('releases the real key for a live memory', () => {
    const { custodian, vault, events, id } = setup();
    const key = releaseKey(vault, events, id);
    expect(key).toEqual([...custodian.issued.values()][0]!);
  });

  it('refuses once the memory is forgotten', () => {
    const { vault, events, id } = setup();
    const tombstoned = [...events, appendEvent(events, { kind: 'tombstone', target: id, erased: [], at: at() } as MemoryDraft, nonce())];
    expect(() => releaseKey(vault, tombstoned, id)).toThrow(VaultRefusal);
  });

  it('refuses an id the ledger never minted', () => {
    const { vault, events } = setup();
    expect(() => releaseKey(vault, events, randomBytes(32).toString('hex'))).toThrow(VaultRefusal);
  });
});
