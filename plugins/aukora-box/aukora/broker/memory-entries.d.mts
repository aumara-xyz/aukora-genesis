/** Select memory entries from a verified chain; reject unknown or malformed effect metadata. */
export declare function selectMemoryEntries(
  entries: Array<Record<string, unknown>>,
): { ok: true; entries: Array<Record<string, unknown>> } | { ok: false; reason: string }
