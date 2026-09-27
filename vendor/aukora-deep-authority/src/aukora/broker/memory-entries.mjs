/** Select memory settlements from an already verified mixed-effect Aura chain. */
import { isAbsolute, resolve, sep } from 'node:path'
import { definitionDigest, MEMORY_PUT, WORKSPACE_PATCH } from './effect-definition.mjs'
import { captureWorkspacePatchArgs, MAX_WORKSPACE_PATCH_BYTES } from './workspace-patch-args.mjs'

const SHA256 = /^[0-9a-f]{64}$/
const DECIMAL = /^(?:0|[1-9][0-9]*)$/

/** Validate workspace row metadata without asserting that its effect still exists. */
function isWorkspaceSettlement(entry) {
  // Aura retains content evidence, not the replacement text. The empty body
  // lets the operation parser validate its retained destination and precondition.
  const metadata = captureWorkspacePatchArgs({
    workspace: entry.workspace,
    path: entry.relativePath,
    beforeSha256: entry.beforeSha256,
    content: '',
  })
  return entry.verdict === 'settled'
    && entry.definitionId === definitionDigest(WORKSPACE_PATCH)
    && metadata !== null
    && typeof entry.path === 'string' && !entry.path.includes('\0')
    && isAbsolute(entry.path) && resolve(entry.path) === entry.path
    && entry.path.endsWith(`${sep}${entry.relativePath.split('/').join(sep)}`)
    && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= MAX_WORKSPACE_PATCH_BYTES
    && typeof entry.contentSha256 === 'string' && SHA256.test(entry.contentSha256)
    && Number.isSafeInteger(entry.inode) && entry.inode >= 0
    && typeof entry.mtimeNs === 'string' && DECIMAL.test(entry.mtimeNs)
    && !Object.hasOwn(entry, 'key')
}

/**
 * Select memory entries only after the caller verifies the complete Aura chain.
 * Entries without a tool name use the memory format. Unknown tools, mismatched
 * definitions, and malformed workspace metadata refuse instead of disappearing
 * from the memory projection. Memory key and object validation remain with the
 * consuming reader. This does not verify workspace effects or their receipts.
 * @param {Array<Record<string, unknown>>} entries - entries from one verified chain.
 * @returns {{ok: true, entries: Array<Record<string, unknown>>} | {ok: false, reason: string}} selected entries or a named refusal.
 */
export function selectMemoryEntries(entries) {
  const memory = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (entry.toolName === undefined || entry.toolName === MEMORY_PUT) {
      if (entry.definitionId !== undefined && entry.definitionId !== definitionDigest(MEMORY_PUT)) {
        return { ok: false, reason: `memory-entries: definition mismatch at entry ${index + 1}` }
      }
      memory.push(entry)
    } else if (entry.toolName === WORKSPACE_PATCH) {
      if (!isWorkspaceSettlement(entry)) {
        return { ok: false, reason: `memory-entries: malformed workspace settlement at entry ${index + 1}` }
      }
    } else {
      return { ok: false, reason: `memory-entries: unknown effect at entry ${index + 1}` }
    }
  }
  return { ok: true, entries: memory }
}
