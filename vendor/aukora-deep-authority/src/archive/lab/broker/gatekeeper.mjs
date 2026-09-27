import { StagingJournal } from '../staging/journal.mjs';
import { definitionDigest } from '../../../aukora/broker/effect.mjs';

export const IRREVERSIBLE_VERBS = new Set([
  'net:outbound',
  'exec:host',
  'crypto:transfer',
  'secret:export',
  'fs:untracked-destroy'
]);

export function isIrreversible(toolName) {
  return IRREVERSIBLE_VERBS.has(toolName);
}

/**
 * IrreversibleGatekeeper:
 * Coordinates the dual-mode execution boundary:
 * 1. Reversible inside workspace -> Never ask. Dispatches to StagingJournal for auto-undo & commit.
 * 2. Irreversible or outbound -> Always ask. Demands cryptographically valid single-use Ed25519 grant.
 */
export class IrreversibleGatekeeper {
  constructor({ rootPublicKey, journal, brokerDaemon } = {}) {
    this.rootPublicKey = rootPublicKey;
    this.journal = journal || new StagingJournal();
    this.brokerDaemon = brokerDaemon;
  }

  evaluateAndRoute({ toolName, args, grant, now, workspaceDir, activeTx }) {
    // 1. REVERSIBLE WORKSPACE ACTION: Auto-routed to staging journal without micro-grant prompt
    if (!isIrreversible(toolName) && activeTx) {
      if (toolName === 'fs.write' || toolName === 'fs.put' || toolName === 'workspace.write') {
        const res = activeTx.writeFile(args.path || args.relPath, args.content || args.value);
        return { ok: true, mode: 'REVERSIBLE_STAGED', result: res };
      }
      if (toolName === 'fs.delete' || toolName === 'workspace.delete') {
        const res = activeTx.deleteFile(args.path || args.relPath);
        return { ok: true, mode: 'REVERSIBLE_STAGED', result: res };
      }
    }

    // 2. IRREVERSIBLE ACTION: Hard Cryptographic Gate
    if (isIrreversible(toolName)) {
      if (!grant) {
        return {
          ok: false,
          mode: 'IRREVERSIBLE_BLOCKED',
          reason: 'gate:grant-required-for-irreversible-verb',
          toolName,
          sentence: `Action '${toolName}' is IRREVERSIBLE and requires an explicit cryptographic human grant.`
        };
      }

      // Verify through the sovereign broker daemon / grant verifier. The
      // definition is the effect's resolved digest, never a name-derived
      // string: `def:<tool>:v1` collapses the definition check into the
      // tool-name check that already ran and would admit a grant bound to a
      // different effect.
      if (this.brokerDaemon) {
        return this.brokerDaemon.execute({
          toolName,
          args,
          grant,
          now,
          expectedDefinitionId: definitionDigest()
        });
      }
    }

    return { ok: false, reason: 'gate:unhandled-routing' };
  }
}
