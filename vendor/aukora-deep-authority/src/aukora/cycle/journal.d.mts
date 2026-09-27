/** Closed observer event kinds for one cycle-memory run. */
export declare const CYCLE_JOURNAL_KINDS: readonly string[]

/** One hash-linked journal event. */
export declare class CycleJournal {
  /**
   * Append one event and return its frozen record.
   */
  emit(kind: string, details: unknown): Readonly<{
    sequence: number
    kind: string
    details: unknown
    previous: string | null
    hash: string
  }>
  /** The frozen event chain in sequence order. */
  events(): ReadonlyArray<Readonly<{
    sequence: number
    kind: string
    details: unknown
    previous: string | null
    hash: string
  }>>
}

/**
 * Verify one closed journal: hashes chain, sequences are contiguous, kinds
 * are known, and details are lossless JSON data.
 */
export declare function verifyCycleJournal(input: unknown):
  | Readonly<{ ok: true; count: number; head: string | null }>
  | Readonly<{ ok: false; reason: string }>
