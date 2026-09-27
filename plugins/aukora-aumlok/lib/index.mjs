/**
 * @aukora/dsh-plugin-aumlok — the public identity/control adapter.
 *
 * WHAT THIS PACKAGE SUPPLIES. One question, answered consistently for every
 * consumer: *which AUKORA subject is this, and is it still the one that was
 * pinned?* The host and KIRA both need that answer and neither needs the private
 * half of the controller, so the package exposes exactly three seams:
 *
 *   projectPublicControl(control, options?)   → the public projection, seven fields
 *   admitPublicControl({projection, expected, signerPublicKeyPem}) → a named verdict
 *   loadLocalAumlokPublicControl(directory, expectation?) → the projection from a Deep store
 *
 * plus the primitives those three are built from, so a consumer can re-derive
 * anything the projection asserts instead of trusting it.
 *
 * AND ONE MORE SEAM FOR THE THING A CONSUMER ACTUALLY NEEDS NEXT, kept separate
 * because conflating it with the three above is exactly how an identity claim
 * becomes an authority claim:
 *
 *   verifyIdentityCorrespondence({directory, expectation}) → do the stored secret
 *       halves correspond to the registered public keys? (`identity-correspondence.mjs`)
 *   approveOperation({…}) / settleOperation({…}) → the D2 approval path as one
 *       named interface with a named refusal vocabulary, over an approval ARTIFACT
 *       that is an `aukora:approval-receipt:v1` record and nothing else
 *       (`operation-approval.mjs`). Neither function holds a key, neither signs,
 *       and a boolean is never an approval.
 *
 * Correspondence is not permission and an approval is not attendance: the first
 * says two stored byte strings are one pair, the second says a registered key
 * signed one exact operation digest inside one window. Both print their ceilings.
 *
 * THE FOUR THINGS THIS PACKAGE KEEPS DISTINCT — collapsing any two of them is how
 * an identity claim becomes an authority claim:
 *
 *   1. the stable `AukoraId` (`aukora:1:<sha256>`), derived from the IMMUTABLE
 *      genesis record and from nothing else;
 *   2. the active control digest and epoch, which change on rotation;
 *   3. the terminal revocation status of the active head, its own boolean;
 *   4. `did:key` of the currently registered Ed25519 approval key, which changes on
 *      rotation and never moves the subject.
 *
 * The fifth thing — scoped `root`/`device`/`session`/`agent` delegation claims —
 * is checked here and granted nowhere. A claim carries no signature; this package
 * reports named refusals about scope and returns no "allowed".
 *
 * WHAT IT NEVER DOES. It does not authorize. It does not sign. It does not create,
 * rotate or provision a controller. It does not emit `identityBound`, perform a
 * ceremony, or claim hardware custody or succession. It never returns private key
 * material. Every human-facing entry point prints the ceilings in `ceilings.mjs`,
 * and the court asserts those ceilings appear on the accepting paths too.
 *
 * NO BUILD STEP. The modules under `lib/` are the shipped bytes; nothing
 * transpiles or bundles them, so a reader reviewing a digest is reviewing what
 * runs. Most imports are `node:*` builtins. The ONE exception is
 * `lib/vendor/noble-ml-dsa/`, the measured and pinned ML-DSA-65 closure this lane
 * needs to generate a real post-quantum keypair: eight upstream modules plus a
 * three-module Genesis-authored entry, with every specifier rewritten to a
 * relative path so the tree holds with no `node_modules` and no network. It is
 * vendored rather than depended on because this repository has no package
 * manifest and no install step; `lib/vendor/noble-ml-dsa/PROVENANCE.md` records
 * the upstream pins, the licences and the exact rewrite.
 *
 * PROVENANCE. `scripts/aumlok/PROVENANCE.md` records the Deep source pin
 * (`c417f7c5752bf14b8e927986cd995f2e086f4189`), which modules are ports of which
 * Deep modules, the measured compatibility mapping between this adapter and Deep's
 * hybrid root-control layer plus Genesis's Ed25519 action signer, and the two
 * checks this closure cannot perform.
 *
 * @module @aukora/dsh-plugin-aumlok
 */

export {
  CanonicalJSONError,
  canonicalJSON,
  digestCanonical,
} from './canonical.mjs'

