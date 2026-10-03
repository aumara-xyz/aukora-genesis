// Deciding what this window shows: a backend it starts, or one that is already serving.
//
// TWO MODES, AND THE DIFFERENCE IS OWNERSHIP. In `own` mode the shell starts a harness
// process against a state root and is responsible for stopping it. In `attach` mode it
// starts nothing, stops nothing, and renders a backend somebody else is running. The
// modes are resolved here so that main.mjs cannot accidentally do half of each, and so
// that a shell told to attach NEVER falls back to starting something — a fallback would
// put a second writer on somebody else's data and call it a recovery.
//
// WHY THE SHELL NEEDS A CHECKOUT AT ALL. `scripts/launch-dsh.py` verifies the
// release's artifact record against the tracked bytes of the checkout it runs
// from, so a checkout at any other commit fails the check. Rather than ask a
// person to keep two paths in their head, the shell reads the commit the release
// records about itself and prepares a private checkout pinned to exactly that.
//
// Everything here is a default that config or the environment overrides, and
// none of it touches a deployment, a release or the user's own working tree.
import { readFile, readdir, writeFile, mkdir, stat, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { setOperationContent } from '../../plugins/aukora-aumlok/lib/plugin-set-content.mjs'
import { loopbackOnly } from './url-policy.mjs'
import { INSTALL_SETTINGS_NAME, writeAumlokDirectoryPatch } from './install-settings.mjs'

const run = promisify(execFile)
const RELEASE_PREFIX = 'aukora-release-'
const RECORD = '.dsh-build/genesis-artifacts.json'

export const CONFIG_TEMPLATE = {
  $comment: [
    'AUKORA desktop shell. Delete a key to go back to the default.',
    'release: a materialized release directory. Default: the newest aukora-release-* in searchRoots.',
    'repo: a Genesis clone the shell may read to prepare a pinned checkout of the release commit. Default: the checkout this app was installed from, when it is one. Override: AUKORA_DESKTOP_REPO.',
    'checkout: use this checkout instead of preparing one. It must sit at the release commit.',
    'attachUrl: SHOW A BACKEND THAT IS ALREADY SERVING. Either a bare origin, "http://127.0.0.1:3187", or the launcher\'s full URL with its token. The shell starts nothing and stops nothing; quitting leaves that backend running. A TOKEN IS USED ONCE: it authenticates the first load, the backend answers with a durable cookie, and this file is rewritten to the bare origin so a dead token is never kept as though it were a connection. The cookie is keyed to host:port and survives a backend RESTART on the same port, which is what makes a saved attach target keep working. The frontend is served BY the backend: attaching shows whatever interface that deployment serves, not this app\'s.',
    'stateRoot: STARTS AN OWNED BACKEND against this state directory instead of the shell\'s private one. It does NOT attach to anything: a harness process is spawned here exactly as it would be by default. Pointing it at a deployment that is already running makes a second writer against one set of storages, which is corruption and not sharing — the shell refuses when it finds a live process recorded there. The directory must be private (mode 0700); the shell refuses a wider one rather than narrowing it. To SHOW a running deployment, use attachUrl.',
    'nodePath: a node binary to use. Default: the first of ~/.local/bin/node, /opt/homebrew/bin/node, /usr/local/bin/node, /usr/bin/node that exists.',
    'patch: extra composition patch overlays. Default: the release\'s own aukora-composition.patch.yml, which is what mounts the organs and the spatial frame, followed by kira-deployment-overlay.patch.yml from this folder once the first Aumlok link has written it.',
    'approvedRecordSha: approved artifact record digests. A matching installed plugin-set approval also admits the release record; the gate still verifies its signature.',
    'allowUnapproved: false by default. With no configured record approvals, no installed plugin-set approval and no approver pin from an earlier one, the first-run launch temporarily waives approval so you can link your Aumlok phrase and approve the plugin set. Nothing saves that waiver. An install that was approved before and lost its approval is refused instead. true explicitly waives the plugin set on every launch: for a disposable preview, or for one launch to re-approve.',
  ],
  release: null,
  repo: null,
  checkout: null,
  attachUrl: null,
  stateRoot: null,
  nodePath: null,
  patch: [],
  approvedRecordSha: [],
  // First-run permission is resolved from absent approval evidence and an absent approver pin, never saved here.
  allowUnapproved: false,
  searchRoots: [homedir()],
}

async function isDir(path) {
  try { return (await stat(path)).isDirectory() } catch { return false }
}

async function isFile(path) {
  try { return (await stat(path)).isFile() } catch { return false }
}

// Shape matching here grants no signature trust; the gate checks the pinned key and bytes.
function pluginSetOperationDigest(record) {
  return createHash('sha256').update('aukora:operation-content:v1\0', 'utf8')
    .update(setOperationContent(record), 'utf8').digest('hex')
}

async function installedPluginSet(release, stateRoot) {
  const path = join(stateRoot, 'gate-state', 'plugin-set-approval.json')
  try {
    // A malformed file, directory or dangling symlink is existing evidence, never first run.
    const info = await lstat(path)
    if (!info.isFile()) return { status: 'invalid', path }
  } catch (error) {
    return { status: error.code === 'ENOENT' ? 'absent' : 'invalid', path }
  }
  try {
    const receipt = JSON.parse(await readFile(path, 'utf8'))
    const record = JSON.parse(await readFile(join(release, '.dsh-build/plugin-set.json'), 'utf8'))
    // The verifier's required receipt fields: reject truncated evidence here without verifying a key.
    const fields = ['domain', 'verdict', 'approvalKeyDid', 'subject', 'activeControlDigest', 'operationDigest',
      'challenge', 'issuedAt', 'expiresAt', 'signature', 'signedBytesDigest', 'approvalClass', 'keyClass']
    if (receipt?.domain !== 'aukora:approval-receipt:v1' || receipt.verdict !== 'OWNER_KEY_SIGNED'
      || fields.some(field => !Object.hasOwn(receipt, field))
      || typeof receipt.signature !== 'string' || !/^[0-9a-f]{128}$/u.test(receipt.signature)
      || typeof receipt.operationDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(receipt.operationDigest)) {
      return { status: 'invalid', path }
    }
    return { status: receipt.operationDigest === pluginSetOperationDigest(record) ? 'matching' : 'changed',
      path, setDigest: record.setDigest }
  } catch {
    return { status: 'invalid', path }
  }
}

// THE FIRST-RUN WAIVER IS FOR AN INSTALL NEVER APPROVED, NOT ONE THAT LOST ITS APPROVAL. `scripts/aukora/plugin-set.mjs`
// writes the approver pin only when it installs an owner's plugin-set approval, beside it; no AUKORA script removes either.
// A pin with no approval means an approval existed and is gone: a waiver would load any plugin bytes with no owner
// decision. An Aumlok-bound install never plugin-set approved (settings and controller, no pin) keeps the waiver: its
// first approval is raised through this app's own signer, so refusing it would leave nothing able to start or approve.
// Existence only: the pin is not parsed and no key is touched. NOT ENFORCED: these are same-uid files, so deleting the
// approval AND the pin brings the waiver back.
async function assertNeverApproved(stateRoot, configPath) {
  const pin = join(stateRoot, 'gate-state', 'plugin-set-approver.json')
  try { await lstat(pin) } catch (error) {
    if (error.code === 'ENOENT') return
    throw new Error(`approver-pin-unreadable: ${pin} (${error.code}); this install cannot be shown never-approved, so `
      + 'the first-run waiver is refused')
  }
  // A malformed pin, a directory or a dangling symlink is still an earlier approval's trace, never first run.
  throw new Error(`existing-install-approval-missing: ${pin} records an earlier owner approval of this install's `
    + `plugins, and ${join(stateRoot, 'gate-state', 'plugin-set-approval.json')} is gone, so the first-run waiver is `
    + 'refused. To recover: put the approval back from a backup under state/home/become/backup-*, or set '
    + `"allowUnapproved": true in ${configPath} for one launch, approve the plugin set `
    + '(node scripts/aukora/plugin-set.mjs approve --release <release>), then set it back to false.')
}

/**
 * THE CHECKOUT THIS APP IS RUNNING FROM, FOUND BY WHAT MAKES A CHECKOUT ONE RATHER THAN BY ITS NAME.
 *
 * MEASURED (open-source readiness, report 3.2 item 6): this module fell back to `~/aukora-genesis`, so a friend's
 * clone — which lives wherever they put it — was never found, and the failure named a directory they do not have. The
 * markers here are `upstream-dsh.json` beside `apps/aukora-desktop`, which is what THIS repository is; a directory that
 * merely looks like a clone is not accepted, and a packaged app (whose module path is inside an asar) simply finds
 * nothing, which is why the name is then REQUIRED from the environment or the config instead of guessed.
 *
 * Exported because a claim about resolution that no court can call is a claim, not a check.
 */
export async function selfLocatedRepo(startDir, limit = 8) {
  let dir = startDir
  for (let i = 0; i < limit; i += 1) {
    if ((await isFile(join(dir, 'upstream-dsh.json'))) && (await isDir(join(dir, 'apps', 'aukora-desktop')))) return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

/** The newest directory that looks like a materialized release and carries a record. */
export async function findRelease(searchRoots) {
  const found = []
  for (const root of searchRoots) {
    let names = []
    try { names = await readdir(root) } catch { continue }
    for (const name of names) {
      if (!name.startsWith(RELEASE_PREFIX)) continue
      const dir = join(root, name)
      if (!(await isDir(dir))) continue
      try {
        const info = await stat(join(dir, RECORD))
        found.push({ dir, mtime: info.mtimeMs })
      } catch { /* a directory without a record is not a release */ }
    }
  }
  if (found.length === 0) return null
  found.sort((a, b) => b.mtime - a.mtime)
  return found[0].dir
}

/** The Genesis commit a release records about itself. */
export async function releaseCommit(release) {
  // A RELEASE THAT IS NOT THERE IS A NAMED REFUSAL, NOT A STACK TRACE. A configured
  // release can be deleted by anything — a disk sweep, a rename, a colleague. When that
  // happened the shell put `ENOENT: no such file or directory, open
  // '…/.dsh-build/genesis-artifacts.json'` in a dialog, which tells the owner nothing
  // about which setting is wrong, where that setting lives, or what to do. The whole
  // point of naming refusals is to answer those three questions in the message.
  let text
  try {
    text = await readFile(join(release, RECORD), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const missingDir = !(await isDir(release))
      throw new Error(
        `release-gone: ${release} ` +
        (missingDir
          ? 'does not exist. '
          : 'exists but carries no build record, so it was not materialized by ' +
            'scripts/materialize-aukora-release.py. ') +
        'The shell was told to run this release and cannot. Point `release` at one that ' +
        'exists, or delete that key to fall back to the newest release found on this machine.')
    }
    throw error
  }
  const record = JSON.parse(text)
  const commit = record?.producer?.genesisCommit
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`release-records-no-commit: ${join(release, RECORD)}`)
  }
  return commit
}

/**
 * A private checkout pinned to one commit, prepared once and reused.
 * It is detached and never written to, so it can never pick up someone's
 * uncommitted work — the whole point of the verification it feeds.
 */
export async function ensureCheckout({ repo, commit, dir }) {
  const head = async () => (await run('git', ['-C', dir, 'rev-parse', 'HEAD'])).stdout.trim()
  if (await isDir(join(dir, '.git'))) {
    if ((await head()) === commit) return dir
    await run('git', ['-C', dir, 'fetch', '--quiet', 'origin', commit]).catch(() => {})
    await run('git', ['-C', dir, 'checkout', '--quiet', '--detach', commit])
    if ((await head()) !== commit) throw new Error(`checkout-not-at-commit: ${dir}`)
    return dir
  }
  if (!(await isDir(join(repo, '.git')))) throw new Error(`no-repository-to-clone: ${repo}`)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  // --shared keeps this cheap: objects stay in the source clone, which the shell
  // only ever reads. --no-checkout then detach lands exactly on the commit.
  await run('git', ['clone', '--quiet', '--shared', '--no-checkout', repo, dir])
  await run('git', ['-C', dir, 'checkout', '--quiet', '--detach', commit])
  if ((await head()) !== commit) throw new Error(`checkout-not-at-commit: ${dir}`)
  return dir
}

/**
 * Read config, writing the commented template the first time so it can be edited.
 *
 * `file` is the document the OPERATOR'S file actually said, before the template is merged under it.
 * `config` cannot answer that question — a key the file omits is indistinguishable there from a key
 * the template supplies — and the difference decides whether the release door's escape hatch was
 * opened by a person or merely by a default.
 */
export async function loadConfig(userData) {
  const path = join(userData, 'config.json')
  try {
    const file = JSON.parse(await readFile(path, 'utf8'))
    return { path, file, config: { ...CONFIG_TEMPLATE, ...file } }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    await mkdir(userData, { recursive: true, mode: 0o700 })
    await writeFile(path, JSON.stringify(CONFIG_TEMPLATE, null, 2) + '\n', { mode: 0o600 })
    return { path, file: { ...CONFIG_TEMPLATE }, config: { ...CONFIG_TEMPLATE } }
  }
}

/**
 * Decide what to run, from the environment first, then config, then discovery.
 * Returns the resolved target and the reason for each choice, so a failure says
 * which step could not be completed rather than only that something is missing.
 */
export async function resolveTarget({ env, userData, checkoutsDir }) {
  const { path: configPath, file: configFile, config } = await loadConfig(userData)
  const why = []

  // ATTACH IS DECIDED FIRST AND IT SHORT-CIRCUITS. Nothing below this block runs when a
  // backend has been named: no release is discovered, no checkout is prepared, no state
  // root is chosen. That is deliberate. If attach resolution fell through to discovery,
  // a typo'd or stopped backend would quietly become "start your own instead", which is
  // the one outcome an operator pointing at somebody else's deployment must never get.
  // SET-BUT-EMPTY IS A REFUSAL, NOT AN ABSENCE. `??` passes an empty string through
  // while a truthy test drops it, and the gap between those two is a silent fallback:
  // an operator whose `AUKORA_DESKTOP_URL=$SOMETHING_UNSET` expanded to nothing asked
  // to attach and would have been given an owned backend instead. Naming the variable
  // at all is the intent; an empty value is a broken intent, which is refused.
  const attachUrl = env.AUKORA_DESKTOP_URL ?? config.attachUrl ?? null
  if (attachUrl !== null) {
    const fromEnv = env.AUKORA_DESKTOP_URL !== undefined
    const source = fromEnv ? 'AUKORA_DESKTOP_URL' : configPath
    if (typeof attachUrl !== 'string' || attachUrl.trim() === '') {
      throw new Error(`attach-url-empty: ${source} names an attach target with no value. ` +
        'Attach was requested and cannot be honoured; nothing was started in its place.')
    }
    let url
    try {
      url = loopbackOnly(attachUrl)
    } catch (err) {
      // Named but unusable is a refusal, never a downgrade to owning one.
      throw new Error(`attach-url-refused: ${source} names a URL this shell will not load (${
        String(err.message ?? err)}). Attach was requested, so nothing was started.`)
    }
    // A TOKEN IS A BOOTSTRAP, NOT A CONNECTION. Measured on this harness: `GET
    // /?token=<t>` answers 303 and mints an HttpOnly cookie keyed to sha256(host:port),
    // and every later request is authenticated by that cookie alone. The two halves have
    // opposite lifetimes — the token lives in a per-process WeakMap and dies with the
    // backend, while the cookie's signing secret is durable in the state root's
    // credentials. A cookie minted by one backend process was verified to authenticate
    // against the next one on the same port and state root.
    //
    // So the durable thing is the ORIGIN. The token is carried separately, used at most
    // once, and never written back to disk as though it were a connection.
    const parsed = new URL(url)
    const bootstrapToken = parsed.searchParams.get('token')
    const origin = parsed.origin
    why.push(`attached to ${origin} (named by ${source})`)
    why.push('this shell owns no backend: it starts nothing and stops nothing')
    if (bootstrapToken !== null) {
      why.push('a launch token was supplied: it bootstraps a cookie and stays valid until the backend restarts; it is not the connection')
    }
    return {
      mode: 'attach',
      // What the window loads first. The cookie path is tried before the token, because
      // a token that has expired is the ordinary case and a cookie that works is the
      // quiet one.
      url: origin + '/',
      origin,
      bootstrapUrl: bootstrapToken === null ? null : url,
      fromEnvironment: fromEnv,
      configPath,
      why,
    }
  }

  const release = env.AUKORA_DESKTOP_RELEASE ?? config.release ?? await findRelease(config.searchRoots ?? [homedir()])
  if (!release) {
    throw new Error(
      `no-release-found: looked for ${RELEASE_PREFIX}* in ${(config.searchRoots ?? []).join(', ')}. ` +
      `Name one in ${configPath}.`)
  }
  why.push(`release ${release}`)

  // Read once, for two purposes: preparing a pinned checkout, and telling the window
  // which release it is showing. A named checkout skips the first, never the second.
  const commit = await releaseCommit(release)
  let checkout = env.AUKORA_DESKTOP_CHECKOUT ?? config.checkout
  if (!checkout) {
    // **NO DEFAULT MAY NAME ONE PERSON'S HOME.** The order is the environment, then the config, then THIS APP'S OWN
    // LOCATION — and when all three are silent the shell REFUSES BY NAME rather than cloning from a directory that only
    // exists on the machine this was written on.
    const repo = env.AUKORA_DESKTOP_REPO ?? config.repo
      ?? await selfLocatedRepo(dirname(fileURLToPath(import.meta.url)))
    if (repo === null) {
      throw new Error('repo-not-configured: no Genesis checkout was named and none contains this app. Set '
        + 'AUKORA_DESKTOP_REPO, or "repo" in the config file, to the clone the shell may read. The previous default was '
        + "a home directory of the author's; a clone elsewhere does not have it.")
    }
    checkout = await ensureCheckout({ repo, commit, dir: join(checkoutsDir, commit.slice(0, 12)) })
    why.push(`checkout pinned to ${commit.slice(0, 12)} from ${repo}`)
  } else {
    why.push(`checkout ${checkout}`)
  }

  // THE PATCH IS NOT OPTIONAL IN PRACTICE. A release carries its composition as a
  // file the launcher applies only when told to; launched without it the app runs the
  // stock harness composition — no organs, and the stock frame instead of the spatial
  // one. So the release's own patch is the default, and config replaces it.
  let patch = config.patch ?? []
  let needsDirectoryPatch = false
  if (patch.length === 0) {
    const generated = join(release, 'aukora-composition.patch.yml')
    try { await stat(generated); patch = [generated]; why.push('composition patch from the release') }
    catch { why.push('no composition patch in the release: stock composition') }
    // THE PER-INSTALL SETTINGS, AFTER THE RELEASE'S COMPOSITION. The first Aumlok link writes them into this
    // support root (install-settings.mjs): the real Kira subject, approver and control head, and the key
    // folder. Until then Kira stays off and says so; from the next start it mounts. An explicit `patch` list
    // is left exactly as written: whoever wrote it names their own overlays.
    const installSettings = join(userData, INSTALL_SETTINGS_NAME)
    if (patch.length > 0 && await isFile(installSettings)) {
      patch = [...patch, installSettings]
      why.push(`per-install settings ${installSettings}`)
    } else if (patch.length > 0) {
      why.push('no per-install settings yet: Kira stays off until an Aumlok phrase is linked')
      needsDirectoryPatch = true
    }
  }

  // A NAMED STATE ROOT IS STILL AN OWNED BACKEND. It changes which data the process
  // this shell starts will write — not whether it starts one. The supervisor refuses a
  // state root that already has a live process recorded in it, which is what keeps a
  // mistake here from becoming a second writer against somebody else's storages.
  // The same coercion trap, with a worse landing: `path.resolve('')` is the process's
  // current working directory, so an empty state root would silently make the repo
  // checkout into a harness home.
  const namedStateRoot = env.AUKORA_DESKTOP_STATE ?? config.stateRoot ?? null
  if (namedStateRoot !== null && (typeof namedStateRoot !== 'string' || namedStateRoot.trim() === '')) {
    throw new Error('state-root-empty: a state root was named with no value. ' +
      'Refusing rather than resolving it to the current working directory.')
  }
  const stateRoot = namedStateRoot
  why.push(stateRoot === null
    ? 'state root owned by this shell'
    : `state root ${stateRoot} (an owned backend is started against it, not attached)`)

  if (needsDirectoryPatch) {
    const fresh = writeAumlokDirectoryPatch({ supportRoot: userData, stateRoot: stateRoot ?? join(userData, 'state') })
    if (!fresh.written) throw new Error(`${fresh.reason}: cannot configure the first-run Aumlok key folder`)
    patch = [...patch, fresh.path]
    why.push(`Aumlok key folder named for the backend: ${fresh.directory}`)
  }

  // ── EXPLICIT RELEASE PERMISSIONS, BEFORE CHECKING THIS INSTALL'S APPROVAL ─────────────────────
  // `approvedRecordSha` is the set of release artifact records an operator approved, and the launcher
  // refuses any release whose record sha is not in it. `allowUnapproved` is the escape hatch for a
  // disposable preview, and it has to keep working — a door with no way out is a lock-out.
  //
  // WHAT WAS WRONG HERE. The hatch was `config.allowUnapproved !== false`, which is not a boolean
  // test: a missing key, a misspelled key, `"allowUnapproved": "false"` (a string — an easy JSON
  // mistake), `0` or `null` all resolved to `true`, and `true` here means the launcher is handed
  // `--allow-unapproved` and adopts any release with no operator decision at all. A value that is
  // merely not `false` is not permission. Explicit preview permission is the boolean `true`.
  //
  // The escape hatch is unchanged for the value that actually is one: `true` still permits.
  let allowUnapproved = config.allowUnapproved === true
  if (config.allowUnapproved !== undefined && typeof config.allowUnapproved !== 'boolean') {
    why.push(`allowUnapproved is ${JSON.stringify(config.allowUnapproved)} — not a boolean, so it is `
      + 'NOT explicit preview permission: only the boolean true enables the configured waiver')
  }
  // WHERE THE PERMISSION CAME FROM, SAID OUT LOUD. A config file that omits the key falls back to the
  // shipped template. It shipped `true` until 2026-09-27 — so a typo (`allowUnapprove`, `"allowUnapproved "`)
  // opened the hatch and looked exactly like an untouched config. It ships `false` now; this line still fires
  // if a template ever ships `true` again. The launch still happens (the template is a
  // delivered default, and deleting a key is documented as returning to it), but the shell now says
  // that the permission was NOT this file's, so the state is visible in the diagnostics rather than
  // inferred from a file a reader has to diff against a template they cannot see.
  if (allowUnapproved && configFile?.allowUnapproved !== true) {
    why.push(`allowUnapproved is true because of the SHIPPED TEMPLATE, not because ${configPath} says `
      + 'so: the release door\'s escape hatch is open. Set "allowUnapproved": false there to close it '
      + '(and list the approved record shas in approvedRecordSha).')
  }

  // Every entry must be a record sha. The launcher takes `--approved-record-sha` once per entry, and
  // a STRING here is iterated CHARACTER BY CHARACTER downstream — 64 single-character digests that
  // no release matches. That fails closed at the launcher, but it fails as `unapproved-release` and
  // hides the operator's actual mistake. Named here instead.
  let approvedRecordSha = config.approvedRecordSha ?? []
  if (!Array.isArray(approvedRecordSha)
    || approvedRecordSha.some(sha => typeof sha !== 'string' || !/^[0-9a-f]{64}$/u.test(sha))) {
    throw new Error('approved-record-sha-malformed: ' + configPath + ' names approved artifact record '
      + 'digests, and every entry must be a 64-character lowercase hex sha256 of a release\'s '
      + '.dsh-build/genesis-artifacts.json. A string is not a list, and a digest that is not 64 hex '
      + 'characters matches no release. Refusing rather than launching with an approval list nothing '
      + 'can satisfy.')
  }
  approvedRecordSha = [...approvedRecordSha]

  // Preserve explicit preview permission and every configured digest; a matching installed approval
  // contributes the release's digest. Only an install never approved gets the temporary waiver.
  if (!allowUnapproved) {
    const installStateRoot = resolve(stateRoot ?? join(userData, 'state'))
    const approval = await installedPluginSet(release, installStateRoot)
    if (approval.status === 'absent' && approvedRecordSha.length === 0) {
      await assertNeverApproved(installStateRoot, configPath)
      allowUnapproved = true
      why.push('FIRST RUN: no owner has approved this install yet; link your Aumlok phrase, then approve the plugin set (the app asks) — from then on every launch requires it')
    } else if (approval.status === 'matching') {
      // Match launch-dsh.py: sha256(record_file.read_bytes()), including formatting and final newline.
      const sha = createHash('sha256').update(await readFile(join(release, RECORD))).digest('hex')
      if (!approvedRecordSha.includes(sha)) approvedRecordSha.push(sha)
      why.push(`APPROVED BY THE OWNER: installed approval ${approval.path} matches plugin set ${approval.setDigest}; the gate must still verify the signature`)
    } else if (approval.status === 'changed') {
      why.push(`plugin set changed: installed approval ${approval.path} does not match this release and must be re-approved; launch remains strict`)
    } else if (approval.status === 'invalid') {
      why.push(`installed plugin-set approval ${approval.path} or release plugin-set record is unreadable or malformed; launch remains strict`)
    }
  }
  if (approvedRecordSha.length === 0 && !allowUnapproved) {
    why.push('NO approved release record and no escape hatch: the launcher will refuse every release '
      + 'with `unapproved-release`. Add the release\'s record sha (`scripts/aukora/desktop-cutover.mjs '
      + 'apply` appends it) or set allowUnapproved true for a disposable preview.')
  }

  return {
    mode: 'own', release, checkout, configPath, why, patch, stateRoot, releaseCommit: commit,
    nodePath: config.nodePath ?? null,
    approvedRecordSha,
    allowUnapproved,
  }
}
