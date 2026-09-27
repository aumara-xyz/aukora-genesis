// scripts/cell-process-runner.ts — Brick C3.2: OS Subprocess Launcher & Capability Enforcement Reporter
//
// Spawns isolated OS worker processes (`bun run scripts/cell-child-process.ts` or `scripts/cell-hostile-process.ts`)
// under lifecycle control with synthetic empty HOME directory and scrubbed ambient environment.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { CellResultV1 } from '../core/swarm/cell-verifier';

const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
export const MAX_STDOUT_BYTES = 1024 * 1024; // 1MB stdout resource limit
export const MAX_STDERR_BYTES = 512 * 1024;  // 512KB stderr resource limit
export const MAX_COMBINED_BYTES = 1024 * 1024; // 1MB combined stdio resource limit

/** Global PID Registry tracking only Antigravity process runner spawned child PIDs */
export const ACTIVE_RUNNER_PIDS = new Set<number>();

export function registerChildPid(pid: number) {
  if (pid) ACTIVE_RUNNER_PIDS.add(pid);
}

export function unregisterChildPid(pid: number) {
  if (pid) ACTIVE_RUNNER_PIDS.delete(pid);
}

export function terminateOwnedPids() {
  for (const pid of Array.from(ACTIVE_RUNNER_PIDS)) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
  }
  ACTIVE_RUNNER_PIDS.clear();
}

export interface CapabilityEnforcementReportV1 {
  schema: 'aukora-capability-enforcement-report-v1';
  processIsolation: { level: 'OS_ENFORCED'; detail: 'Separate OS process spaces (PIDs), isolated stdio handles' };
  filesystemIsolation: { level: 'PARENT_VERIFIED'; detail: 'Path lease verification on disk diffs + candidate worktrees; OS kernel chroot pending' };
  secretIsolation: { level: 'PARENT_VERIFIED'; detail: 'Synthetic empty HOME + scrubbed environment allowlist; same-user POSIX access PARTIAL' };
  networkIsolation: { level: 'DECLARED'; detail: 'Contract networkPolicy="deny"; OS socket sandbox PARTIAL' };
  resourceIsolation: {
    stdoutLimit: { level: 'OS_ENFORCED'; detail: '1MB stdout buffer limit' };
    timeoutLimit: { level: 'OS_ENFORCED'; detail: 'Parent SIGKILL timer' };
    memoryLimit: { level: 'NOT_ENFORCED'; detail: 'Memory RSS quota pending container cgroups' };
    cpuLimit: { level: 'NOT_ENFORCED'; detail: 'CPU affinity quota pending container cgroups' };
  };
}

export interface OSProcessRunnerInput {
  cellId: string;
  briefId: string;
  allowedLeasePrefixes: string[];
  parentReceiptAnchor: string;
  baseCommit: string;
  baseTreeDigest: string;
  taskKind: 'alpha' | 'beta' | 'traversal' | 'out_of_lease' | 'slow_hang';
  hostileMode?: string;
  timeoutMs?: number;
  simulateKillMs?: number;
}

export interface OSProcessExecutionResult {
  ok: boolean;
  cellResult?: CellResultV1;
  diffText?: string;
  workspaceDir: string;
  fakeHomeDir: string;
  childChainHeadSelfReported?: string;
  childChainHeadRecomputed?: string;
  pid: number;
  startMs: number;
  finishMs: number;
  exitCode: number | null;
  signal: string | null;
  error?: string;
  refusalReason?: string;
  unresolvedEffects: number;
  enforcementReport: CapabilityEnforcementReportV1;
}

export function generateCapabilityReport(): CapabilityEnforcementReportV1 {
  return {
    schema: 'aukora-capability-enforcement-report-v1',
    processIsolation: { level: 'OS_ENFORCED', detail: 'Separate OS process spaces (PIDs), isolated stdio handles' },
    filesystemIsolation: { level: 'PARENT_VERIFIED', detail: 'Path lease verification on disk diffs + candidate worktrees; OS kernel chroot pending' },
    secretIsolation: { level: 'PARENT_VERIFIED', detail: 'Synthetic empty HOME + scrubbed environment allowlist; same-user POSIX access PARTIAL' },
    networkIsolation: { level: 'DECLARED', detail: 'Contract networkPolicy="deny"; OS socket sandbox PARTIAL' },
    resourceIsolation: {
      stdoutLimit: { level: 'OS_ENFORCED', detail: '1MB stdout buffer limit' },
      timeoutLimit: { level: 'OS_ENFORCED', detail: 'Parent SIGKILL timer' },
      memoryLimit: { level: 'NOT_ENFORCED', detail: 'Memory RSS quota pending container cgroups' },
      cpuLimit: { level: 'NOT_ENFORCED', detail: 'CPU affinity quota pending container cgroups' },
    },
  };
}

