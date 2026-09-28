/** The claim directory name, frozen. */
export declare const NONCE_DIR: 'nonces'

/**
 * Open the durable single-use book. A null/absent state directory throws:
 * an in-memory book whose claim always succeeds would silently admit every
 * replay across a restart.
 * Only true admits. False confirms a prior burn; 'malformed' identifies invalid
 * input or retained record; 'uncertain' preserves an unconfirmed storage outcome.
 * Failed claims remain refused without another filesystem attempt in this process.
 */
export declare function openNonceBook(
  stateDir: string | null | undefined,
): { set: Set<string>; claim: (nonce: string, exp: number) => true | false | 'malformed' | 'uncertain' }