export {
  Base58Error,
  base58btcDecode,
  base58btcEncode,
} from './base58.mjs'

export {
  BASE58BTC_MULTIBASE,
  DID_KEY_PREFIX,
  DidKeyError,
  ED25519_PUB_MULTICODEC,
  didKeyFromEd25519PublicKey,
  didKeyFromPublicKeyPem,
  ed25519PublicKeyFromDidKey,
  ed25519PublicKeyFromPem,
} from './did-key.mjs'

export {
  AUKORA_ID_PREFIX,
  IDENTITY_GENESIS_DOMAIN,
  IDENTITY_SUBJECT_DIGEST_DOMAIN,
  aukoraIdFromGenesis,
  createIdentityGenesis,
  parseIdentityGenesis,
} from './genesis.mjs'

export {
  AUMLOK_CONTROL_REFUSE,
  AUMLOK_ROOT_CONTROL_CONTEXT,
  AUMLOK_ROOT_CONTROL_SUITE,
  ROOT_CONTROL_AUTHORIZATION_DOMAIN,
  ROOT_CONTROL_STATE_DOMAIN,
  SIGNED_ROOT_CONTROL_PROMOTION_DOMAIN,
  createInitialIdentityControl,
  createRootControlAuthorization,
  createSignedRootControlPromotion,
  identityControlDigest,
  nodeCryptoVerifierCapabilities,
  parseIdentityControlState,
  parseRootControlAuthorization,
  parseSignedRootControlPromotion,
  rootControlAuthorizationBytes,
  rootKeySetId,
  verifyAndApplyRootControlPromotion,
} from './control.mjs'

export {
  DELEGATION_CLAIM_DOMAIN,
  createDelegationClaim,
  delegationClaimDigest,
  parseDelegationClaim,
  verifyDelegationAttenuation,
} from './delegation.mjs'

export {
  ATTENDANCE,
  CEILINGS,
  CEILING_TEXTS,
  ceilingLines,
  printCeilings,
  printSignerCeilings,
  signerCeilingLines,
} from './ceilings.mjs'

export {
  AUMLOK_SERVICE_REFUSE,
  AumlokServiceError,
  SERVICE_CONFIG_FIELDS,
  SERVICE_NAME,
  apply,
  createAumlokControlService,
} from './service.mjs'

export {
  APPROVAL_REFUSE,
  APPROVAL_REQUEST_DOMAIN,
  APPROVAL_REQUEST_FIELDS,
  APPROVAL_RESPONSE_DOMAIN,
  APPROVAL_SIGNATURE_DOMAIN,
  ApprovalError,
  SIGNER_REFUSE,
  approvalSigningBytes,
  createApprovalRequest,
  createRefusedApprovalResponse,
  createSignedApprovalResponse,
  parseApprovalRequest,
  parseApprovalResponse,
  serializeApprovalResponse,
} from './owner-approval.mjs'

export {
  createOwnerSigner,
  createTestApprover,
  createTestDecliner,
  rawEd25519PublicKeyHex,
} from './owner-signer.mjs'

export {
  isValidEd25519Point,
  validateEd25519PublicKeyHex,
} from './ed25519-point.mjs'

export {
  CEREMONY_TOKEN_NAMES,
  ceremonyTokenValues,
} from './ceremony-tokens.mjs'

export {
  PHRASE_BANDS,
  PHRASE_TABLES,
  // ── **`generateAcrosticPhrase` IS NO LONGER RE-EXPORTED (AUMLOK-113)** ────────────────────────────────
  //
  // REVIEWER ROW 8: *"the 14.3-bit generator is still exported"*. **A generator is an INVITATION.** A caller
  // reaching into this package for `generateAcrosticPhrase` gets seven words worth ~14.3 bits and — on this
  // design — a root key. Its presence on the public surface says the cheap phrase is a thing this library
  // offers, which is the sentence the entropy ceiling exists to contradict.
  //
  // **THE FUNCTION STAYS IN `ceremony-phrase.mjs` AND ITS COURTS STILL DRIVE IT.** The acrostic is Peter's to
  // keep; what is withdrawn is the PUBLIC OFFER, not the capability. Deleting the implementation would break
  // the ceremony this ruling preserves, and the redesign is what changes WHAT THE WORDS RELEASE — a word chosen
  // against this lane's own ban, which the first draft of this comment tripped.
} from './ceremony-phrase.mjs'

