/**
 * The door's token, on disk, owner-only — and the refusals that keep it that way.
 *
 * WHY A FILE EXISTS AT ALL, AND WHAT IT DOES NOT CHANGE. The shell mints one token per launch and hands
 * it to the backend child in that child's environment. That is the right place for the *backend* to get
 * it, and it is why no lane can run the live check: a lane's environment is not the backend's. So the door
 * ALSO writes the token here, inside the app's own state root, and the check reads it as its owner.
 *
 *   <state root>/eye/door.token     0600, owner only, rewritten each launch, removed on dispose
 *
 * The door's serving behaviour does not move: same token, same `Authorization: Bearer` header, same Host
 * and Origin fences, same routes, same refusals. Nothing about the wire changes. What is new is a secret
 * at rest, which is why every rule below refuses instead of warning — a token file that is
 * group-readable, owned by somebody else, a symlink, or empty is not a slightly worse token file, it is a
 * different way for the secret to have escaped.
 */
import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** A refusal about the token file itself. Carries a code and never the token. */
export class EyeTokenRefusal extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'EyeTokenRefusal'
    this.code = code
  }
}

/**
 * Where the door writes its token when nothing else is configured.
 * @param options - `{stateRoot}` overrides the root, for a court or a second deployment.
 * @returns the absolute path.
 */
export function defaultTokenPath({ stateRoot } = {}) {
  const root = stateRoot ?? process.env.AUKORA_STATE_ROOT
    ?? join(homedir(), 'Library', 'Application Support', 'AUKORA', 'state')
  return join(root, 'eye', 'door.token')
}

/**
 * Write the token, owner-only and atomically.
 *
 * ATOMIC because a reader must never see half a token: the bytes go to a temporary file in the same
 * directory and are renamed over the destination, which is a single filesystem operation. The temporary
 * file is created 0600 as well — a mode applied after writing would leave a window in which the secret is
 * world-readable.
 * @param path - where the token goes.
 * @param token - the token.
 * @returns the path written.
 */
export function writeEyeToken(path, token) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const handle = `${path}.${process.pid}.tmp`
  writeFileSync(handle, `${token}\n`, { mode: 0o600 })
  renameSync(handle, path)
  return path
}

/**
 * Remove the token file. Idempotent, because `dispose()` may run twice and a missing file is the goal.
 * @param path - the token path.
 */
export function removeEyeToken(path) {
  try {
    unlinkSync(path)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

/**
 * Read a token file, refusing every way it can be wrong.
 *
 * ORDER MATTERS: the file's identity is established (regular, not a symlink, owned by us) before its
 * permissions are trusted, and its permissions are established before a single byte of the secret is read.
 *
 * THE REFUSAL PREFIX IS A PARAMETER because this reader now serves two doors — the eye's token and the
 * lane door's — and a lane told `eye.token-file-mode` would be reading a diagnosis of somebody else's
 * file. The checks are identical; only the name of the thing being refused differs.
 * @param options - `{path, uid, prefix}`; `uid` defaults to this process's, and is a parameter so a court
 *   can exercise the owner refusal without being another user.
 * @returns the token, trimmed of the trailing newline. Never logged by this module.
 */
export function readTokenFile({ path, uid = process.getuid?.() ?? null, prefix = 'eye' } = {}) {
  if (typeof path !== 'string' || path === '') throw new EyeTokenRefusal('eye.token-file-absent', 'no token path was given')
  const code = name => `${prefix}.${name}`
  let stats
  try {
    stats = lstatSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new EyeTokenRefusal(code('token-file-absent'),
        `no token file at ${path}; the app writes it when it opens the eye door, so this usually means no door is running`)
    }
    throw new EyeTokenRefusal(code('token-file-unreadable'), `${path} could not be examined: ${error?.message ?? error}`)
  }
  if (stats.isSymbolicLink()) {
    throw new EyeTokenRefusal(code('token-file-symlink'),
      `${path} is a symlink; the token is read from the file the app wrote, never through a link that could point elsewhere`)
  }
  if (!stats.isFile()) {
    throw new EyeTokenRefusal(code('token-file-not-regular'), `${path} is not a regular file`)
  }
  if (uid !== null && stats.uid !== uid) {
    throw new EyeTokenRefusal(code('token-file-owner'),
      `${path} is owned by uid ${stats.uid} but this process is uid ${uid}; a token file belongs to its reader or to nobody`)
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new EyeTokenRefusal(code('token-file-mode'),
      `${path} is mode ${(stats.mode & 0o777).toString(8)}, so group or other can read it; a token file must be 600`)
  }
  const token = readFileSync(path, 'utf8').trim()
  if (token === '') {
    throw new EyeTokenRefusal(code('token-file-empty'), `${path} is empty, so there is no token in it`)
  }
  return token
}

/**
 * The eye's token, from the eye's default path.
 *
 * The eye's own door and the live check call this by name; the lane door's client calls `readTokenFile`
 * with its own path and prefix. One reader, two doors, and no second copy of the symlink, owner and mode
 * checks — which is the kind of thing that drifts when it is copied.
 * @param options - `{path, uid}`.
 * @returns the eye door's token.
 */
export function readEyeToken({ path = defaultTokenPath(), uid = process.getuid?.() ?? null } = {}) {
  return readTokenFile({ path, uid, prefix: 'eye' })
}
