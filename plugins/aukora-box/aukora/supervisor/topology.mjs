/**
 * Read-only observation of the operating-system principals, jobs, groups, and
 * filesystem objects named by a launch-downward topology manifest.
 *
 * The manifest contains names and paths only. Identity, membership, process,
 * ownership, type, and mode facts always come from the running host.
 *
 * @module @aukora/supervisor/topology
 */
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import { userInfo } from 'node:os'
import { posix } from 'node:path'

/** The only manifest schema accepted by this preflight. */
export const TOPOLOGY_MANIFEST_SCHEMA = 'aukora:launch-topology:v1'

/** The observation schema emitted by this preflight. */
export const TOPOLOGY_OBSERVATION_SCHEMA = 'aukora:topology-observation:v1'

/** The schema for failures that occur before any operating-system observation. */
export const TOPOLOGY_INPUT_REFUSAL_SCHEMA = 'aukora:topology-input-refusal:v1'

/** The schema for an unexpected failure after live observation began. */
export const TOPOLOGY_OBSERVATION_FAILURE_SCHEMA = 'aukora:topology-observation-failure:v1'

/** Evidence that this non-activating observer deliberately does not claim. */
export const TOPOLOGY_VERIFICATION_BLOCKERS = Object.freeze([
  'supervisor:active-probes-not-run',
  'supervisor:closure-members-unmeasured',
  'supervisor:runtime-path-binding-unmeasured',
  'supervisor:route-membership-closure-unmeasured',
  'supervisor:peer-authentication-unmeasured',
  'supervisor:extended-acls-unmeasured',
  'supervisor:observer-privilege-unresolved',
])

const OBSERVATION_TIMEOUT_MS = 5000

const IDENTIFIER = /^[A-Za-z0-9_][A-Za-z0-9_.:@-]{0,127}$/
const PLATFORM = new Set(['darwin', 'linux'])

const SERVICE_NAMES = ['issuer', 'broker', 'guest']
const PRINCIPAL_NAMES = ['human-session', ...SERVICE_NAMES]
const ROUTE_NAMES = ['humanIssuer', 'brokerIssuer', 'guestBroker']

const ROUTE_POLICY = Object.freeze({
  humanIssuer: Object.freeze({ owner: 'issuer', peer: 'human-session' }),
  brokerIssuer: Object.freeze({ owner: 'issuer', peer: 'broker' }),
  guestBroker: Object.freeze({ owner: 'broker', peer: 'guest' }),
})

const PROTECTED_POLICY = Object.freeze({
  'socket-root': Object.freeze({ owner: 'human-session', type: 'directory', mode: 0o755 }),
  'root-key': Object.freeze({ owner: 'issuer', type: 'file', mode: 0o600 }),
  'receipt-key': Object.freeze({ owner: 'broker', type: 'file', mode: 0o600 }),
  'nonce-state': Object.freeze({ owner: 'broker', type: 'directory', mode: 0o700 }),
  evidence: Object.freeze({ owner: 'broker', type: 'file', mode: 0o600 }),
  'active-profile': Object.freeze({ owner: 'human-session', type: 'directory', mode: 0o555 }),
  'active-artifact': Object.freeze({ owner: 'human-session', type: 'directory', mode: 0o555 }),
  'implementation-closure': Object.freeze({ owner: 'human-session', type: 'directory', mode: 0o555 }),
  'guest-scratch': Object.freeze({ owner: 'guest', type: 'directory', mode: 0o700 }),
})

/** A manifest refusal with a stable reason and subject. */
export class TopologyManifestError extends Error {
  /**
   * Create a manifest refusal.
   * @param {string} reason - Stable refusal reason.
   * @param {string} subject - Manifest location that failed validation.
   * @param {string} detail - Human-readable failure detail.
   */
  constructor(reason, subject, detail) {
    super(detail)
    this.name = 'TopologyManifestError'
    this.reason = reason
    this.subject = subject
  }
}

/**
 * Parse and validate a launch-downward topology manifest.
 * @param {string | Buffer | unknown} input - JSON bytes or an already parsed value.
 * @returns {import('./topology.mjs').TopologyManifest} The validated manifest.
 */