export {
  BIND_PHRASE_WORDS,
  PHRASE_KDF_V2,
  newSaltHex,
  normalizePhrase,
  safeEqualHex,
  saltedFingerprint,
  scryptHex,
  sealPhrase,
  verifyGrantsAuthority,
  verifyPhrase,
} from './ceremony-verify.mjs'

// THE KEYGEN INSTALLER MOVED WITH ITS STATE (v3). It used to be re-exported from the custody core; the
// core is being deleted, and the one dynamic loader that installs the vendored keygen lives in
// `pq-generator.mjs`, so that is where these are read from now — one state, one owner, no second copy
// that a caller could install into and never see take effect.
export {
  installMlDsa65Keygen,
  mlDsa65KeygenInstalled,
} from './pq-generator.mjs'

export {
  ML_DSA_65_KEYGEN_REFUSE,
  ML_DSA_65_LENGTHS,
  ML_DSA_65_PROBE_CONTEXT,
  ML_DSA_65_PROBE_DOMAIN,
  MlDsa65KeygenError,
  acquireCorrespondingMlDsa65Keypair,
  generateCorrespondingMlDsa65Keypair,
  vendoredMlDsa65Capability,
} from './pq-generator.mjs'

export {
  POPUP_BUTTONS,
  POPUP_REFUSE,
  approvalPopupArgv,
  approvalPopupText,
  popupDecision,
} from './approval-popup.mjs'

export {
  APPROVAL_CLASSES,
  APPROVAL_RECEIPT_DOMAIN,
  APPROVAL_RECEIPT_FIELDS,
  ApprovalReceiptError,
  DEFAULT_APPROVAL_CLASS,
  KEY_CLASSES,
  OWNER_KEY_SIGNED,
  RECEIPT_REFUSE,
  approvalReceiptBytes,
  approvalReceiptLines,
  createApprovalReceipt,
  parseApprovalReceipt,
} from './approval-receipt.mjs'

export {
  DEFAULT_SIGNER_TIMEOUT_MS,
  MAX_APPROVAL_LINE_BYTES,
  SIGNER_SOCKET_PATH_REFUSE,
  createOwnerApprovalSession,
  encodeApprovalResponse,
  exchangeLine,
  socketPathLengthProblem,
  socketPathLimitBytes,
} from './signer-channel.mjs'

export {
  AUMLOK_ADMIT_REFUSE,
  AUMLOK_PROJECT_REFUSE,
  AumlokProjectionError,
  LOCAL_AUMLOK_CUSTODY_CLASS,
  PUBLIC_CONTROL_DOMAIN,
  PUBLIC_CONTROL_FIELDS,
  admitPublicControl,
  parsePublicControl,
  projectPublicControl,
  publicControlDigest,
} from './projection.mjs'

export {
  LOCAL_AUMLOK_AMENDMENT_POLICY,
  LOCAL_AUMLOK_AMENDMENT_POLICY_DOMAIN,
  LOCAL_AUMLOK_CONTROL_DOMAIN,
  LOCAL_AUMLOK_CONTROL_FILENAME,
  LOCAL_AUMLOK_CONTROL_REFUSE,
  LocalAumlokControlError,
  loadLocalAumlokPublicControl,
  localAumlokAmendmentRuleDigest,
  localAumlokControlPath,
  parseLocalAumlokPublicHalf,
  readLocalAumlokFullRecord,
} from './store.mjs'

