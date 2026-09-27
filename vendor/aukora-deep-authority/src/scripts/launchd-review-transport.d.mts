import type { KeyObject } from 'node:crypto'
import type { BrokerReviewRequest } from '../aukora/broker/broker.mjs'

/** Installer-pinned local route; directory and daemon ownership are checked by its caller. */
export interface ReviewRouteOptions {
  socketPath: string
  role: string
  /** SHA-256 identity of the installed daemon/route configuration. */
  serverId: string
  /** Authentication and ISSUER prompt ceiling, positive and at most 25 seconds. */
  timeoutMs?: number
  /**
   * Broker-artifact prompt ceiling. At least `timeoutMs` and at most the broker's own IPC
   * wait less five seconds, so the deadline can never outlive the broker awaiting it.
   * Defaults to `timeoutMs`, which preserves the single-window behaviour for callers that
   * do not distinguish the stages.
   */
  reviewTimeoutMs?: number
}

/** The daemon receives only the terminal's canonical public Ed25519 PEM. */
export interface ReviewServerOptions extends ReviewRouteOptions {
  terminalPublicKeyPem: string
  socketMode?: 0o600 | 0o660
}

/** Existing terminal renderer callback; synthetic decisions belong only in unit tests. */
export interface ReviewClientOptions extends ReviewRouteOptions {
  terminalPrivateKey: KeyObject | string
  review(request: Readonly<BrokerReviewRequest>, signal: AbortSignal): Promise<'approved' | 'denied'> | 'approved' | 'denied'
  /** Missing callbacks close issuer requests without returning a decision. */
  reviewIssuer?(request: Readonly<IssuerReviewRequest>, signal: AbortSignal): Promise<'approved' | 'denied'> | 'approved' | 'denied'
}

/** Exact issuer projection; artifact frames may identify one prior approval by their complete bytes. */
export interface IssuerReviewInput {
  /** Required for digest-only prompts; when supplied, must identify the prior approval. */
  authorizationDigest?: string
  challenge: string
  /** Exact artifact or digest-only issuer frame, at most 32 KiB, without terminal controls. */
  prompt: string
}

/** An issuer challenge bound to the prior approval and its original deadline on this connection. */
export interface IssuerReviewRequest extends IssuerReviewInput {
  type: 'aukora:review-transport:issuer-request:v1'
  reviewId: string
  authorizationDigest: string
  promptDigest: string
  /** Original artifact deadline in Unix seconds. */
  expiresAt: number
}

/** A single authenticated terminal can review one request at a time; no request queue exists. */
export interface ReviewTransportServer {
  /** Rejects without a terminal, on cancellation, malformed replies, expiry or disconnect. */
  requestReview(request: Readonly<BrokerReviewRequest>, signal: AbortSignal): Promise<'approved' | 'denied'>
  /** Consume one unexpired artifact approval on this connection; reconnects never inherit approvals. */
  requestIssuerReview(request: Readonly<IssuerReviewInput>, signal: AbortSignal): Promise<'approved' | 'denied'>
  /** Cancel reviews and wait for the listener and connected sockets to close. */
  close(): Promise<void>
}

/** The caller must await callback abort handling before opening another terminal session. */
export interface ReviewTransportClient {
  closed: Promise<void>
  /** Review a local issuer carrier against this terminal's one-use artifact approvals. */
  requestIssuerReview(request: Readonly<IssuerReviewInput>, signal: AbortSignal): Promise<'approved' | 'denied'>
  close(): Promise<void>
}

/** Bind an unoccupied Unix path; the caller provides a protected parent directory. */
export declare function createReviewTransportServer(options: ReviewServerOptions): Promise<ReviewTransportServer>

/** Authenticate a terminal key and delegate the two independent approval stages. */
export declare function connectReviewTransport(options: ReviewClientOptions): Promise<ReviewTransportClient>

/**
 * Longest addressable unix socket path on the target platform, measured.
 *
 * `connect` truncates a longer address rather than refusing it, so a published
 * route longer than this never matches the address its listener bound.
 */
export declare const SUN_PATH_MAX_BYTES: number