/** Independently walk and recompute a child receipt chain from raw disk lines. */
export function recomputeChildChain(workspaceDir: string, cellId: string, briefId: string): { ok: boolean; head: string; lineCount: number; error?: string } {
  const chainPath = join(workspaceDir, '.aukora', 'aura-chain.jsonl');
  if (!existsSync(chainPath)) {
    return { ok: false, head: '', lineCount: 0, error: 'child chain file missing' };
  }

  const raw = readFileSync(chainPath, 'utf8').trim();
  if (!raw) {
    return { ok: false, head: '', lineCount: 0, error: 'child chain file empty' };
  }

  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  let currentHead = sha256hex(`genesis:${cellId}:${briefId}`);

  for (let i = 0; i < lines.length; i++) {
    let item: any;
    try {
      item = JSON.parse(lines[i]);
    } catch {
      return { ok: false, head: currentHead, lineCount: i, error: `line ${i + 1} not JSON (truncated/corrupt line)` };
    }

    if (item.prevChainHead !== currentHead) {
      return { ok: false, head: currentHead, lineCount: i, error: `line ${i + 1} prevChainHead mismatch (corrupted linkage)` };
    }

    const recomputedLineStr = JSON.stringify({
      event: item.event,
      payload: item.payload,
      prevChainHead: item.prevChainHead,
      ts: item.ts,
    });

    currentHead = sha256hex(currentHead + ':' + recomputedLineStr);
  }

  return { ok: true, head: currentHead, lineCount: lines.length };
}

