/** The artifact kind this verifier accepts; a different kind is refused, never guessed. */
export declare const KIRA_MEMORY_ARTIFACT_KIND: 'aukora:kira-memory-artifact:v1'

/** Aura's entry-preimage domain separator, restated rather than imported. */
export declare const AURA_RECORD_DOMAIN: 'aukora:aura-record:v1'

/** Emission order of the verdict rows; a complete verdict carries all nine. */
export declare const KIRA_MEMORY_ARTIFACT_CHECKS: readonly [
  'inputs',
  'record-identity',
  'key-binds-record',
  'object-body',
  'content-address',
  'chain',
  'settlement-entry',
  'head-anchor',
  'recall-honesty',
]

/** Every named refusal this module and its CLI can report. */
export declare const KIRA_MEMORY_ARTIFACT_REFUSE: Readonly<Record<string, string>>

/** What an `ok: true` verdict does NOT establish. */
export declare const KIRA_MEMORY_ARTIFACT_CEILING: readonly string[]

/** One verdict row: the check's name, its verdict, what it compared, and — when red — its named refusal. */
export type KiraMemoryArtifactRow = Readonly<{
  check: string
  ok: boolean
  detail: string
  reason?: string
}>

/** One self-contained artifact describing a single settled governed `memory.put`. */
export type KiraMemoryArtifact = Readonly<{
  /** Always {@link KIRA_MEMORY_ARTIFACT_KIND}. */
  kind: string
  /** The staged KIRA memory record, as the producer claims it. */
  record: Readonly<Record<string, unknown>>
  /** The `memory.put` arguments the producer claims were settled. */
  memoryPut: Readonly<{ key: string; value: unknown }>
  /** The stored content-addressed object: its file name and exact body text. */
  object: Readonly<{ name: string; body: string }>
  /** The key projection at `memory/keys/<key>.json`. */
  projection: Readonly<{ key: string; contentSha256: string }>
  /** The exact `aura.jsonl` text, terminal newline included. */
  aura: string
  /** The chain head the producer claims; checked against the trusted head, never trusted itself. */
  head: string
  /** The recall reply the producer claims, with the query it answered. */
  recall: Readonly<{
    query: Readonly<{ subject: string; kind?: string }>
    status: string
    records?: readonly unknown[]
    reason?: string
  }>
}>

/** Out-of-band inputs. The trusted head is required: a chain that only agrees with itself distinguishes nothing. */
export type KiraMemoryArtifactOptions = Readonly<{ trustedHead: string }>

/** One closed verdict; `failed` names the first red row's refusal. */
export type KiraMemoryArtifactResult =
  | Readonly<{ ok: true; checks: readonly KiraMemoryArtifactRow[]; ceiling: readonly string[] }>
  | Readonly<{ ok: false; failed: string; checks: readonly KiraMemoryArtifactRow[]; ceiling: readonly string[] }>

/**
 * Verify one settled governed `memory.put` from its artifact bytes alone.
 * Every input, hostile or not, returns one closed verdict; this function never throws.
 */
export declare function verifyKiraMemoryArtifact(artifact: unknown, options?: unknown): KiraMemoryArtifactResult