export function parseTopologyManifest(input) {
  let value = input
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    try {
      value = JSON.parse(input.toString())
    }
    catch (error) {
      throw new TopologyManifestError('topology:manifest-malformed', '$', error instanceof Error ? error.message : String(error))
    }
  }

  const root = requireObject(value, '$')
  requireExactKeys(root, ['schema', 'platform', 'humanSession', 'services', 'routes', 'protectedPaths'], '$')
  requireEqual(root.schema, TOPOLOGY_MANIFEST_SCHEMA, '$.schema')
  if (!PLATFORM.has(root.platform)) {
    throw manifestError('$.platform', `must be one of ${[...PLATFORM].join(', ')}`)
  }

  const humanSession = requireObject(root.humanSession, '$.humanSession')
  requireExactKeys(humanSession, ['source', 'approvalJobLabel'], '$.humanSession')
  requireEqual(humanSession.source, 'invoking-process-user', '$.humanSession.source')
  requireIdentifier(humanSession.approvalJobLabel, '$.humanSession.approvalJobLabel')

  const services = requireObject(root.services, '$.services')
  requireExactKeys(services, SERVICE_NAMES, '$.services')
  for (const serviceName of SERVICE_NAMES) {
    const service = requireObject(services[serviceName], `$.services.${serviceName}`)
    requireExactKeys(service, ['account', 'jobLabel'], `$.services.${serviceName}`)
    requireIdentifier(service.account, `$.services.${serviceName}.account`)
    requireIdentifier(service.jobLabel, `$.services.${serviceName}.jobLabel`)
  }

  const routes = requireObject(root.routes, '$.routes')
  requireExactKeys(routes, ROUTE_NAMES, '$.routes')
  for (const routeName of ROUTE_NAMES) {
    const route = requireObject(routes[routeName], `$.routes.${routeName}`)
    requireExactKeys(route, ['group', 'directoryPath', 'socketPath'], `$.routes.${routeName}`)
    requireIdentifier(route.group, `$.routes.${routeName}.group`)
    requireAbsoluteNormalizedPath(route.directoryPath, `$.routes.${routeName}.directoryPath`)
    requireAbsoluteNormalizedPath(route.socketPath, `$.routes.${routeName}.socketPath`)
    if (posix.dirname(route.socketPath) !== route.directoryPath) {
      throw manifestError(`$.routes.${routeName}.socketPath`, 'must be an immediate child of directoryPath')
    }
  }

  if (!Array.isArray(root.protectedPaths)) {
    throw manifestError('$.protectedPaths', 'must be an array')
  }
  const protectedKinds = Object.keys(PROTECTED_POLICY)
  if (root.protectedPaths.length !== protectedKinds.length) {
    throw manifestError('$.protectedPaths', `must contain exactly one entry for each required kind: ${protectedKinds.join(', ')}`)
  }
  const seenKinds = new Set()
  for (const [index, rawProtectedPath] of root.protectedPaths.entries()) {
    const subject = `$.protectedPaths[${index}]`
    const protectedPath = requireObject(rawProtectedPath, subject)
    requireExactKeys(protectedPath, ['kind', 'path'], subject)
    if (!Object.hasOwn(PROTECTED_POLICY, protectedPath.kind)) {
      throw manifestError(`${subject}.kind`, `must be one of ${protectedKinds.join(', ')}`)
    }
    if (seenKinds.has(protectedPath.kind)) {
      throw manifestError(`${subject}.kind`, `duplicates ${protectedPath.kind}`)
    }
    seenKinds.add(protectedPath.kind)
    requireAbsoluteNormalizedPath(protectedPath.path, `${subject}.path`)
  }

  const socketRoot = root.protectedPaths.find(item => item.kind === 'socket-root').path
  for (const routeName of ROUTE_NAMES) {
    if (posix.dirname(root.routes[routeName].directoryPath) !== socketRoot) {
      throw new TopologyManifestError(
        'topology:route-outside-socket-root',
        `$.routes.${routeName}.directoryPath`,
        `must be an immediate child of protectedPaths.socket-root ${socketRoot}`,
      )
    }
  }

  return /** @type {import('./topology.mjs').TopologyManifest} */ (root)
}

/**
 * Classify configuration refusals without upgrading observation into verification.
 * @param {readonly import('./topology.mjs').TopologyRefusal[]} refusals - Configuration refusals produced from live facts.
 * @returns {{status: 'REFUSED' | 'UNVERIFIED', configurationMatched: boolean}} The non-authorizing disposition.
 */