/** Launch an isolated OS child process worker under parent lifecycle control. */
export function spawnOSCellProcess(input: OSProcessRunnerInput): Promise<OSProcessExecutionResult> {
  return new Promise((resolve) => {
    const root = process.cwd();
    const workspaceDir = join(root, '.aukora', 'cell-worktrees', `os-cell-${input.cellId}`);
    const fakeHomeDir = join(workspaceDir, '.aukora', 'fake-home');
    mkdirSync(fakeHomeDir, { recursive: true });

    const startMs = Date.now();

    const configJson = JSON.stringify({
      cellId: input.cellId,
      briefId: input.briefId,
      allowedLeasePrefixes: input.allowedLeasePrefixes,
      parentReceiptAnchor: input.parentReceiptAnchor,
      baseCommit: input.baseCommit,
      baseTreeDigest: input.baseTreeDigest,
      taskKind: input.taskKind,
      hostileMode: input.hostileMode,
      workspaceDir,
    });

    const scriptPath = input.hostileMode
      ? join(root, 'scripts', 'cell-hostile-process.ts')
      : join(root, 'scripts', 'cell-child-process.ts');

    // Scrub ambient environment: pass ONLY PATH, synthetic HOME, and CELL_CONFIG_JSON
    const cleanEnv = {
      PATH: process.env.PATH || '/usr/bin:/bin',
      HOME: fakeHomeDir,
      CELL_CONFIG_JSON: configJson,
    };

    const child = spawn('bun', ['run', scriptPath, configJson], {
      cwd: root,
      env: cleanEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true, // Process group leader (PGID = child.pid)
    });

    if (child.pid) registerChildPid(child.pid);

    let stdoutData = '';
    let stderrData = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let payloadLimitExceeded = false;
    let exceededLimitReason = '';

    const killProcessGroup = () => {
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch {}
        try { child.kill('SIGKILL'); } catch {}
      }
    };

    child.stdout.on('data', (d: Buffer) => {
      stdoutBytes += d.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        payloadLimitExceeded = true;
        exceededLimitReason = 'parent:stdout-payload-exceeded-1mb-limit';
        killProcessGroup();
      } else if (stdoutBytes + stderrBytes > MAX_COMBINED_BYTES) {
        payloadLimitExceeded = true;
        exceededLimitReason = 'parent:combined-stdio-payload-exceeded-limit';
        killProcessGroup();
      } else {
        stdoutData += d.toString('utf8');
      }
    });

    child.stderr.on('data', (d: Buffer) => {
      stderrBytes += d.length;
      if (stderrBytes > MAX_STDERR_BYTES) {
        payloadLimitExceeded = true;
        exceededLimitReason = 'parent:stderr-payload-exceeded-100kb-limit';
        killProcessGroup();
      } else if (stdoutBytes + stderrBytes > MAX_COMBINED_BYTES) {
        payloadLimitExceeded = true;
        exceededLimitReason = 'parent:combined-stdio-payload-exceeded-limit';
        killProcessGroup();
      } else {
        stderrData += d.toString('utf8');
      }
    });

    let killedByParent = false;
    let killTimer: NodeJS.Timeout | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;

    if (input.simulateKillMs) {
      killTimer = setTimeout(() => {
        killedByParent = true;
        killProcessGroup();
      }, input.simulateKillMs);
    }

    if (input.timeoutMs) {
      timeoutTimer = setTimeout(() => {
        killedByParent = true;
        killProcessGroup();
      }, input.timeoutMs);
    }

    child.on('close', (code, signal) => {
      if (child.pid) unregisterChildPid(child.pid);
      const finishMs = Date.now();
      if (killTimer) clearTimeout(killTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);

      const chainWalk = recomputeChildChain(workspaceDir, input.cellId, input.briefId);
      const enforcementReport = generateCapabilityReport();

      if (payloadLimitExceeded) {
        return resolve({
          ok: false,
          workspaceDir,
          fakeHomeDir,
          pid: child.pid || 0,
          startMs,
          finishMs,
          exitCode: code,
          signal: signal || 'SIGKILL',
          refusalReason: exceededLimitReason || 'parent:stdout-payload-exceeded-1mb-limit',
          unresolvedEffects: 1,
          childChainHeadRecomputed: chainWalk.head,
          enforcementReport,
        });
      }

      if (code !== 0 || signal !== null || killedByParent) {
        const reason = killedByParent
          ? (input.timeoutMs ? 'parent:child-process-timeout' : 'parent:child-killed-mid-effect')
          : `parent:child-nonzero-exit-code-${code}`;

        return resolve({
          ok: false,
          workspaceDir,
          fakeHomeDir,
          pid: child.pid || 0,
          startMs,
          finishMs,
          exitCode: code,
          signal: signal || (killedByParent ? 'SIGKILL' : null),
          error: stderrData || `exited with code ${code}`,
          refusalReason: reason,
          unresolvedEffects: 1,
          childChainHeadRecomputed: chainWalk.head,
          enforcementReport,
        });
      }

      const trimmedStdout = stdoutData.trim();
      const stdoutLines = trimmedStdout.split('\n').filter((l) => l.trim().length > 0);

      if (stdoutLines.length > 1) {
        return resolve({
          ok: false,
          workspaceDir,
          fakeHomeDir,
          pid: child.pid || 0,
          startMs,
          finishMs,
          exitCode: code,
          signal: null,
          refusalReason: 'parent:multiple-contradictory-stdout-envelopes',
          unresolvedEffects: 1,
          childChainHeadRecomputed: chainWalk.head,
          enforcementReport,
        });
      }

      let parsed: any;
      try {
        parsed = JSON.parse(trimmedStdout);
      } catch {
        return resolve({
          ok: false,
          workspaceDir,
          fakeHomeDir,
          pid: child.pid || 0,
          startMs,
          finishMs,
          exitCode: code,
          signal: null,
          refusalReason: 'parent:malformed-non-json-stdout-envelope',
          unresolvedEffects: 1,
          childChainHeadRecomputed: chainWalk.head,
          enforcementReport,
        });
      }

      if (!chainWalk.ok) {
        return resolve({
          ok: false,
          workspaceDir,
          fakeHomeDir,
          pid: child.pid || 0,
          startMs,
          finishMs,
          exitCode: code,
          signal: null,
          refusalReason: `parent:child-chain-walk-failed:${chainWalk.error}`,
          unresolvedEffects: 1,
          childChainHeadRecomputed: chainWalk.head,
          enforcementReport,
        });
      }

      if (parsed.cellResult && parsed.cellResult.childChainHead !== chainWalk.head) {
        return resolve({
          ok: false,
          workspaceDir,
          fakeHomeDir,
          pid: child.pid || 0,
          startMs,
          finishMs,
          exitCode: code,
          signal: null,
          refusalReason: `parent:self-reported-chain-head-mismatch (reported ${parsed.cellResult.childChainHead}, recomputed ${chainWalk.head})`,
          unresolvedEffects: 1,
          childChainHeadRecomputed: chainWalk.head,
          enforcementReport,
        });
      }

      resolve({
        ok: true,
        cellResult: parsed.cellResult,
        diffText: parsed.diffText,
        workspaceDir: parsed.workspaceDir,
        fakeHomeDir,
        childChainHeadSelfReported: parsed.childChainHead,
        childChainHeadRecomputed: chainWalk.head,
        pid: child.pid || 0,
        startMs,
        finishMs,
        exitCode: code,
        signal: null,
        unresolvedEffects: parsed.cellResult?.unresolvedEffects ?? 0,
        enforcementReport,
      });
    });
  });
}
