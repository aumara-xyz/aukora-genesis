/** Durable Auma Canvas document and projection vocabulary. */

/** One complete visual document rendered inside Auma Canvas. */
export interface AumaCanvasDocument {
  /** Document format version. */
  readonly version: 1
  /** Accessible name for the rendered document. */
  readonly title: string
  /** Body markup rendered inside the isolated Canvas document. */
  readonly markup: string
  /** Document-local CSS rendered inside the isolated Canvas document. */
  readonly css: string
}

/** Latest replayed Canvas document for one Session. */
export interface AumaCanvasProjection {
  /** Projection payload version. */
  readonly version: 1
  /** Latest complete document, or null for the living blank field. */
  readonly document: AumaCanvasDocument | null
  /** Session-event sequence that produced the document, or -1 before the first write. */
  readonly revision: number
  /** Event time of the latest write, or null before the first write. */
  readonly updatedAt: number | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole-document Auma Canvas replacement; null restores the living blank field. */
    'auma-canvas/document': { document: AumaCanvasDocument | null }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Latest complete Auma Canvas document for a Session. */
    aumaCanvas: AumaCanvasProjection
  }

  interface SessionProjectionMap {
    /** Latest complete Auma Canvas document for a Session. */
    aumaCanvas: AumaCanvasProjection
  }
}