export function topologyDisposition(refusals) {
  const configurationMatched = refusals.length === 0
  return {
    status: configurationMatched ? 'UNVERIFIED' : 'REFUSED',
    configurationMatched,
  }
}

/**
 * Map a topology disposition to its nonzero diagnostic CLI status.
 * @param {'REFUSED' | 'UNVERIFIED'} status - Observation disposition.
 * @returns {1 | 2} One for refusal or two for matched-but-unverified configuration.
 */
export function topologyCliExitCode(status) {
  if (status === 'REFUSED') return 1
  if (status === 'UNVERIFIED') return 2
  throw new Error(`topology: unsupported disposition ${String(status)}`)
}

/**
 * Observe a named topology without changing accounts, jobs, groups, modes, or files.
 * @param {string | Buffer | unknown} input - JSON bytes or an already parsed manifest.
 * @returns {import('./topology.mjs').TopologyObservation} Live host observations and named refusals.
 */
export function inspectTopology(input) {
  const manifest = parseTopologyManifest(input)
  const refusals = []
  const addRefusal = (reason, subject, detail) => {
    refusals.push({ reason, subject, detail })
  }

  const login = userInfo()
  const humanAccount = observeAccount(login.username)
  const human = humanAccount ?? {
    account: login.username,
    uid: login.uid,
    gid: login.gid,
    groups: [],
  }
  if (humanAccount === null || humanAccount.uid !== login.uid || humanAccount.gid !== login.gid) {
    addRefusal('supervisor:invoking-user-unobservable', 'human-session', 'node:os and the host identity database did not yield one matching invoking-process identity')
  }

  if (manifest.platform !== process.platform) {
    addRefusal('topology:manifest-platform-mismatch', '$.platform', `manifest names ${manifest.platform}; live host is ${process.platform}`)
  }
  if (!PLATFORM.has(process.platform)) {
    addRefusal('supervisor:platform-unsupported', 'host', `preflight supports darwin and linux; live host is ${process.platform}`)
  }

  const principals = {
    'human-session': human,
    issuer: null,
    broker: null,
    guest: null,
  }
  for (const serviceName of SERVICE_NAMES) {
    const account = manifest.services[serviceName].account
    const facts = observeAccount(account)
    principals[serviceName] = facts
    if (facts === null) {
      addRefusal('supervisor:principal-unobserved', serviceName, `host identity observation yielded no complete account facts for ${account}`)
    }
  }

  const presentPrincipals = PRINCIPAL_NAMES.flatMap((principalName) => {
    const facts = principals[principalName]
    return facts === null ? [] : [{ principalName, ...facts }]
  })
  for (const collision of collisionsBy(presentPrincipals, item => String(item.uid))) {
    addRefusal('supervisor:principals-merged', collision.map(item => item.principalName).join(','), `live uid ${collision[0].uid} is shared by ${collision.map(item => item.account).join(', ')}`)
  }

  const jobNames = [
    { principal: 'human-session', label: manifest.humanSession.approvalJobLabel },
    ...SERVICE_NAMES.map(principal => ({ principal, label: manifest.services[principal].jobLabel })),
  ]
  for (const collision of collisionsBy(jobNames, item => item.label)) {
    addRefusal('supervisor:jobs-merged', collision.map(item => item.principal).join(','), `job label ${collision[0].label} is reused`)
  }

  const namedPaths = [
    ...ROUTE_NAMES.flatMap(routeName => [
      { subject: `routes.${routeName}.directoryPath`, path: manifest.routes[routeName].directoryPath },
      { subject: `routes.${routeName}.socketPath`, path: manifest.routes[routeName].socketPath },
    ]),
    ...manifest.protectedPaths.map(item => ({ subject: `protectedPaths.${item.kind}`, path: item.path })),
  ]
  for (const collision of collisionsBy(namedPaths, item => item.path)) {
    addRefusal('supervisor:paths-merged', collision.map(item => item.subject).join(','), `path ${collision[0].path} is reused`)
  }

  const jobs = {}
  if (manifest.platform === process.platform && PLATFORM.has(process.platform)) {
    for (const jobName of jobNames) {
      const expectedPrincipal = principals[jobName.principal]
      const observedJob = observeJob(process.platform, jobName.principal, jobName.label, human.uid)
      jobs[jobName.principal] = observedJob
      if (observedJob === null) {
        addRefusal('supervisor:principal-job-unobserved', jobName.principal, `no running ${jobName.label} job was observed in its required domain`)
      }
      else if (expectedPrincipal !== null && observedJob.uid !== expectedPrincipal.uid) {
        addRefusal('supervisor:job-principal-mismatch', jobName.principal, `job ${jobName.label} runs as uid ${observedJob.uid}; live account uid is ${expectedPrincipal.uid}`)
      }
    }
  }

  const routeObservations = {}
  const resolvedRouteGroups = []
  for (const routeName of ROUTE_NAMES) {
    const route = manifest.routes[routeName]
    const policy = ROUTE_POLICY[routeName]
    const owner = principals[policy.owner]
    const peer = principals[policy.peer]
    const groupGid = groupIdFromPeer(peer, route.group)
    if (peer !== null && groupGid === null) {
      addRefusal('supervisor:route-peer-group-missing', routeName, `${policy.peer} is not a member of ${route.group} according to the host identity database`)
    }
    if (groupGid !== null) {
      resolvedRouteGroups.push({ routeName, manifestName: route.group, gid: groupGid })
      for (const principalName of PRINCIPAL_NAMES) {
        if (principalName === policy.peer || principalName === policy.owner) continue
        const candidate = principals[principalName]
        if (candidate?.groups.some(group => group.gid === groupGid)) {
          addRefusal('supervisor:route-outsider-group-member', routeName, `${principalName} is also a member of live gid ${groupGid} (${route.group})`)
        }
      }
    }

    const directory = observePath(route.directoryPath)
    const socket = observePath(route.socketPath)
    routeObservations[routeName] = { group: route.group, groupGid, directory, socket }
    evaluatePath(directory, {
      subject: `routes.${routeName}.directoryPath`,
      expectedType: 'directory',
      expectedMode: 0o710,
      expectedUid: owner?.uid ?? null,
      expectedGid: groupGid,
    }, addRefusal)
    if (directory !== null && directory.type !== 'unobservable') {
      evaluateAncestorCustody(route.directoryPath, directory, principals.guest, `routes.${routeName}.directoryPath`, addRefusal)
    }
    evaluatePath(socket, {
      subject: `routes.${routeName}.socketPath`,
      expectedType: 'socket',
      expectedMode: 0o660,
      expectedUid: owner?.uid ?? null,
      expectedGid: groupGid,
    }, addRefusal)
    if (socket !== null && socket.type !== 'unobservable') {
      evaluateAncestorCustody(route.socketPath, socket, principals.guest, `routes.${routeName}.socketPath`, addRefusal)
    }
  }

  for (const collision of collisionsBy(resolvedRouteGroups, item => String(item.gid))) {
    addRefusal(
      'supervisor:route-groups-merged',
      collision.map(item => item.routeName).join(','),
      `live gid ${collision[0].gid} is reused through ${collision.map(item => item.manifestName).join(', ')}`,
    )
  }

  const protectedPathObservations = {}
  for (const protectedPath of manifest.protectedPaths) {
    const policy = PROTECTED_POLICY[protectedPath.kind]
    const observation = observePath(protectedPath.path)
    protectedPathObservations[protectedPath.kind] = observation
    evaluatePath(observation, {
      subject: `protectedPaths.${protectedPath.kind}`,
      expectedType: policy.type,
      expectedMode: policy.mode,
      expectedUid: principals[policy.owner]?.uid ?? null,
      expectedGid: null,
    }, addRefusal)
    if (policy.owner !== 'guest' && observation !== null && observation.type !== 'unobservable') {
      evaluateAncestorCustody(protectedPath.path, observation, principals.guest, `protectedPaths.${protectedPath.kind}`, addRefusal)
    }
  }

  const disposition = topologyDisposition(refusals)
  return {
    schema: TOPOLOGY_OBSERVATION_SCHEMA,
    ...disposition,
    observationClass: 'CONFIGURATION_ONLY',
    factsSource: 'live-os',
    activationPerformed: false,
    hostMutationPerformed: false,
    separationVerified: false,
    verificationBlockers: [...TOPOLOGY_VERIFICATION_BLOCKERS],
    platform: process.platform,
    observer: {
      source: 'invoking-process-user',
      uid: human.uid,
      privilegeClass: human.uid === 0 ? 'PRIVILEGED' : 'UNPRIVILEGED',
      serviceStateTraversalClaimed: false,
    },
    humanSession: human,
    principals,
    jobs,
    routes: routeObservations,
    protectedPaths: protectedPathObservations,
    refusals,
  }
}

