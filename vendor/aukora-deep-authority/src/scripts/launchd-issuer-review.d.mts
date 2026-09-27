import type { ReviewClientOptions } from './launchd-review-transport.mjs'

/** Caller provisions protected routes; only terminal callbacks may decide. */
export interface IssuerReviewOptions extends ReviewClientOptions {
  issuerSocketPath: string
  issuerSocketMode?: 0o600 | 0o660
  /** Pre-provisioned issuer-only group, never the broker's issuer-route group. */
  issuerSocketGid?: number
}

/** Shutdown removes only the listener's own route and discards all approval bindings. */
export interface IssuerReviewConnection {
  closed: Promise<void>
  close(): Promise<void>
  error(): Error | undefined
}

/** Real issuer carrier and authenticated broker review; no signer or automatic approval. */
export declare function connectIssuerReview(options: IssuerReviewOptions): Promise<IssuerReviewConnection>
