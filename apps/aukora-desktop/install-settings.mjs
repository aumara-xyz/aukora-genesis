// The per-install settings file: the values a release cannot know, written ONCE by the first Aumlok link.
//
// WHAT IT IS. `kira-deployment-overlay.patch.yml` in the app's support root (the directory that holds
// `config.json` and `state/`). It names whose memory this is (`subject`), which key approves
// (`approverDid`), which control head the deployment serves (`activeControlDigest`), and where the
// Aumlok key folder is (`aukora-aumlok` `directory`). The release's own composition carries only a
// placeholder subject, so Kira stays off until this file exists; `resolve.mjs` applies it after the
// release's composition on the next start, and Kira mounts without anybody editing a file.
//
// WHERE THE VALUES COME FROM. The public projection of the record the ceremony just wrote, read with the
// machine key this laptop kept (`readBindingState` in aumlok-bridge.mjs): the same subject, approval key
// and control head `scripts/aumlok/bind-overlay.mjs` and `plugins/aukora-kira/bin/kira-pin-control.mjs`
// stage for the owner's deployment. Nothing here derives a key or reads a private half.
//
// WRITTEN ONCE, NEVER REWRITTEN. The file is created with an exclusive open, so an existing one (the
// owner's, which is promoted through `.next` files by those two commands) is never touched by the app.
//
// This module imports only node builtins, like the rest of the shell.
import { chmodSync, closeSync, existsSync, fchmodSync, lstatSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** The file's name in the support root; the owner's scripts read the same name. */
export const INSTALL_SETTINGS_NAME = 'kira-deployment-overlay.patch.yml'
export const AUMLOK_DIRECTORY_PATCH_NAME = 'aumlok-directory.patch.yml'

/** Refusals this module produces by name. */
export const INSTALL_SETTINGS_REFUSE = Object.freeze({
  EXISTS: 'aukora-install:settings-exist',
  NOT_BOUND: 'aukora-install:controller-not-bound',
  VALUE_MALFORMED: 'aukora-install:value-malformed',
  PATH_REFUSED: 'aukora-install:path-refused',
})

/** The Aumlok key folder a fresh install uses when no patch names one: `<state root>/aumlok`. */
export function defaultAumlokDirectory(stateRoot) {
  return join(stateRoot, 'aumlok')
}

/** The Kira store the release's composition names (`dshHomePath('kira-memory')`, DSH_HOME = `<state root>/home`). */
export function kiraStateDirectory(stateRoot) {
  return join(stateRoot, 'home', 'kira-memory')
}

/** Name the shell's key folder for the backend before the first binding exists. */
export function aumlokDirectoryPatchText(directory) {
  if (typeof directory !== 'string' || !directory.startsWith('/')
    || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(directory)) {
    const error = new Error(`${INSTALL_SETTINGS_REFUSE.VALUE_MALFORMED}: the key folder is not a single-line absolute path`)
    error.code = INSTALL_SETTINGS_REFUSE.VALUE_MALFORMED
    throw error
  }
  return ['# AUKORA first-run key folder; contains no key or phrase.',
    '- id: aukora-aumlok', '  config:', `    directory: ${scalar(directory)}`, ''].join('\n')
}

/** Create the fresh-install overlay. Explicit deployment patches are never passed here. */
export function writeAumlokDirectoryPatch({ supportRoot, stateRoot }) {
  const directory = defaultAumlokDirectory(resolve(stateRoot))
  const path = join(supportRoot, AUMLOK_DIRECTORY_PATCH_NAME)
  const refused = reason => ({ written: false, path, directory, reason })
  const kind = at => {
    try { return lstatSync(at) } catch (error) { if (error?.code === 'ENOENT') return null; throw error }
  }
  try {
    const text = aumlokDirectoryPatchText(directory)
    const folder = kind(directory)
    if (folder === null) {
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      chmodSync(directory, 0o700)
    } else if (!folder.isDirectory()) {
      return refused(`${INSTALL_SETTINGS_REFUSE.PATH_REFUSED}:key-folder`)
    }
    const existing = kind(path)
    if (existing !== null) {
      if (!existing.isFile() || existing.nlink !== 1) return refused(`${INSTALL_SETTINGS_REFUSE.PATH_REFUSED}:patch`)
      if ((existing.mode & 0o777) === 0o600 && readFileSync(path, 'utf8') === text) return { written: true, path, directory }
      return refused(`${INSTALL_SETTINGS_REFUSE.PATH_REFUSED}:patch-conflict`)
    }
    mkdirSync(supportRoot, { recursive: true, mode: 0o700 })
    const descriptor = openSync(path, 'wx', 0o600)
    try {
      fchmodSync(descriptor, 0o600)
      const bytes = Buffer.from(text)
      for (let done = 0; done < bytes.length;) done += writeSync(descriptor, bytes, done, bytes.length - done)
    } finally {
      closeSync(descriptor)
    }
    return { written: true, path, directory }
  } catch (error) {
    return refused(error?.code === INSTALL_SETTINGS_REFUSE.VALUE_MALFORMED
      ? error.code : `${INSTALL_SETTINGS_REFUSE.PATH_REFUSED}:${String(error?.code ?? 'error')}`)
  }
}

/**
 * One YAML scalar. A plain absolute path stays plain, because the owner's scripts read these values with a
 * line regex and a quoted path would reach them with its quotes. Other paths use YAML single quotes;
 * the shell's reader decodes doubled apostrophes without interpreting backslash escapes.
 */
function scalar(value) {
  const plain = /^[/A-Za-z0-9][^\n\r"'#]*$/u.test(value) && !value.includes(': ') && !/\s$/u.test(value)
  return plain ? value : `'${value.replaceAll("'", "''")}'`
}

/**
 * The file's text for one binding.
 * @param {{subject: string, approverDid: string, activeControlDigest: string, directory: string, stateRoot: string}} input
 * @returns {string} the patch overlay.
 */
export function installSettingsText({ subject, approverDid, activeControlDigest, directory, stateRoot }) {
  const refuse = (what) => {
    const error = new Error(`${INSTALL_SETTINGS_REFUSE.VALUE_MALFORMED}: ${what}`)
    error.code = INSTALL_SETTINGS_REFUSE.VALUE_MALFORMED
    throw error
  }
  if (typeof subject !== 'string' || !/^aukora:1:[0-9a-f]{64}$/u.test(subject)) refuse('subject is not aukora:1:<64 hex>')
  if (typeof approverDid !== 'string' || !/^did:key:z[1-9A-HJ-NP-Za-km-z]+$/u.test(approverDid)) refuse('approverDid is not a did:key')
  if (typeof activeControlDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(activeControlDigest)) refuse('activeControlDigest is not 64 hex')
  if (typeof directory !== 'string' || !directory.startsWith('/')) refuse('the key folder is not an absolute path')
  if (typeof stateRoot !== 'string' || !stateRoot.startsWith('/')) refuse('the state root is not an absolute path')
  const store = kiraStateDirectory(stateRoot)
  return [
    '# Written by the AUKORA desktop app when this install first linked its Aumlok phrase',
    '# (apps/aukora-desktop/install-settings.mjs). The per-install values a release cannot know: whose',
    '# memory this is, which key approves, which control head it serves, and where the Aumlok key folder is.',
    '# Written once; the app never rewrites it. Applied after the release\'s aukora-composition.patch.yml.',
    '# Each row assigns its whole `config`, so every memoryOwner field is restated here.',
    '- id: aukora-kira',
    '  config:',
    '    retrieval: lexical',
    '    memoryOwner:',
    `      stateDir: ${scalar(store)}`,
    `      subject: ${subject}`,
    '      permittedPrivacy: [local]',
    `      grantFile: ${scalar(join(store, 'grant.json'))}`,
    `      approvalFile: ${scalar(join(store, 'grant.json'))}`,
    `      approverDid: ${approverDid}`,
    `      activeControlDigest: ${activeControlDigest}`,
    `      queueDir: ${scalar(join(store, 'queue'))}`,
    '- id: aukora-aumlok',
    '  config:',
    `    directory: ${scalar(directory)}`,
    '',
  ].join('\n')
}

/**
 * Write the per-install settings for a binding that just succeeded, unless the file already exists.
 * @param {{supportRoot: string, stateRoot: string, directory: string, state: {bound?: boolean, control?: Record<string, unknown>, reason?: string}}} input
 *   `state` is `readBindingState(library, directory)` for the directory the ceremony wrote.
 * @returns {{written: boolean, path: string, reason?: string}} what happened, by name.
 */
export function writeInstallSettingsOnFirstLink({ supportRoot, stateRoot, directory, state }) {
  const path = join(supportRoot, INSTALL_SETTINGS_NAME)
  if (existsSync(path)) return { written: false, path, reason: INSTALL_SETTINGS_REFUSE.EXISTS }
  if (state?.bound !== true || state.control === undefined) {
    return { written: false, path, reason: `${INSTALL_SETTINGS_REFUSE.NOT_BOUND}:${String(state?.reason ?? 'unknown')}` }
  }
  const text = installSettingsText({
    subject: state.control.subject,
    approverDid: state.control.approvalKeyDid,
    activeControlDigest: state.control.activeControlDigest,
    directory,
    stateRoot,
  })
  mkdirSync(supportRoot, { recursive: true, mode: 0o700 })
  // EXCLUSIVE: `wx` fails EEXIST rather than replacing, so a file that appeared since the check above wins.
  let descriptor
  try {
    descriptor = openSync(path, 'wx', 0o600)
  } catch (error) {
    if (error?.code === 'EEXIST') return { written: false, path, reason: INSTALL_SETTINGS_REFUSE.EXISTS }
    throw error
  }
  try {
    writeSync(descriptor, text)
  } finally {
    closeSync(descriptor)
  }
  return { written: true, path }
}