function manifestError(subject, detail) {
  return new TopologyManifestError('topology:manifest-malformed', subject, detail)
}

function requireObject(value, subject) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw manifestError(subject, 'must be an object')
  }
  return value
}

function requireExactKeys(value, expected, subject) {
  const expectedSet = new Set(expected)
  for (const key of Object.keys(value)) {
    if (!expectedSet.has(key)) {
      throw new TopologyManifestError('topology:manifest-unknown-field', `${subject}.${key}`, 'observed identity and state fields are forbidden in manifests')
    }
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) {
      throw manifestError(`${subject}.${key}`, 'is required')
    }
  }
}

function requireEqual(value, expected, subject) {
  if (value !== expected) {
    throw manifestError(subject, `must equal ${JSON.stringify(expected)}`)
  }
}

function requireIdentifier(value, subject) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw manifestError(subject, 'must be a host identifier without whitespace or option prefixes')
  }
}

function requireAbsoluteNormalizedPath(value, subject) {
  if (typeof value !== 'string' || !posix.isAbsolute(value) || posix.resolve(value) !== value || value === '/') {
    throw manifestError(subject, 'must be a normalized absolute path below the filesystem root')
  }
}

function collisionsBy(items, keyOf) {
  const buckets = new Map()
  for (const item of items) {
    const key = keyOf(item)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }
  return [...buckets.values()].filter(bucket => bucket.length > 1)
}

