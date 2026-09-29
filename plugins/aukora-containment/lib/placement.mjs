/**
 * Increment 1 placement record for a candidate OpenShell workload.
 *
 * STAGE only. Nothing in this module launches a process, mounts a filesystem,
 * opens a socket, or writes a receipt. The macOS desktop app does not import it.
 *
 * @module @aukora/containment/placement
 */

/** Checkout this stage was written against. Short form; not a spec digest. */
export const BASE_COMMIT = '28956e78a'

/**
 * Same-UID ceiling, named here so a later green court cannot drop it.
 * An OpenShell guest UID does not replace this macOS fact.
 */
export const SAME_UID_CEILING = 'The macOS desktop app and the agent share one UID. '
  + 'Airlock can hold the approval key in another account, and the signer socket still accepts requests from the app UID. '
  + 'Seatbelt confines BUILD (workspace-write) and read-only shells; danger-full-access sessions stay on the host. '
  + 'A Linux guest UID under Docker Desktop is a different principal inside that guest, not a second macOS account.'

/** Organs keep the README meanings. None of them move into the workload. */
export const ORGANS = Object.freeze({
  aura: Object.freeze({ role: 'evidence', placement: 'outside', path: 'scripts/aura/' }),
  kira: Object.freeze({ role: 'memory', placement: 'outside', path: 'plugins/aukora-kira/' }),
  aumlok: Object.freeze({ role: 'identity-approval', placement: 'outside', path: 'plugins/aukora-aumlok/' }),
})

/**
 * Proposed responsibility map. Cordis work sits inside the candidate workload.
 * Authority services stay outside the domain they govern.
 */
export const PLACEMENT = Object.freeze({
  insideWorkload: Object.freeze([
    'cordis-agent',
    'ordinary-tool-plugins',
    'owned-child-processes',
  ]),
  outsideWorkload: Object.freeze([
    'broker',
    'issuer',
    'workspace.patch',
    'recovery-checkpoint',
    'aura-evidence',
    'kira-memory',
    'aumlok-approval',
  ]),
})

/** Existing tree seams this stage reuses by path. It does not mount them. */
export const SEAMS = Object.freeze({
  effectDefinition: 'plugins/aukora-box/aukora/broker/effect-definition.mjs',
  workspacePatchExecutor: 'plugins/aukora-box/aukora/broker/workspace-patch.mjs',
  broker: 'plugins/aukora-box/aukora/broker/broker.mjs',
  seatbeltProfile: 'plugins/aukora-seatbelt/lib/profile.mjs',
  actionGate: 'plugins/aukora-action-gate/lib/index.mjs',
  signerSocketShape: 'Library/Application Support/AUKORA/state/aumlok-signer.sock',
})

export const REFUSAL = Object.freeze({
  signerSocketForward: 'containment:signer-socket-forward-refused',
  homeMount: 'containment:home-mount-refused',
  universalShell: 'containment:universal-shell-refused',
  bestEffort: 'containment:best-effort-refused',
  workerPolicy: 'containment:worker-policy-change-refused',
  notWired: 'containment:not-wired',
  requestShape: 'containment:request-not-object',
})

/** Required filesystem compatibility for a profile that claims an extra restriction. */
export const REQUIRED_FILESYSTEM_COMPATIBILITY = 'hard_requirement'

/**
 * Gate A is a supported-backend record: exact build, API capabilities, and platform.
 * This list is why the record is unmet in this tree. It is not a pass/fail of those items.
 */
export const GATE_A_BLOCKERS = Object.freeze([
  'no pinned OpenShell build, driver, or image digest is enrolled in this tree',
  'the 2026-09-29 Mac spike was a measure on one machine; this mirror did not re-run it',
  'upstream main and the measured release tag can differ; one build is not pinned',
  'ordinary-worker and gateway-admin credentials are not shown to be different clients',
  'the measured policy schema denies files by omission and cannot exclude a child of an allowed directory',
  'Landlock denial of a mounted path was not observed; absent bind-mounts returned ENOENT',
  'Docker Desktop was the measure driver, not a production authority',
  'the measured default image has no sandbox user; root stays refused and the user pin is unfinished',
  'B01 and B02 have no joint observation of one worker',
  'the macOS same-UID ceiling is unchanged',
  'control-plane governance is a later increment',
  'a person cannot approve inside a short middleware timeout; that path is not this increment',
])

export const STAGE = Object.freeze({
  status: 'STAGE',
  wired: false,
  mounted: false,
  become: false,
  liveElectron: false,
  openshellIsApprove: false,
  gateA: 'UNMET',
  baseCommit: BASE_COMMIT,
  sameUidCeiling: SAME_UID_CEILING,
})