// THE v3 RECORD AND ITS READER, EXPORTED BECAUSE A CONSUMER MUST BE ABLE TO ASK WHICH FORMAT IT
// HOLDS. `store.mjs` dispatches on the record's own domain rather than guessing by shape, and a
// caller that has to make the same decision — `scripts/aumlok/bind-overlay.mjs` refuses a v1
// disposable record and accepts a bound one — needs the same predicate instead of inspecting fields
// and re-deriving the rule in a script. The writer and the MACHINE seed reader come with it for the
// same reason: one reader of one format, not a second opinion. THERE IS NO ROOT SEED READER BESIDE
// THEM ANY MORE (Y1, 2026-09-23): `readKeptRootSeed` read `root-seed-v3.json`, that file's writer is
// deleted because the cold-root design keeps no root, and a reader for a file nobody writes would be
// an export that promises custody the organ does not have.
// THE CONTROL PROJECTION OF A v3 RECORD IS A SECOND, NAMED VIEW, AND IT IS EXPORTED BESIDE THE
// RECORD'S OWN. `recordProjection` answers "which keys does this identity publish, and when was it
// bound"; `projectRecordV3Control` answers "which identity is this, at which control head, and which
// machine key signs its approvals HERE" — the seven fields `projection.mjs` defines and the admission
// machinery reads. A caller that pins a subject and a control digest needs the second one, and
// `loadLocalAumlokPublicControl` now answers with it for a v3 record.
export {
  RECORD_CONTROL_EXTRA_FIELDS,
  RECORD_CONTROL_FIELDS,
  approvalKeyDidOfRecordV3,
  buildRecordV3,
  controlFieldsOfRecordV3Projection,
  isRecordV3,
  keepMachineSeed,
  projectRecordV3Control,
  readKeptMachineSeed,
  recordProjection,
  writeRecordV3,
} from './record-v3.mjs'

export {
  AUMLOK_HANDLE,
  AUMLOK_HANDLE_LENGTH,
  AUMLOK_KDF_ID,
  DERIVE_REFUSE,
  DeriveV3Error,
  KDF_SALT_SEPARATOR_HEX,
  PHRASE_KDF_V3,
  assertHandle,
  deriveRootFromPhrase,
  deriveSeeds,
  handleSalt,
  kdfBytes,
  measureKdfSecondsPerGuess,
  normalizeHandle,
  phrasePreimage,
  requireHandle,
} from './derive-v3.mjs'

// THE FIRST BINDING, EXPORTED BESIDE THE REFRESH THAT MIRRORS IT. `refreshBindingV3` has always
// described its kept material as mirroring `bind`; until this export there was no bind to mirror, and
// the shell answered a correct type-back with a verdict and no write.
export { BIND_REFUSE, BindV3Error, bindV3 } from './bind-v3.mjs'

export {
  IDENTITY_CORRESPONDENCE_REFUSE,
  IdentityCorrespondenceError,
  verifyIdentityCorrespondence,
} from './identity-correspondence.mjs'

export {
  APPROVAL_CLASS_DEFAULT,
  APPROVAL_KEY_CLASS,
  APPROVAL_PATH_REFUSE,
  OPERATION_CONTENT_DOMAIN,
  SETTLEMENT_RECORD_DOMAIN,
  SPENT_CHALLENGE_DIRECTORY,
  approveOperation,
  decodeForDisplay,
  escapeForDisplay,
  openSettlementState,
  operationDigestOf,
  readApprovalArtifact,
  settleOperation,
  witnessOperationContent,
} from './operation-approval.mjs'

export {
  SUBJECT_REFUSE,
  isSubject,
  parseSubject,
} from './subject.mjs'

// THE REFRESH AND THE HANDOVER. A consumer that must carry an identity across a new root — the shell's
// "New phrase" act and the overlay that follows the subject — needs the SAME line builder and the SAME
// verifier the ceremony uses, so they are exported here rather than reached for by path.
export {
  HANDOVER_DOMAIN,
  HANDOVER_FIELDS,
  HANDOVER_SIGNING_DOMAIN,
  REFRESH_REFUSE,
  RefreshV3Error,
  buildHandoverV3,
  handoverSigningBytes,
  refreshBindingV3,
  rootPrivateKeyOf,
  verifyHandoverV3,
  verifySuccessionV3,
} from './refresh-v3.mjs'

// THE MACHINE SIGNER, AND THE ANSWER THAT NAMES THE KEY. Approvals sign with the machine key this
// machine kept; the answer is a record naming which key acted rather than a boolean, because a boolean
// is a value a program can produce and an approval is a signature a key must make.
export {
  MACHINE_ANSWER_ACT,
  MACHINE_ANSWER_CLASS,
  MACHINE_ANSWER_DOMAIN,
  MACHINE_ANSWER_REFUSE,
  answerApprovalV3,
  machineAnswerSigningBytes,
  openMachineSignerV3,
  readSignerAnswer,
  verifySignerAnswer,
} from './machine-signer-v3.mjs'