function run(command, args, extraEnvironment = {}) {
  if (!existsSync(command)) return null
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', ...extraEnvironment },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: OBSERVATION_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
  })
  if (result.status !== 0) return null
  return result.stdout.trim()
}

function observeAccount(account) {
  const uidRaw = run('/usr/bin/id', ['-u', account])
  const gidRaw = run('/usr/bin/id', ['-g', account])
  const groupIdsRaw = run('/usr/bin/id', ['-G', account])
  const groupNamesRaw = run('/usr/bin/id', ['-Gn', account])
  if (uidRaw === null || gidRaw === null || groupIdsRaw === null || groupNamesRaw === null) return null
  const uid = parseUnsignedInteger(uidRaw)
  const gid = parseUnsignedInteger(gidRaw)
  const groupIds = splitWords(groupIdsRaw).map(parseUnsignedInteger)
  const groupNames = splitWords(groupNamesRaw)
  if (uid === null || gid === null || groupIds.some(value => value === null) || groupIds.length !== groupNames.length) return null
  return {
    account,
    uid,
    gid,
    groups: groupNames.map((name, index) => ({ name, gid: groupIds[index] })),
  }
}

function groupIdFromPeer(peer, groupName) {
  if (peer === null) return null
  return peer.groups.find(group => group.name === groupName)?.gid ?? null
}

function observeJob(platform, principal, label, humanUid) {
  let pidRaw = null
  if (platform === 'darwin') {
    const domain = principal === 'human-session' ? `gui/${humanUid}` : 'system'
    const output = run('/bin/launchctl', ['print', `${domain}/${label}`])
    pidRaw = output?.match(/\bpid\s*=\s*(\d+)\b/)?.[1] ?? null
  }
  else if (platform === 'linux') {
    const systemctl = ['/bin/systemctl', '/usr/bin/systemctl'].find(existsSync)
    if (systemctl) {
      const args = principal === 'human-session'
        ? ['--user', 'show', '--property=MainPID', '--value', label]
        : ['show', '--property=MainPID', '--value', label]
      pidRaw = run(systemctl, args, principal === 'human-session' ? linuxUserBusEnvironment() : {})
    }
  }
  const pid = pidRaw === null ? null : parseUnsignedInteger(pidRaw)
  if (pid === null || pid === 0) return null
  const uid = parseUnsignedInteger(run('/bin/ps', ['-o', 'uid=', '-p', String(pid)]))
  if (uid === null) return null
  return { label, pid, uid }
}

function observePath(path) {
  try {
    const stats = lstatSync(path)
    return {
      path,
      type: stats.isSymbolicLink()
        ? 'symlink'
        : stats.isDirectory()
          ? 'directory'
          : stats.isFile()
            ? 'file'
            : stats.isSocket()
              ? 'socket'
              : 'other',
      uid: stats.uid,
      gid: stats.gid,
      mode: stats.mode & 0o7777,
    }
  }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
    return { path, type: 'unobservable', uid: null, gid: null, mode: null }
  }
}

