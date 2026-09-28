import type { WebReviewConfig } from './developer-review.mjs'

/** Separate loopback UI; its private pairing URL is never a guest configuration value. */
export declare function startOwnerReview(options: {
  config: WebReviewConfig
  privateKeyPath: string
  port?: number
  appOrigin?: string
  /**
   * Artifact-stage view deadline shown to the owner, positive and at most the transport's
   * own artifact window (`ARTIFACT_REVIEW_TIMEOUT_MS`). A wider value would display a
   * countdown the transport will not honour. Defaults to that window.
   */
  reviewWindowMs?: number
  /** Issuer-stage view deadline, positive and at most `REVIEW_TIMEOUT_MS`. Defaults to it. */
  issuerWindowMs?: number
}): Promise<{ url: string; ownerUrl: string; close(): Promise<void> }>
