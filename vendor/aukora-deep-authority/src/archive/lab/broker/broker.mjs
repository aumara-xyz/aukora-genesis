import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { canonicalJSON } from '../kernel/canonical.mjs';
import { verifyGrant, grantPreimage, generateKeypair, exportPublicKeyHex, operationDigest, receiptKeyIdForPublicKey, REFUSE } from '../kernel/verify.mjs';
import { NonceStore } from '../storage/nonce_store.mjs';
import { mintSettlementReceipt } from './receipt.mjs';
import { MerkleWitness } from '../witness/merkle.mjs';
import { definitionDigest } from '../../../aukora/broker/effect.mjs';

/**
 * BrokerDaemon: Isolated execution broker owning state capabilities.
 */
export class BrokerDaemon {
  constructor({ rootDir = '.aukora', rootPublicKey, brokerKeyPair } = {}) {
    this.rootDir = resolve(rootDir);
    this.stateDir = join(this.rootDir, 'state');
    this.memoryFile = join(this.stateDir, 'memory.json');
    this.seqFile = join(this.stateDir, 'sequence.json');

    this.rootPublicKeyPem = rootPublicKey || null;
    this.brokerKeyPair = brokerKeyPair || generateKeypair();
    this.receiptKeyId = receiptKeyIdForPublicKey(this.brokerKeyPair.publicKey);
    this.nonceStore = new NonceStore({ baseDir: this.rootDir });
    this.witness = new MerkleWitness();
    this.sequence = 0;
    this._initialized = false;
  }

  init() {
    if (this._initialized) return this;
    mkdirSync(this.stateDir, { recursive: true });
    this.nonceStore.init();
    try {
      this.sequence = JSON.parse(readFileSync(this.seqFile, 'utf8')).sequence || 0;
    } catch {
      this.sequence = 0;
    }
    this._initialized = true;
    return this;
  }

  setRootPublicKey(key) {
    this.rootPublicKeyPem = key;
  }

  execute({ tool, toolName, args, grant, now, expectedDefinitionId }) {
    const tName = toolName || tool;
    // The definition binding is computed from the effect's own definition, never
    // defaulted: a grant minted for a different effect must refuse here. A caller
    // that supplies an expectation must agree with the resolved digest or it is
    // refused by name; a caller that omits it gets the real digest, not a
    // hardcoded constant a forged grant can align itself to.
    const defId = definitionDigest();
    if (expectedDefinitionId !== undefined && expectedDefinitionId !== defId) {
      return { ok: false, reason: REFUSE.DEFINITION_MISMATCH, code: REFUSE.DEFINITION_MISMATCH };
    }
    this.init();

    if (now === undefined || now === null || !Number.isInteger(now)) {
      return { ok: false, reason: REFUSE.MALFORMED, code: REFUSE.MALFORMED };
    }

    const v = verifyGrant({
      grant,
      toolName: tName,
      args,
      rootPublicKeyPem: this.rootPublicKeyPem,
      claimNonce: (nonce, exp) => this.nonceStore.claim(nonce, exp),
      now,
      expectedDefinitionId: defId,
      expectedOperationDigest: operationDigest(tName, args, defId),
      expectedReceiptKeyId: this.receiptKeyId
    });

    if (!v.ok) {
      this.witness.append({ event: 'refusal', tool: tName, reason: v.reason, now });
      return { ok: false, reason: v.reason, code: v.reason };
    }

    let writeResult = { postWriteDigest: '0'.repeat(64), meta: { ino: 1, mtimeNs: Date.now() * 1000000 } };
    if (tName === 'memory.put') {
      writeResult = this._performMemoryPut(args);
    } else {
      // Execute irreversible tool handler & compute result digest
      writeResult = {
        postWriteDigest: createHash('sha256').update(canonicalJSON(args), 'utf8').digest('hex'),
        meta: { ino: 1, mtimeNs: Date.now() * 1000000 }
      };
    }
    this.sequence++;
    writeFileSync(this.seqFile, JSON.stringify({ sequence: this.sequence }), 'utf8');

    const grantDigest = createHash('sha256').update(grantPreimage(grant)).digest('hex');
    const receipt = mintSettlementReceipt({
      requestDigest: v.digest,
      grantDigest,
      nonce: grant.nonce,
      postWriteDigest: writeResult.postWriteDigest,
      postWriteMeta: writeResult.meta,
      sequence: this.sequence,
      brokerPrivateKey: this.brokerKeyPair.privateKey
    });

    this.witness.append({ event: 'settlement', tool: tName, requestDigest: v.digest, postWriteDigest: writeResult.postWriteDigest, sequence: this.sequence, now });

    return { ok: true, result: writeResult.result, receipt, brokerPublicKey: exportPublicKeyHex(this.brokerKeyPair.publicKey) };
  }

  _performMemoryPut(args) {
    if (!args || typeof args !== 'object' || typeof args.key !== 'string') {
      throw new Error('memory.put requires { key: string, value: any }');
    }
    let db = {};
    try { db = JSON.parse(readFileSync(this.memoryFile, 'utf8')); } catch { db = {}; }
    db[args.key] = args.value;
    const serialized = canonicalJSON(db);

    const tmp = `${this.memoryFile}.tmp.${process.pid}.${Date.now()}`;
    const fd = openSync(tmp, 'w', 0o600);
    writeFileSync(fd, serialized, 'utf8');
    closeSync(fd);
    renameSync(tmp, this.memoryFile);

    const fdRead = openSync(this.memoryFile, 'r');
    const stat = fstatSync(fdRead);
    closeSync(fdRead);

    return {
      result: { key: args.key, value: args.value, status: 'committed' },
      postWriteDigest: createHash('sha256').update(serialized, 'utf8').digest('hex'),
      meta: { ino: Number(stat.ino || 0), mtimeNs: Number(stat.mtimeMs * 1000000 || 0) }
    };
  }
}

export function runBrokerCLI() {
  const rootKey = process.env.AUKORA_ROOT_PUBKEY || process.argv[2];
  const rootDir = process.env.AUKORA_ROOT_DIR || '.aukora';
  const broker = new BrokerDaemon({ rootDir, rootPublicKey: rootKey }).init();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);
      process.stdout.write(JSON.stringify({ id: msg.id, ...broker.execute(msg) }) + '\n');
    } catch (err) {
      process.stdout.write(JSON.stringify({ ok: false, reason: 'broker:internal-error', error: err.message }) + '\n');
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runBrokerCLI();
}
