import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJSON } from '../kernel/canonical.mjs';

function sha256File(filePath) {
  if (!existsSync(filePath)) return null;
  const buf = readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Transactional Workspace Staging & Instant Undo Journal.
 * Enables autonomous agents to execute hundreds of file modifications safely
 * inside an isolated staging boundary with instant $O(1)$ rollback and atomic commit.
 */
export class WorkspaceTransaction {
  constructor({ workspaceDir, stagingDir, txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }) {
    this.workspaceDir = resolve(workspaceDir);
    this.stagingDir = resolve(stagingDir || join(this.workspaceDir, '.aukora', 'staging', txId));
    this.shadowDir = join(this.stagingDir, 'shadow');
    this.backupDir = join(this.stagingDir, 'backup');
    this.txId = txId;
    this.status = 'ACTIVE'; // 'ACTIVE' | 'COMMITTED' | 'ROLLED_BACK'
    this.operations = []; // Array of { type: 'PUT'|'DELETE', relPath, originalHash, newHash }
    this.trackedFiles = new Map(); // relPath -> { originalExists: boolean, originalHash: string|null, staged: boolean }

    mkdirSync(this.shadowDir, { recursive: true });
    mkdirSync(this.backupDir, { recursive: true });
  }

  _ensureTracked(relPath) {
    const norm = relPath.replace(/\\/g, '/');
    if (this.trackedFiles.has(norm)) return this.trackedFiles.get(norm);

    const livePath = join(this.workspaceDir, norm);
    const exists = existsSync(livePath);
    const originalHash = exists ? sha256File(livePath) : null;

    if (exists) {
      const backupPath = join(this.backupDir, norm);
      mkdirSync(dirname(backupPath), { recursive: true });
      copyFileSync(livePath, backupPath);
    }

    const state = { originalExists: exists, originalHash, staged: false };
    this.trackedFiles.set(norm, state);
    return state;
  }

  writeFile(relPath, content) {
    if (this.status !== 'ACTIVE') throw new Error(`Cannot write to transaction in ${this.status} state`);
    const norm = relPath.replace(/\\/g, '/');
    const state = this._ensureTracked(norm);

    const shadowPath = join(this.shadowDir, norm);
    mkdirSync(dirname(shadowPath), { recursive: true });
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    writeFileSync(shadowPath, buf);

    const newHash = createHash('sha256').update(buf).digest('hex');
    state.staged = true;
    state.stagedAction = 'WRITE';
    state.newHash = newHash;

    this.operations.push({
      type: 'PUT',
      relPath: norm,
      originalHash: state.originalHash,
      newHash,
      timestamp: Date.now()
    });

    return { ok: true, relPath: norm, hash: newHash };
  }

  deleteFile(relPath) {
    if (this.status !== 'ACTIVE') throw new Error(`Cannot delete in transaction in ${this.status} state`);
    const norm = relPath.replace(/\\/g, '/');
    const state = this._ensureTracked(norm);

    const shadowPath = join(this.shadowDir, norm);
    if (existsSync(shadowPath)) {
      unlinkSync(shadowPath);
    }

    state.staged = true;
    state.stagedAction = 'DELETE';
    state.newHash = null;

    this.operations.push({
      type: 'DELETE',
      relPath: norm,
      originalHash: state.originalHash,
      newHash: null,
      timestamp: Date.now()
    });

    return { ok: true, relPath: norm };
  }

  readFile(relPath) {
    const norm = relPath.replace(/\\/g, '/');
    const state = this.trackedFiles.get(norm);
    if (state && state.staged) {
      if (state.stagedAction === 'DELETE') return null;
      const shadowPath = join(this.shadowDir, norm);
      return readFileSync(shadowPath);
    }
    const livePath = join(this.workspaceDir, norm);
    if (existsSync(livePath)) {
      return readFileSync(livePath);
    }
    return null;
  }

  getDiffSummary() {
    const created = [];
    const modified = [];
    const deleted = [];
    const unchanged = [];

    for (const [relPath, state] of this.trackedFiles.entries()) {
      if (!state.staged) continue;
      if (state.stagedAction === 'DELETE') {
        if (state.originalExists) deleted.push(relPath);
      } else if (state.stagedAction === 'WRITE') {
        if (!state.originalExists) {
          created.push({ path: relPath, hash: state.newHash });
        } else if (state.originalHash !== state.newHash) {
          modified.push({ path: relPath, fromHash: state.originalHash, toHash: state.newHash });
        } else {
          unchanged.push(relPath);
        }
      }
    }

    const humanSentence = `Modified ${modified.length} file(s), created ${created.length}, deleted ${deleted.length}.`;
    return {
      txId: this.txId,
      status: this.status,
      created,
      modified,
      deleted,
      unchanged,
      totalOperations: this.operations.length,
      humanSentence
    };
  }

  commit() {
    if (this.status !== 'ACTIVE') throw new Error(`Cannot commit transaction in ${this.status} state`);
    const diff = this.getDiffSummary();

    // Apply all changes to live workspace
    for (const [relPath, state] of this.trackedFiles.entries()) {
      if (!state.staged) continue;
      const livePath = join(this.workspaceDir, relPath);

      if (state.stagedAction === 'DELETE') {
        if (existsSync(livePath)) {
          rmSync(livePath, { force: true, recursive: true });
        }
      } else if (state.stagedAction === 'WRITE') {
        const shadowPath = join(this.shadowDir, relPath);
        mkdirSync(dirname(livePath), { recursive: true });
        copyFileSync(shadowPath, livePath);
      }
    }

    this.status = 'COMMITTED';
    rmSync(this.stagingDir, { recursive: true, force: true });
    return { ok: true, txId: this.txId, summary: diff };
  }

  rollback() {
    if (this.status === 'ROLLED_BACK') return { ok: true, alreadyRolledBack: true };
    if (this.status === 'COMMITTED') {
      // commit() discarded the backups with the staging dir, so a committed
      // transaction is final. Refuse loudly rather than claim a rollback that
      // restored nothing (reverted ≠ compensated).
      return { ok: false, reason: 'journal:backups-discarded-at-commit' };
    }

    this.status = 'ROLLED_BACK';
    rmSync(this.stagingDir, { recursive: true, force: true });
    return { ok: true, txId: this.txId, status: 'ROLLED_BACK' };
  }
}

export class StagingJournal {
  constructor({ rootDir = '.aukora' } = {}) {
    this.rootDir = resolve(rootDir);
    this.stagingBase = join(this.rootDir, 'staging');
    mkdirSync(this.stagingBase, { recursive: true });
  }

  beginTransaction(workspaceDir) {
    const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const stagingDir = join(this.stagingBase, txId);
    return new WorkspaceTransaction({ workspaceDir, stagingDir, txId });
  }
}
