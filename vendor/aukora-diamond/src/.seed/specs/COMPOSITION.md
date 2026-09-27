# Composition grant (toy)

Governed unit = composition transition (plugin load/unload), not a tool call.

Grant preimage (Ed25519, one-use): pluginDigest + coeffectEnvelopeDigest +
compositionDigest + subjectDigest + activationDigest + operation ∈ {load,
unload} + nonce + issuedAt + expiry + maxTTL under domain
aukora-grant/v1-toy. Optional maxDepth / sessionDigest / parentDigest.

Two kinds, each with its own signed domain:
  aukora-grant/v1-toy           activation-bound (default)
  aukora-grant/v1-toy-portable  escapes epoch/restart revocation, and carries
                                the signed `portable` flag. A normal grant may
                                NOT carry that flag (`grant:portable-kind-required`).

Refuse activate without a valid unspent grant.
Nonce consume is atomic (`O_EXCL` file-per-nonce) across processes.
Loader requires a MediatorProvider to construct; disable → MEDIATOR_OFF
before grant evaluation.
Ceilings always printed: BOOTSTRAP_UNGATED / SAME_UID /
SUCCESSION_UNMEASURED / PYTHON_RUNTIME_TCB / MEDIATOR_INPROCESS.

Optional strict patent-license grant (`aukora-patent-license/v1`), signed by
patentee root (separate from governor), when env
`AUKORA_STRICT_PATENT_LICENSE=1` or mediator `require_patent_license=True`.
Scope binds to pluginDigest. One-use via O_EXCL under spent-patent-nonces/.
Receipt composition may reference patentLicenseNonce + patentDocketId.
Not DRM over forks — conforming authorization plumbing only.

Required signed blast-radius: `issuedAt` + `maxTTL` (integer seconds).
At verify/activate: `issuedAt <= now <= expiry` (small skew OK),
`expiry - issuedAt <= maxTTL` else `grant:ttl-unbounded`. Optional
`maxDepth` (default 1) → `grant:depth-exceeded`. GovernorPk pinned by loader.
Subject/session/composition pinned by loader (P0/P2).
Delegation monotonicity: a child grant must be a subset of its parent
(`grant.delegate()`, `parentDigest`), else `grant:delegation-widened`.

Settlement: the nonce reservation and the committed settlement are separate
durable boundaries; a crash between them is `AUTHORITY_CONSUMED_EFFECT_UNKNOWN`
or `INDETERMINATE`, never success and never a clean refusal.

