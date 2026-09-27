/** Whether a mark can be traced to its subject and to no other actor. */
export type AttributionClass =
  /** Only the subject could have caused this. May accrue as weight. */
  | 'SUBJECT_ONLY'
  /** Some other actor could have caused it. Counted and surfaced, never weight. */
  | 'NOT_ATTRIBUTABLE'

/** One recorded answer: who a mark would accrue against, and who else can produce it. */
export type MarkAttribution = Readonly<{
  /** The refusal name, exactly as its table emits it. */
  mark: string
  /** The subject the classification is relative to; the two tables answer to different subjects. */
  subject: string
  /** The class this mark carries. */
  attribution: AttributionClass
  /** Who else can produce the mark, and the cheapest way. Empty exactly for `SUBJECT_ONLY`. */
  alsoProducibleBy: readonly string[]
}>

/** The subject the `KIRA_MEMORY_ARTIFACT_REFUSE` marks would accrue against. */
export declare const SUBJECT_ARTIFACT_PRODUCER: 'the producer the artifact claims settled this memory.put'

/** The subject the 7 `RECORD_REFUSE` marks would accrue against. */
export declare const SUBJECT_CHAIN_APPENDER: 'the process that owns and appends to this Aura chain'

/** The closed set of attribution classes, in the order a census reports them. */
export declare const ATTRIBUTION_CLASSES: readonly ['SUBJECT_ONLY', 'NOT_ATTRIBUTABLE']

/** Every named refusal of `kira-memory-artifact-verifier.mjs` and `record.mjs`, classified. */
export declare const MARK_ATTRIBUTION: readonly MarkAttribution[]

/**
 * The recorded answer for one mark. Null when the mark is unclassified, which a
 * caller must treat as loud and never as permission to accrue.
 */
export declare function attributionOf(mark: string): MarkAttribution | null

/**
 * The rule itself, asked of an explicit producer set rather than of this
 * module's table. `producers` is every actor who can cause the mark, the
 * subject included.
 */
export declare function isAttributable(subjectId: string, producers: readonly string[]): boolean

/** Whether a mark of this class may become weight against its subject. Throws outside the closed set. */
export declare function mayAccrueAsWeight(attribution: AttributionClass): boolean

/** A classification states causation and never grants authority to act on the mark. */
export declare function attributionGrantsAuthority(): false
