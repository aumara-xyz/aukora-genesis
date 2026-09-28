/** Grant verification refusals, named. */
export declare const REFUSE: Readonly<Record<string, string>>

/** Maximum lifetime admitted by every grant verifier. */
export declare const MAX_TTL_SECONDS: 3600

export declare function payloadDigest(toolName: string, args: unknown): string
export declare function receiptKeyIdForPublicKey(publicKey: string | import('node:crypto').KeyObject): string
export declare function canonicalEd25519PublicKey(value: unknown): import('node:crypto').KeyObject | null
export declare function grantPreimage(grant: {
  toolName: string
  digest: string
  nonce: string
  exp: number
  definitionId: string
  operationDigest: string
  receiptKeyId: string
}): Buffer
export declare function newNonce(): string

/** The closed key set a grant may carry; a key outside it is an unsigned rider. */
export declare const GRANT_KEYS: readonly string[]

/** Inspect a freshly minted v3 grant without reserving its nonce. This cannot
 * authorize an effect; `verifyGrant` is the v3 effect-admission verifier. */
export declare function verifyIssuedGrant(params: {
  grant: Record<string, unknown>
  toolName: string
  args: unknown
  rootPublicKeyPem: string | undefined
  now: number
  expectedOperationDigest: string
  expectedDefinitionId: string
  expectedReceiptKeyId: string
}): { ok: boolean; reason?: string; digest?: string; operationDigest?: string; receiptKeyId?: string }

/** Verify a grant against the call it claims to authorize. `now`, the expected
 * definition, operation and receipt-key identities, and one of
 * `seenNonces`/`claimNonce` are REQUIRED: omitting any refuses by name instead
 * of disabling its check. A supplied claim callback owns nonce diagnosis and
 * takes precedence over the in-memory set. Only literal true admits. */
export declare function verifyGrant(params: {
  grant: Record<string, unknown>
  toolName: string
  args: unknown
  rootPublicKeyPem: string | undefined
  seenNonces?: Set<string>
  claimNonce?: (nonce: string, exp: number) => true | false | 'malformed' | 'uncertain'
  now: number
  expectedOperationDigest: string
  expectedDefinitionId: string
  expectedReceiptKeyId: string
}): { ok: boolean; reason?: string; digest?: string; operationDigest?: string; receiptKeyId?: string }

/** The v3 grant domain. v3 signs the canonical claims preimage. */
export declare const GRANT_DOMAIN: 'aukora:tool-grant:v3'

/** The v4 authorization domain. v4 signs the digest of the claims preimage
 * rather than the preimage, so the issuer can authorize a grant whose preimage
 * it never receives. Neither verifier accepts the other family's signature. */
export declare const GRANT_DOMAIN_V4: 'aukora:tool-grant:v4'

/** The v4 preimage: the same closed claims as v3 under the v4 domain. Hashed
 * by the broker and never transmitted. */
export declare function authorizationPreimage(claims: {
  toolName: string
  digest: string
  nonce: string
  exp: number
  definitionId: string
  operationDigest: string
  receiptKeyId: string
}): Buffer

/** SHA-256 over the v4 preimage. Its hex rendering crosses the
 * broker-to-issuer hop; the root signs the tagged message returned by
 * `authorizationSignedMessageFromHex`. */
export declare function authorizationDigestBytes(claims: {
  toolName: string
  digest: string
  nonce: string
  exp: number
  definitionId: string
  operationDigest: string
  receiptKeyId: string
}): Buffer

/** Hex rendering of the authorization digest, for the wire frame, the issuer's
 * pending table, and the human's screen. */
export declare function authorizationDigest(claims: {
  toolName: string
  digest: string
  nonce: string
  exp: number
  definitionId: string
  operationDigest: string
  receiptKeyId: string
}): string

/** Every key a v4 claim set may carry. CLOSED; a key outside it refuses. */
export declare const AUTHORIZATION_CLAIM_KEYS: readonly string[]

/** Snapshot a v4 claim set once and refuse anything that is not exactly the
 * closed seven. A rider must refuse rather than be dropped so the remaining
 * seven hash anyway. */
export declare function exactAuthorizationClaims(claims: unknown): {
  toolName: string
  digest: string
  nonce: string
  exp: number
  definitionId: string
  operationDigest: string
  receiptKeyId: string
}

/** The exact bytes the root key signs: the v4 domain, a NUL, then the digest. */
export declare function authorizationSignedMessageFromHex(digestHex: string): Buffer

/** The signed message derived from a claim set, for the verifier. */
export declare function authorizationSignedMessage(claims: Parameters<typeof authorizationPreimage>[0]): Buffer

/** The v4 form of `verifyIssuedGrant`. Reserves no nonce and cannot authorize
 * an effect. */
export declare function verifyIssuedGrantV4(params: Parameters<typeof verifyIssuedGrant>[0]): ReturnType<typeof verifyIssuedGrant>

/** The v4 form of `verifyGrant`: identical checks, and the signature is
 * verified over the authorization digest the issuer signed. */
export declare function verifyGrantV4(params: Parameters<typeof verifyGrant>[0]): ReturnType<typeof verifyGrant>