function evaluatePath(observation, expected, addRefusal) {
  if (observation === null) {
    addRefusal('supervisor:path-absent', expected.subject, 'required object does not exist; absence is not evidence of denial')
    return
  }
  if (observation.type === 'symlink') {
    addRefusal('supervisor:path-symlink', expected.subject, 'required object is a symbolic link')
    return
  }
  if (observation.type === 'unobservable') {
    addRefusal('supervisor:path-unobservable', expected.subject, 'required object could not be inspected')
    return
  }
  if (observation.type !== expected.expectedType) {
    addRefusal('supervisor:path-type-mismatch', expected.subject, `live type is ${observation.type}; required type is ${expected.expectedType}`)
  }
  if (expected.expectedUid !== null && observation.uid !== expected.expectedUid) {
    addRefusal('supervisor:path-owner-mismatch', expected.subject, `live uid is ${observation.uid}; required uid is ${expected.expectedUid}`)
  }
  if (expected.expectedGid !== null && observation.gid !== expected.expectedGid) {
    addRefusal('supervisor:path-group-mismatch', expected.subject, `live gid is ${observation.gid}; required gid is ${expected.expectedGid}`)
  }
  if (observation.mode !== expected.expectedMode) {
    addRefusal('supervisor:path-mode-mismatch', expected.subject, `live mode is ${formatMode(observation.mode)}; required mode is ${formatMode(expected.expectedMode)}`)
  }
}

function evaluateAncestorCustody(targetPath, targetObservation, guest, subject, addRefusal) {
  let childPath = targetPath
  let childObservation = targetObservation
  let ancestorPath = posix.dirname(targetPath)
  while (true) {
    const ancestor = observePath(ancestorPath)
    if (ancestor === null) {
      addRefusal('supervisor:ancestor-absent', subject, `ancestor ${ancestorPath} disappeared during observation`)
      return
    }
    if (ancestor.type === 'symlink') {
      addRefusal('supervisor:ancestor-symlink', subject, `ancestor ${ancestorPath} is a symbolic link`)
    }
    else if (ancestor.type === 'unobservable') {
      addRefusal('supervisor:ancestor-unobservable', subject, `ancestor ${ancestorPath} could not be inspected`)
      return
    }
    else if (ancestor.type !== 'directory') {
      addRefusal('supervisor:ancestor-not-directory', subject, `ancestor ${ancestorPath} has live type ${ancestor.type}`)
      return
    }
    else if (guest !== null && guestCanReplaceChild(guest, ancestor, childObservation)) {
      addRefusal(
        'supervisor:ancestor-posix-replaceable-by-guest',
        subject,
        `guest uid ${guest.uid} can replace ${childPath} through ancestor ${ancestorPath} under live POSIX mode ${formatMode(ancestor.mode)}`,
      )
    }

    if (ancestorPath === '/') return
    childPath = ancestorPath
    childObservation = ancestor
    ancestorPath = posix.dirname(ancestorPath)
  }
}

function guestCanReplaceChild(guest, directory, child) {
  if (guest.uid === 0) return true
  // A directory owner can chmod its own directory before replacing a child;
  // current write bits therefore cannot make a guest-owned ancestor safe.
  if (directory.uid === guest.uid) return true
  const mode = directory.mode
  if (mode === null) return true
  const groupMember = directory.gid !== null
    && (guest.gid === directory.gid || guest.groups.some(group => group.gid === directory.gid))
  const permissionBits = groupMember ? (mode >> 3) & 0o7 : mode & 0o7
  const canWriteAndTraverse = (permissionBits & 0o3) === 0o3
  if (!canWriteAndTraverse) return false
  const sticky = (mode & 0o1000) !== 0
  if (!sticky) return true
  return child.uid === guest.uid
}

function linuxUserBusEnvironment() {
  const environment = {}
  for (const name of ['XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) {
    const value = process.env[name]
    if (value !== undefined) environment[name] = value
  }
  return environment
}

function splitWords(value) {
  return value === '' ? [] : value.split(/\s+/)
}

function parseUnsignedInteger(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null
  const parsed = Number(value.trim())
  return Number.isSafeInteger(parsed) ? parsed : null
}

function formatMode(mode) {
  return mode === null ? 'unobservable' : mode.toString(8).padStart(4, '0')
}
