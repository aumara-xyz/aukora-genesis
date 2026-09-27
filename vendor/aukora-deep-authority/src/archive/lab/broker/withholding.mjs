import { writeFileSync, readFileSync, existsSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJSON } from '../kernel/canonical.mjs';

/**
 * WithholdingEmissionBroker:
 * Enforces the Withholding Invariant: Log-Before-Emit.
 * Order: Verify ➔ Burn Nonce ➔ Append Durable Merkle Log ➔ Execute Outbound Emission.
 * Manages crash recovery and reconciles in-flight uncertainty into explicit UNKNOWN states.
 */
export class WithholdingEmissionBroker {
  constructor({ rootDir = '.aukora/emissions', witness, nonceStore } = {}) {
    this.rootDir = resolve(rootDir);
    this.journalDir = join(this.rootDir, 'journal');
    this.witness = witness;
    this.nonceStore = nonceStore;
    mkdirSync(this.journalDir, { recursive: true });
  }

  prepareEmission({ emissionId, toolName, args, grantDigest, nonce }) {
    const record = {
      emissionId,
      toolName,
      args,
      grantDigest,
      nonce,
      state: 'PREPARED',
      createdAt: Date.now()
    };
    const filePath = join(this.journalDir, `${emissionId}.json`);
    writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
    return record;
  }

  async executeWithholding({ emissionId, toolName, args, grant, claimNonceFn, emitFn }) {
    const filePath = join(this.journalDir, `${emissionId}.json`);
    let record = {
      emissionId,
      toolName,
      args,
      grantDigest: createHash('sha256').update(canonicalJSON(grant)).digest('hex'),
      nonce: grant.nonce,
      state: 'PREPARED',
      createdAt: Date.now()
    };
    writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');

    // 1. Burn Nonce
    record.state = 'BURNING_NONCE';
    writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
    const nonceClaimed = claimNonceFn(grant.nonce, grant.exp);
    if (!nonceClaimed) {
      record.state = 'FAILED';
      record.reason = 'grant:replayed';
      writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
      return { ok: false, state: 'FAILED', reason: 'grant:replayed' };
    }

    // 2. Append Durable Merkle Record (WITHHOLDING: LOG-BEFORE-EMIT)
    record.state = 'LOGGED_INTENT';
    const logEvent = {
      event: 'emission_intent',
      emissionId,
      toolName,
      grantDigest: record.grantDigest,
      nonce: grant.nonce,
      timestamp: Date.now()
    };
    if (this.witness) {
      this.witness.append(logEvent);
    }
    writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');

    // 3. Execute Outbound Emission
    record.state = 'EMITTING';
    writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');

    try {
      const emitResult = await emitFn(args);
      record.state = 'SETTLED';
      record.resultDigest = createHash('sha256').update(canonicalJSON(emitResult || {})).digest('hex');
      record.settledAt = Date.now();
      writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
      return { ok: true, state: 'SETTLED', emissionId, result: emitResult };
    } catch (err) {
      record.state = 'UNKNOWN'; // Could not confirm receipt on remote end
      record.error = err.message;
      record.amberStatus = true;
      record.settledAt = Date.now();
      writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
      return { ok: false, state: 'UNKNOWN', emissionId, error: err.message, amber: true };
    }
  }

  reconcileCrashedSessions() {
    const files = readdirSync(this.journalDir).filter(f => f.endsWith('.json'));
    const reconciled = [];

    for (const f of files) {
      const filePath = join(this.journalDir, f);
      try {
        const record = JSON.parse(readFileSync(filePath, 'utf8'));
        if (record.state === 'PREPARED' || record.state === 'BURNING_NONCE') {
          record.state = 'FAILED';
          record.reason = 'crash:aborted-before-intent-log';
          writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
          reconciled.push({ emissionId: record.emissionId, state: 'FAILED' });
        } else if (record.state === 'LOGGED_INTENT' || record.state === 'EMITTING') {
          // Intent was durably logged, but process died during emission: Reconcile as UNKNOWN (amber)
          record.state = 'UNKNOWN';
          record.reason = 'crash:in-flight-undecidable-emission';
          record.amberStatus = true;
          record.reconciledAt = Date.now();
          writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
          reconciled.push({ emissionId: record.emissionId, state: 'UNKNOWN', amber: true });
        }
      } catch (e) {
        // Ignore malformed files
      }
    }
    return reconciled;
  }
}
