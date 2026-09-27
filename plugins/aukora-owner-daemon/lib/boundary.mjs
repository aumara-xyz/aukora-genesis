/**
 * THE STARTUP BOUNDARY — WHAT THIS DAEMON WILL AND WILL NOT START INSIDE.
 *
 * **CODEX P1 #3.** The checks that existed rejected a world-writable ancestor and demanded `0700` on the owner
 * directory, which is most of the idea and none of the edges. What was missing, each measured:
 *
 *   · the run directory allowed GROUP WRITE by any group, and a group the owner is not the only member of is
 *     a second principal who can replace `submit.sock`;
 *   · ancestors were judged by uid and world-write ONLY — **an ACL is not a mode bit**, and `ls -ld` does not
 *     show one, so a directory that looks closed can grant another principal write;
 *   · `keyFile` was used without validating its PARENT or that it lies under the owner directory at all;
 *   · files were created with a plain `writeFileSync`, which FOLLOWS A SYMLINK — so a planted link at the key
 *     path writes wherever it points, as the owner.
 *
 * **EVERY CHECK HERE IS A REFUSAL BY NAME, AND NONE OF THEM IS A WARNING.** A daemon that starts inside a
 * boundary it does not control has no boundary, and starting anyway would make the sockets it opens look
 * authoritative while the directory around them is somebody else's to rename.
 */
import { closeSync, existsSync, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync, renameSync,
  constants as FS, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { userInfo } from 'node:os'
import { dirname, resolve, sep } from 'node:path'

/** Every way this module refuses. Named, so a caller can tell them apart and a court can assert each. */
export const BOUNDARY_REFUSE = Object.freeze({
  OWNER_DIR_ABSENT: 'aukora-owner:owner-dir-absent',
  OWNER_DIR_INSECURE: 'aukora-owner:owner-dir-insecure',
  RUN_DIR_GROUP_WRITABLE: 'aukora-owner:run-dir-group-writable',
  ANCESTOR_UNTRUSTED_OWNER: 'aukora-owner:ancestor-untrusted-owner',
  ANCESTOR_WRITABLE: 'aukora-owner:ancestor-writable',
  ANCESTOR_ACL_GRANTS_WRITE: 'aukora-owner:ancestor-acl-grants-write',
  ANCESTOR_ACL_GRANTS_READ: 'aukora-owner:ancestor-acl-grants-read',
  KEY_NOT_CONTAINED: 'aukora-owner:key-not-contained',
  KEY_PARENT_UNTRUSTED: 'aukora-owner:key-parent-untrusted',
  KEY_NOT_DIRECT_CHILD: 'aukora-owner:key-not-direct-child',
  KEY_IS_SYMLINK: 'aukora-owner:key-is-a-symlink',
  // **A DIRECTORY AND A FIFO ARE DIFFERENT COMPLAINTS AND GET DIFFERENT NAMES.** Both used to arrive as
  // whatever errno `readFileSync` produced — `EISDIR`, or a hang with no error at all — and **an errno in
  // `.code` looks exactly like a named refusal to anything that only asks whether a code is present.**
  KEY_IS_DIRECTORY: 'aukora-owner:key-is-a-directory',
  KEY_IS_NOT_A_REGULAR_FILE: 'aukora-owner:key-is-not-a-regular-file',
  SHORT_WRITE: 'aukora-owner:short-write',
  FILE_EXISTS: 'aukora-owner:file-exists',
  ACL_UNREADABLE: 'aukora-owner:acl-unreadable',
  // A platform with no ACL reader at all: refused by name rather than certified with an empty list.
  ACL_PLATFORM_UNSUPPORTED: 'aukora-owner:acl-platform-unsupported',
  // A getfacl line whose permissions this daemon could not read: refused, never treated as no rights.
  ACL_LINE_UNKNOWN: 'aukora-owner:acl-line-unknown',
})

const refuse = (code, message) => {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  return error
}

/**
 * THE ACEs ON A PATH, READ WITH `ls -led` RATHER THAN GUESSED FROM THE MODE.
 *
 * **AN ACL IS NOT A MODE BIT AND `ls -ld` DOES NOT SHOW ONE.** A directory at `0755` can carry an ACE giving
 * another principal write, and a check that reads only `st_mode` reports it as closed. `ls -led` prints the
 * mode with a `+` and then the ACEs, which is the only portable way to see them on macOS.
 *
 * @param {string} path
 * @returns {readonly string[]} the ACE lines, or an empty list when `ls` reports none.
 * @throws {Error} `aukora-owner:acl-unreadable` when `ls` cannot be asked — never an empty list.
 */
export function aclEntries(path, options = {}) {
  // ══ THE BOUNDARY COULD NOT READ ACLs ON LINUX AT ALL (CODEX R7 ITEM 6, ROOT CAUSE OF THE RED CI) ══
  //
  // **MEASURED: `-e` IS A macOS OPTION. GNU `ls` REJECTS IT, `execFileSync` THROWS, AND THE BOUNDARY REFUSES
  // WITH `ACL_UNREADABLE` — correctly, because a failed read is not an absence of ACEs.** The consequence is
  // that on the ubuntu runners **EVERY scratch base is refused, including a perfect `0700` HOME/.court-tmp**
  // (Kira's run 36090115763: modes `700 runner:runner` under `750 runner:runner`, still *"no scratch base the
  // daemon boundary accepts"*). **The refusal is honest and the platform reader was simply missing — so the
  // Linux owner cut could not work at all.**
  // THE PLATFORM IS OVERRIDABLE FOR THE SAME REASON THE EXEC IS: **a court on macOS cannot otherwise run the
  // Linux reader at all**, and a branch no court can run is a branch nobody has measured.
  const platform = options.platform ?? process.platform
  if (platform === 'darwin') return darwinAclEntries(path, options)
  if (platform === 'linux') return linuxAclEntries(path, options)
  // **A PLATFORM NOBODY WROTE A READER FOR IS REFUSED BY NAME, NOT ANSWERED WITH AN EMPTY LIST.** Returning
  // `[]` here would certify every path on a platform whose ACLs this daemon has never looked at.
  throw refuse(BOUNDARY_REFUSE.ACL_PLATFORM_UNSUPPORTED,
    `this daemon has no ACL reader for ${platform}, so it cannot certify ${path}. Add a reader rather `
    + 'than assuming the platform has no ACLs')
}

/** macOS: `ls -led` prints the mode line and then the ACEs, which is the only portable way to see them there. */
function darwinAclEntries(path, options = {}) {
  const run = options.execFileSync ?? execFileSync
  let output = ''
  try {
    output = run('/bin/ls', ['-led', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (cause) {
    // **A FAILED `ls` IS NOT "NO ACLs".** Reading a listing that did not arrive as an absence of ACEs would
    // turn a tool failure into a grant, which is the fail-open shape this whole module exists to remove.
    throw refuse(BOUNDARY_REFUSE.ACL_UNREADABLE,
      `could not read the ACLs on ${path}: ${String(cause?.message ?? cause)}`)
  }
  const lines = output.split('\n')
  // The first line is the mode line; ACEs follow, one per line, each starting with a number (the index).
  return Object.freeze(lines.slice(1).map(line => line.trim()).filter(line => /^\d+:/u.test(line)))
}

/**
 * Linux: POSIX ACLs, read with `getfacl` and translated into THE SAME ACE SHAPE macOS produces.
 *
 * **THE SHAPE IS THE CONTRACT.** `aceGrantsWrite`, `aceGrantsSecrecy` and `acesOtherThanOwner` all parse
 * `<index>: <user|group>:<name> <allow|deny> <rights>`, so a second format would be a second parser and a
 * second place for the two platforms to disagree. Everything below emits that shape and nothing else.
 *
 * **ONLY NAMED `user:`/`group:` ENTRIES AND THE MASK ARE EXTENDED ACEs.** `user::`, `group::` and `other::` are
 * the BASE entries — they restate the mode, which is already checked on its own — so emitting them would report
 * the file's ordinary permissions as ACL grants and refuse every path on the platform. **The base `user::` is
 * the OWNER; a named `user:alice` is not, and that is the distinction the whole check turns on.**
 *
 * **THE MASK IS EMITTED AS A GROUP PRINCIPAL.** It has no name of its own, and it CAPS what the named group
 * entries may do, so the fail-closed reading is to treat it as a group ACE — **and a group ACE is refused
 * unless this module can prove the group is private to the owner, which from a Linux mask it cannot.**
 *
 * **A MISSING TOOL OR A FAILED READ STAYS `ACL_UNREADABLE`.** A runner without `getfacl` is a runner where
 * this check cannot be performed, and "could not look" must never read as "found nothing".
 */
function linuxAclEntries(path, options = {}) {
  const run = options.execFileSync ?? execFileSync
  let output = ''
  try {
    output = run('getfacl',
      ['--absolute-names', '--omit-header', '--physical', path],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (cause) {
    // ENOENT here is the tool being absent, which is the same answer as any other failure: UNREADABLE.
    throw refuse(BOUNDARY_REFUSE.ACL_UNREADABLE,
      `could not read the ACLs on ${path} with getfacl: ${String(cause?.message ?? cause)}. A runner without `
      + 'the `acl` package cannot have its ACLs checked, and that is never the same as having none')
  }
  return parseGetfaclOutput(output)
}

/**
 * The `getfacl` PARSER, PURE AND EXPORTED — **so a court can measure it with a fixture instead of with a tool,
 * and so the shape it produces is a thing that can be asserted rather than inferred.**
 *
 * @param {string} output the raw stdout of `getfacl --absolute-names --omit-header --physical`.
 * @returns {readonly string[]} ACE lines in the SAME shape macOS produces.
 */
export function parseGetfaclOutput(output) {
  // ══ EVERY LINE IS CLASSIFIED OR REFUSED; NOTHING IS DROPPED (CODEX R8 ITEM 2) ═════════════════════
  //
  // **MEASURED: THIS PARSER SILENTLY DROPPED EVERY LINE IT DID NOT RECOGNISE.** Two real `getfacl` forms went
  // through that hole, and neither is exotic:
  //
  //   * **`#effective:r-x`** — the annotation `getfacl` prints under an entry the MASK has limited. It starts
  //     with `#`, so the comment rule ate it.
  //   * **`default:user:alice:rwx`** — a DEFAULT ACL, which is what a directory hands to the files created
  //     inside it. It does not match the base pattern either, so it was dropped too.
  //
  // **A LINE THE PARSER CANNOT CLASSIFY IS A LINE WHOSE PERMISSIONS THIS DAEMON HAS NOT READ**, and answering
  // "no ACLs" for it is the fail-open shape this whole module exists to remove. **So every line is now
  // classified by name, and anything left over is REFUSED rather than discarded.**
  const entries = []
  for (const raw of String(output).split('\n')) {
    const line = raw.trim()
    // AN EMPTY LINE CARRIES NOTHING. `getfacl` does not emit one, and a trailing newline is not a permission.
    if (line === '') continue
    if (line.startsWith('#')) {
      // **`# file:`/`# owner:`/`# group:` ARE PROVENANCE COMMENTS AND CARRY NO RIGHTS.** They are recognised
      // explicitly rather than lumped in with the rest, because "it starts with #" is what hid `#effective:`.
      if (/^#\s*(file|owner|group):/u.test(line)) continue
      if (/^#\s*effective:/u.test(line)) {
        // **A LINE THAT IS ONLY AN ANNOTATION CARRIES NO ENTRY, SO IT GRANTS NOTHING.** Real `getfacl` puts the
        // annotation on the entry's own line (see below); this branch covers a form that stands alone, and it
        // is kept rather than deleted because "no such output exists" is a claim about today's `getfacl`, not
        // about every tool that might produce an ACL listing.
        continue
      }
      // ANY OTHER COMMENT IS A FORM NOBODY HERE HAS CLASSIFIED, and guessing that it is harmless is exactly
      // the assumption being removed.
      throw refuse(BOUNDARY_REFUSE.ACL_LINE_UNKNOWN,
        `getfacl printed a comment this daemon cannot classify: ${line.slice(0, 80)}. It is refused rather `
        + 'than assumed to carry no rights')
    }
    // **A DEFAULT ACL IS A REAL GRANT ON OBJECTS THAT DO NOT EXIST YET**, so it is emitted as an ACE and
    // refuses the path — a directory that hands `rwx` to everything created inside it is not a protected
    // directory, and it makes no difference that the file being certified is the directory itself.
    const isDefault = line.startsWith('default:')
    const body = isDefault ? line.slice('default:'.length) : line
    // ── A SAME-LINE EFFECTIVE-RIGHTS ANNOTATION (CODEX R9 ITEM 2) ─────────────────────────────────────
    //
    // **MEASURED: REAL `getfacl` PUTS THE ANNOTATION ON THE SAME LINE AS THE ENTRY, NOT ON ONE OF ITS OWN.**
    // A restricted ACL prints as
    //
    //     user:bob:rwx			#effective:r-x
    //
    // — the nominal rights, then a tab, then what the MASK left of them. The entry regex below is anchored
    // (`$`), so that line matched nothing and was refused as `ACL_LINE_UNKNOWN`. **It failed closed, which is
    // the right direction, but it refused a LEGITIMATE RESTRICTED ACL** — so a directory carrying a perfectly
    // ordinary mask could not be certified, and the refusal named a form the parser simply had not been told
    // about.
    //
    // **AND THE EFFECTIVE RIGHTS ARE THE ONES THAT COUNT.** R8 read the annotation as "narrowing only, so
    // reading the nominal number over-refuses and never under-refuses" — true, and exactly the complaint: the
    // mask is part of the ACL, so the effective rights are what the principal actually holds, and refusing on
    // the wider nominal number refuses a path whose real grant is narrower. The annotation is now PARSED and
    // its rights are used.
    const annotated = /^(.*?)[\t ]+#\s*effective:\s*([rwx-]*)\s*$/u.exec(body)
    const entry = annotated === null ? body : annotated[1].trimEnd()
    const parsed = /^(user|group|mask|other):([^:]*):([rwx-]*)$/u.exec(entry)
    if (parsed === null) {
      // **AN UNCLASSIFIABLE ENTRY IS STILL REFUSED BY NAME, ANNOTATION OR NOT.** Stripping an annotation must
      // not become a way to smuggle a line past the parser: whatever is left of the entry has to parse.
      throw refuse(BOUNDARY_REFUSE.ACL_LINE_UNKNOWN,
        `getfacl printed a line this daemon cannot classify: ${line.slice(0, 80)}. A line whose permissions `
        + 'were not read is not a line with no permissions')
    }
    // **THE EFFECTIVE RIGHTS WIN WHERE THEY ARE GIVEN**, because the mask has already been applied to them.
    const [, kind, name, nominal] = parsed
    const rights = annotated === null ? nominal : annotated[2]
    const isMask = kind === 'mask'
    if (!isMask && !isDefault) {
      // THE BASE ENTRIES RESTATE THE MODE AND ARE NOT EXTENDED ACEs.
      if (kind === 'other' || name === '') continue
    }
    const granted = []
    if (rights.includes('r')) granted.push('read')
    if (rights.includes('w')) granted.push('write')
    if (rights.includes('x')) granted.push('execute')
    // A `---` ENTRY GRANTS NOTHING, so it is not an ACE that can refuse the path — **AND A DEFAULT ENTRY THAT
    // GRANTS NOTHING IS THE SAME, so this rule is applied to both rather than special-cased for one.**
    if (granted.length === 0) continue
    // A DEFAULT ENTRY IS NAMED AS SUCH, so a refusal says which ACL it came from.
    const principal = isMask ? 'mask' : name
    const label = isDefault ? `default-${kind}` : kind
    entries.push(`${String(entries.length)}: ${label}:${principal} allow ${granted.join(',')}`)
  }
  return Object.freeze(entries)
}

/**
 * Whether an ACE line grants a WRITE-CLASS right — and the class is wider than the word "write".
 *
 * **INDEPENDENT REVIEW R8: THE LIST WAS INCOMPLETE, AND EACH MISSING RIGHT IS ENOUGH ON ITS OWN.**
 *
 *   delete          replace what is inside the directory
 *   delete_child    delete entries INSIDE it — the same thing by another name, which is how it was missed
 *   add_file        put a file inside it
 *   add_subdirectory put a directory inside it
 *   append          grow a file inside it
 *   writesecurity   **CHANGE THE ACL ITSELF** — a principal who can do this grants themselves everything
 *                   above, so every other check in this module is decoration against them
 *   chown           take ownership, and with it the mode bits
 *
 * **`writesecurity` IS THE ONE THAT MATTERS MOST AND WAS THE EASIEST TO OMIT**, because it is not a right over
 * the CONTENTS at all — it is a right over the RULES. A directory whose ACL somebody else may edit is not a
 * boundary no matter what the ACL currently says.
 *
 * @param {string} entry
 * @returns {boolean}
 */
export function aceGrantsWrite(entry) {
  // *** A DENY ENTRY GRANTS NOTHING, AND THIS FUNCTION WAS SCORING ONE AS A GRANT. ***
  // It tested for a write-class RIGHT and never asked whether the entry ALLOWS or DENIES it. MEASURED:
  // the owner's home directory carries only the stock macOS `0: group:everyone deny delete`, and this returned
  // TRUE for it — so every HOME-based path failed `assertTrustedAncestors` on a laptop that grants nobody
  // anything. It also returned true for `user:bob deny write,delete_child`.
  //
  // THE DIRECTION OF THE ERROR IS THE SAFE ONE (fail-closed: it refuses paths the real install ancestors
  // /Library, /Library/Application Support, /usr/local and /private/var/root do not carry ACLs for, so
  // Peter is not blocked) — BUT IT IS STILL WRONG, AND IT MADE A COURT SCRATCH DIRECTORY UNDER HOME
  // UNUSABLE, which is what surfaced it.
  //
  // ONLY AN `allow` ACE CARRYING A WRITE-CLASS RIGHT COUNTS. A `deny` is the opposite of a grant, and an
  // `allow read` is not a write.
  return /\ballow\b/u.test(entry)
    && /\b(write|delete|delete_child|add_file|add_subdirectory|append|writesecurity|chown)\b/u.test(entry)
}

/**
 * WHETHER AN ACE LETS SOMEBODY OTHER THAN THE OWNER **READ OR REACH** WHAT IT PROTECTS.
 *
 * **CODEX R4 NEW P1: CUSTODY REJECTED ONLY WRITE-CLASS RIGHTS, SO KEY SECRECY WAS NEVER CHECKED.** A `0600`
 * key file carrying `everyone allow read` passed every rule in this module, and so did a `0700` owner directory
 * carrying `everyone allow list,search` — **the mode says who may read it and the ACE says otherwise, which is
 * the whole distinction this module exists for, applied to the half of it that was missing.**
 *
 * `execute` COUNTS, because on a DIRECTORY it is TRAVERSE: an ACE granting it lets a principal walk through the
 * owner's directory to the key inside, which is a read of everything below whatever the file's own mode says.
 *
 * @param {string} entry one `ls -le` access control entry line
 * @returns {boolean}
 */
export function aceGrantsSecrecy(entry) {
  // THE SAME DIRECTION RULE AS THE WRITE CLASSIFIER: a `deny` grants nothing, and `deny read` is the opposite
  // of the thing being refused. Reading it as a grant would refuse every path that is explicitly protected.
  return /\ballow\b/u.test(entry)
    && /\b(read|readattr|readextattr|readsecurity|list|search|execute)\b/u.test(entry)
}

/**
 * THE PATH ITSELF, NOT ONLY ITS ANCESTORS — **AND THIS CHECK WAS MISSING ENTIRELY.**
 *
 * **INDEPENDENT REVIEW R8, SECOND HALF, AND IT IS THE SHARPER ONE.** Every ACL check in this module ran on
 * ANCESTORS: `assertTrustedAncestors` walks the parents, and `assertKeyBoundary` checks the key's parent.
 * **Nothing ever asked whether the owner directory, the approve directory or the key file carries a write ACE
 * of its own** — so a `0700` directory with `everyone allow write` attached to it passed every rule here while
 * being writable by everyone. The mode is not the ACL, and this module exists because that distinction is easy
 * to lose.
 *
 * @param {string} path
 * @param {number} ownerUid
 * @param {string} label
 * @param {Function} [aclsOf]
 * @returns {string} the path.
 * @throws {Error} `aukora-owner:ancestor-acl-grants-write`.
 */
export function assertNoWriteAcls(path, ownerUid, label, aclsOf) {
  const writers = aclWritersOtherThan(path, ownerUid, aclsOf)
  if (writers.length > 0) {
    throw refuse(BOUNDARY_REFUSE.ANCESTOR_ACL_GRANTS_WRITE,
      `${label} ${path} carries an access control entry that grants a write-class right to a principal other `
      + `than the owner, so its MODE does not describe who may change it: ${writers.join(' | ')}. `
      + '`writesecurity` in particular lets that principal rewrite these rules entirely')
  }
  return path
}

/**
 * REFUSE AN ACE THAT LETS SOMEBODY OTHER THAN THE OWNER READ OR REACH THIS PATH.
 *
 * **IT IS CALLED ON THE CUSTODY PATH ITSELF — the owner directory and the key — AND NOT ON ITS ANCESTORS.**
 * That asymmetry is the point: `/Library` and `/usr/local` are legitimately world-readable, so refusing a read
 * ACE on an ancestor would refuse every real install. **What must not be readable is the key and the directory
 * that holds it**, and until this function existed nothing asked.
 *
 * @param {string} path
 * @param {number} ownerUid
 * @param {string} label
 * @param {Function} [aclsOf]
 * @returns {string} the path.
 * @throws {Error} `aukora-owner:ancestor-acl-grants-read`.
 */
export function assertNoSecrecyAcls(path, ownerUid, label, aclsOf) {
  const readers = aclReadersOtherThan(path, ownerUid, aclsOf)
  if (readers.length > 0) {
    throw refuse(BOUNDARY_REFUSE.ANCESTOR_ACL_GRANTS_READ,
      `${label} ${path} carries an access control entry that grants a read-class right or traversal to a `
      + `principal other than the owner, so its MODE does not describe who may READ it: ${readers.join(' | ')}. `
      + 'A 0600 file anyone may read is not a secret, and an owner directory anyone may search is not private')
  }
  return path
}

/**
 * Whether a path's ACL grants a write-class right to a principal other than the owner.
 * @param {string} path
 * @param {number} ownerUid
 * @returns {readonly string[]} the offending ACE lines.
 */
/**
 * **AN ACE NAMES A PRINCIPAL BY NAME; `ownerUid` IS A NUMBER, SO THE EXEMPTION NEVER FIRED.**
 *
 * MEASURED ON THE GITHUB RUNNER: the offending entry was `default-user:runner`, and the exemption immediately
 * below compares its name against `String(ownerUid)` — which is `"1000"`. **`"runner" !== "1000"`, so the owner's
 * own ACE was reported as another principal and every path under `/home` was refused.** The comparison was
 * between a NAME and an IDENTITY, which are not the same kind of thing, and *its answer was therefore never
 * evidence about who could reach the path.*
 *
 * The name is resolved to a uid through the passwd database, CACHED because `assertTrustedAncestors` walks every
 * ancestor of every candidate, and **FAIL-CLOSED**: a name that cannot be resolved is not the owner, so its ACE
 * still refuses the path. A directory that cannot be certified is not certified.
 *
 * @param {string} name the principal as `getfacl` spelled it.
 * @returns {number|null} its uid, or null when it cannot be established.
 */
const uidByAccountName = new Map()
function uidOfAccount(name) {
  if (uidByAccountName.has(name)) return uidByAccountName.get(name)
  let uid = null
  try {
    const info = userInfo(name)
    // ── **`userInfo` DOES NOT THROW FOR A NAME THAT DOES NOT EXIST — IT ANSWERS WITH THE CURRENT USER** ────
    //
    // MEASURED ON THIS MAC, AND IT WAS A FAIL-OPEN I INTRODUCED:
    //
    //     userInfo('nobody-else')  ->  { uid: 501, gid: 20, username: '<owner>', … }
    //
    // So an ACE naming a principal that does not exist resolved to **the owner's own uid**, the exemption
    // matched, and **a stranger's write ACE was cleared as the owner's.** *A lookup that answers with somebody
    // else's identity when it cannot find the one you asked for is worse than one that fails.*
    //
    // **THE RETURNED NAME IS THE ONLY WITNESS, SO IT IS CHECKED.** A resolution counts only when the passwd
    // database hands back the name that was asked for; anything else is unresolvable, and unresolvable is
    // **NOT the owner**, so the ACE keeps refusing the path.
    uid = info?.username === name && typeof info?.uid === 'number' ? info.uid : null
  } catch {
    // NO SUCH ACCOUNT, OR NO PASSWD DATABASE: UNRESOLVABLE, WHICH IS NOT THE OWNER. The ACE keeps refusing.
    uid = null
  }
  uidByAccountName.set(name, uid)
  return uid
}

/** The account name for a uid, or null. Cached for the same reason, and fail-closed the same way. */
const nameByUid = new Map()
function accountNameOf(uid) {
  if (nameByUid.has(uid)) return nameByUid.get(uid)
  let name = null
  try {
    const info = userInfo(uid)
    // AND THE SAME CHECK IN REVERSE: a uid the database does not know must not come back as somebody's name.
    name = info?.uid === uid && typeof info?.username === 'string' && info.username.length > 0 ? info.username : null
  } catch {
    name = null
  }
  nameByUid.set(uid, name)
  return name
}

export function aclWritersOtherThan(path, ownerUid, aclsOf) {
  return acesOtherThanOwner(path, ownerUid, aclsOf, aceGrantsWrite)
}

/**
 * Whether a path's ACL lets a principal other than the owner READ it or TRAVERSE it.
 *
 * **THE PRINCIPAL FILTER IS SHARED WITH THE WRITE CHECK, DELIBERATELY.** `owner:` is the file's own owner and
 * `root` is exempt in both; **a second copy of that rule is the version that drifts**, and the drift would be
 * a custody check that refuses the owner's own ACE or waves through one for another account.
 *
 * @param {string} path
 * @param {number} ownerUid
 * @returns {readonly string[]} the offending ACE lines.
 */
export function aclReadersOtherThan(path, ownerUid, aclsOf) {
  return acesOtherThanOwner(path, ownerUid, aclsOf, aceGrantsSecrecy)
}

/**
 * Every ACE that names a principal other than the owner AND satisfies `grants`.
 *
 * @param {string} path
 * @param {number} ownerUid
 * @param {Function|undefined} aclsOf
 * @param {(entry: string) => boolean} grants
 * @returns {readonly string[]}
 */
function acesOtherThanOwner(path, ownerUid, aclsOf, grants) {
  // **THE READER IS A PARAMETER, AND MY FIRST VERSION LEFT IT OUT.** MEASURED: `assertTrustedAncestors`
  // computed an injectable `aclsOf` and then called this function, which used the MODULE-LEVEL reader — so the
  // seam went nowhere, the injected ACLs were never consulted, and a directory carrying a write ACE was
  // reported as trusted. **A SEAM THAT IS NOT WIRED IS WORSE THAN NO SEAM: it reads as testable.** The court
  // caught it because its arm injects an ACE that the real `ls -led` cannot see on the fixture.
  const read = aclsOf ?? aclEntries
  // ── USERS AND GROUPS ARE DIFFERENT PRINCIPALS, AND THIS READ THEM WITH ONE RULE (CODEX R5, ITEM A) ──
  //
  // **THE EXEMPTIONS FOR `owner` AND `root` ARE EXEMPTIONS FOR A USER, AND THEY WERE BEING APPLIED TO GROUP
  // NAMES.** MEASURED, as the shape of the defect rather than as a live install: an ACE spelled
  // `group:root allow write` was EXEMPTED — **because the string after `group:` equals the string `root`** —
  // and `group:<some-uid> allow read` was exempted for the same reason one line down. **A group called `root`
  // is not the root user, and a group whose NAME happens to equal the owner's uid number is not the owner.**
  // The comparison was between a group NAME and a USER identity, which are not the same kind of thing, so
  // **its answer was never evidence about who could reach the path.**
  //
  // **AND NO GROUP GETS THE EXEMPTION HERE, WHICH IS DELIBERATE RATHER THAN AN OVERSIGHT.** The intended rule
  // is "a group ACE is refused unless the group is private to the owner" — and an ACE names a group by NAME
  // while this module resolves membership by GID. **Resolving the name would mean a second implementation of
  // the mapping, and guessing it would be the same fail-open in a new place.** `assertRunBoundary` already
  // asks the real question for the one directory where a group has business being here, using `membersOf` and
  // a GID it holds directly. **This function refuses the whole class and says so.**
  //
  // **THE DIRECTION IS FAIL-CLOSED**: a group ACE that would have been wrongly exempted is now refused, and no
  // measured fixture carries one. An install that genuinely needs a group ACE needs a private-group
  // determination that can name it, which is a change with evidence behind it rather than a guess here.
  return Object.freeze(read(path).filter(entry => {
    // `owner:` is the file's own owner, so a write ACE for it adds nothing to what the mode already says.
    if (/^\d+:\s*owner:/u.test(entry)) return false
    if (!grants(entry)) return false
    // ── **THE `default-` PREFIX IS PART OF THE SPELLING, AND NOT KNOWING IT REFUSED EVERY GITHUB RUNNER** ──
    //
    // MEASURED, FROM THE RUNNER'S OWN LOG (run 36233056163):
    //
    //     /home/runner/.court-tmp (aukora-owner:ancestor-acl-grants-write: /home is an ancestor of
    //       /home/runner/.court-tmp/probe and its ACL grants a write-class right to another principal:
    //       0: default-user: allow read,write,execute | 1: default-user:runner allow read,write,execute
    //       | 3: default-mask:mask all
    //
    // **EVERY CANDIDATE WAS REFUSED, AND THE PRINCIPAL IT NAMED WAS `runner` — THE CALLER ITSELF.** The
    // exemption one line below is exactly right and could never fire: the entry is spelled `default-user:runner`
    // and this regex only knew `user:`, so `named` was `null` and the entry fell through to *"a principal this
    // cannot parse is one it cannot clear."* **A FAIL-CLOSED DEFAULT IS ONLY SAFE WHEN IT IS REACHED FOR THE
    // RIGHT REASON** — here it refused a directory because the parser had not been told how the ACE was spelled.
    //
    // **THE EMPTY PRINCIPAL IS ALSO A SPELLING, AND IT MEANS THE OWNER.** `default-user:` with nothing after the
    // colon is the owner's own default entry; `default-user:runner` is the same fact named explicitly. Both are
    // the owner, neither is *another* principal, and the named form is filtered by the same `ownerUid` test the
    // non-default form already uses.
    // ── **A MASK IS NOT A PRINCIPAL, AND NOT KNOWING THAT REFUSED EVERY GITHUB RUNNER (AUMLOK, run
    // 36234951751)** ──────────────────────────────────────────────────────────────────────────────────────
    //
    // MEASURED, FROM THE RUNNER'S OWN REFUSAL, **AFTER** the `default-user:` fix had already landed:
    //
    //     grants a write-class right to another principal:
    //       3: default-mask:mask allow read,write,execute
    //
    // **THE "OTHER PRINCIPAL" IS THE WORD `mask`.** A mask entry is the ACL's own **inheritance ceiling** — it
    // limits what children may inherit and **grants nothing to anybody**. It cannot write to this directory, and
    // no principal is named by it, so it is not evidence that anyone can. The entry reached the *"a principal
    // this cannot parse is one it cannot clear"* rule, which is a fail-closed default **fired for the wrong
    // reason**: the parser had not been told that `mask` is a class rather than an account.
    //
    // **`other:` IS THE OPPOSITE AND IS STILL REFUSED.** It grants to *every* principal, which is precisely a
    // write-class right held by someone other than the owner, so it falls through to the refusal below — the
    // one-word difference between the two is the whole reason this is spelled out rather than pattern-matched.
    const named = /^\d+:\s*(?:default-)?(user|group|other):([^\s]*)/u.exec(entry)
    // **A MASK ENTRY IS THE INHERITANCE CEILING AND NAMES NOBODY.** Exempted BEFORE the parse, because the
    // question this function asks — *can a principal other than the owner write here* — has no subject in it.
    if (/^\d+:\s*(?:default-)?mask:/u.test(entry)) return false
    // A principal this cannot parse is one it cannot clear.
    if (named === null) return true
    const [, kind, name] = named
    // **AN UNNAMED USER ENTRY IS THE OWNER'S OWN.** `default-user:` carries no name because it is the directory
    // owner's entry; treating an absent principal as an unknown one would refuse every default ACL in existence.
    if (kind === 'user' && name === '') return false
    // **THE OWNER AND ROOT ARE USER IDENTITIES**, so only a `user:` ACE may carry their exemption.
    if (kind === 'user') {
      // **THE OWNER'S OWN ACCOUNT, BY NAME OR BY NUMBER.** The numeric spelling is kept because an ACE may carry
      // either, and both must be exempt — the earlier version tested only the number and so exempted only a
      // spelling that `getfacl` does not emit.
      if (name === 'root') return false
      if (name === String(ownerUid)) return false
      if (name === accountNameOf(ownerUid)) return false
      return uidOfAccount(name) !== ownerUid
    }
    // **AND A GROUP IS NEVER EXEMPT HERE.** See above: the exemption is named after a fact this function
    // cannot establish from a group name.
    return true
  }))
}

/**
 * THE RUN DIRECTORY — NOT WORLD-ACCESSIBLE, AND NOT GROUP-WRITABLE UNLESS THE GROUP IS THE OWNER'S OWN.
 *
 * `codex-uid-design.md:5` puts `submit.sock` in `aukora-owner:aukora-submit 0750`: the submit group may
 * TRAVERSE, which is `r-x` and not `-wx`. **Group write is a second principal who can replace the socket**,
 * so it is refused unless the group is private to the owner — a group whose members are the owner alone, which
 * is what `0750` on a per-user group means and what a shared group never does.
 *
 * @param {string} path
 * @param {Readonly<{uid: number, gid: number, membersOf: (gid: number) => readonly string[], aclsOf?: Function}>} host
 * @returns {string} the resolved path.
 */
export function assertRunBoundary(path, host) {
  const absolute = resolve(path)
  const state = lstatSync(absolute)
  if ((state.mode & 0o007) !== 0) {
    throw refuse(BOUNDARY_REFUSE.ANCESTOR_WRITABLE,
      `the run directory ${absolute} is mode ${(state.mode & 0o777).toString(8)} and must not be `
      + 'world-accessible — the submit group may traverse, but the world may not')
  }
  // **AND THE RUN DIRECTORY'S OWN ACL (CODEX R4 ITEM 6).** The mode checks below say what the OWNER set; an ACE
  // says what somebody else may do regardless, and it is invisible to `ls -ld`. **The run directory is where
  // `submit.sock` lives**, so a principal with a write ACE here can replace the socket — and every check in
  // this module that ran on the run directory's ANCESTORS would have passed.
  //
  // **ONLY THE WRITE CLASS, AND THAT IS DELIBERATE.** `0750` on this directory is the DESIGN: the submit group
  // may traverse and read so it can reach the socket. **Refusing read ACEs here would refuse the arrangement the
  // uid design asks for** — the opposite of the custody rule, where read is the thing being protected. A rule
  // copied without its reason is a rule that forbids the intended case.
  assertNoWriteAcls(absolute, host.uid, 'the run directory', host.aclsOf)
  if ((state.mode & 0o020) !== 0) {
    // ── GROUP-WRITE IS REFUSED OUTRIGHT, AND THE EXEMPTION WAS FAIL-OPEN ─────────────────────────────
    //
    // **MEASURED (R15/R7), AND THE ARM ABOVE IS WHY IT SURVIVED.** This allowed a group-writable run directory
    // when the group looked PRIVATE TO THE OWNER — `state.gid === host.gid && members.length <= 1`. On macOS
    // that is not a fact anyone can establish: `dscl` lists only EXPLICIT members, so the owner's own `staff`
    // group answered `eDSRecordNotFound`, the `/etc/group` fallback was empty, and **the widest group on the
    // machine looked like the narrowest.** The boundary court had an arm for this the whole time; it was one of
    // the four that were never awaited, and when it finally ran it got a refusal from the ANCESTOR rule instead
    // — **the right outcome by the wrong rule, which is exactly how a fail-open stays invisible.**
    //
    // The design never needs a group-writable run directory: the submit group TRAVERSES it (`0750`) and writes
    // inside it. So the exemption is removed rather than repaired, and the refusal names the reason.
    // ── THE EXEMPTION IS REMOVED ENTIRELY (CODEX R9 ITEM 1, P1) ──────────────────────────────────────
    //
    // **MEASURED: THE EXEMPTION COULD NEVER BE PROVEN, SO IT WAS ALWAYS A FAIL-OPEN WEARING A FACT'S NAME.**
    // It allowed a group-writable run directory when the group looked "private to the owner" — membership
    // established, and exactly the owner in it. The lookup behind it (`host.membersOf`, and the check at
    // `:738-763` that consumes it) reads **EXPLICIT MEMBERSHIP ONLY**. A principal can be a member of a group
    // as its PRIMARY group, or through a directory-service attribute that never appears in a membership
    // listing at all — and both are invisible to that lookup. **So "this group contains only the owner" was
    // never established; it was "the members I can see are only the owner", which is a different sentence.**
    //
    // The previous repair tightened the evidence and kept the exemption. That is the shape this repository
    // refuses everywhere else: **one of two implementations of a protection.** A rule that holds only when the
    // platform's membership listing happens to be complete is not a weaker rule than an unconditional one; it
    // is an unconditional hole that opens on the machines where the listing is thin, which is precisely the
    // machine the design has to hold on.
    //
    // **AND THE DESIGN DOES NOT NEED IT.** The submit group TRAVERSES the run directory (`0750`) and writes
    // inside it; nothing about the socket requires the directory itself to be group-writable. So group-write
    // is refused UNCONDITIONALLY, and `membersOf` is no longer consulted — a fact that cannot be established
    // is not asked for.
    throw refuse(BOUNDARY_REFUSE.RUN_DIR_GROUP_WRITABLE,
      `the run directory ${absolute} is group-writable (mode ${(state.mode & 0o777).toString(8)}, gid `
      + `${String(state.gid)}). **Group-write is refused unconditionally here, whatever the group is.** The `
      + 'membership lookup this check used to consult lists EXPLICIT members only, so a primary or implicit '
      + 'member is invisible to it and "this group is only the owner" cannot be established on any platform '
      + 'that works that way. A group that can write here can REPLACE submit.sock, so every check below it '
      + 'is decoration. The submit group traverses this directory (0750) and writes inside it; the '
      + 'directory itself does not need to be group-writable')
  }
  return absolute
}

/**
 * EVERY ANCESTOR: OWNED BY ROOT OR THE OWNER, NOT WRITABLE BY OTHERS, AND WITH NO WRITE ACL.
 *
 * **A WRITABLE ANCESTOR CAN RENAME THIS DIRECTORY, so every mode below it is decoration.** The uid check is
 * the second half of that: a directory owned by a third principal is one they can rename whatever its mode
 * says, and `0o002` on its own does not see it.
 *
 * @param {string} path
 * @param {Readonly<{uid: number, aclsOf?: Function}>} host
 * @returns {readonly string[]} the ancestors that were checked.
 */
export function assertTrustedAncestors(path, host) {
  const absolute = resolve(path)
  const aclsOf = host.aclsOf ?? aclEntries
  const checked = []
  for (let at = dirname(absolute); at !== dirname(at); at = dirname(at)) {
    const state = lstatSync(at)
    checked.push(at)
    if (state.uid !== 0 && state.uid !== host.uid) {
      throw refuse(BOUNDARY_REFUSE.ANCESTOR_UNTRUSTED_OWNER,
        `${at} is an ancestor of ${absolute} and is owned by uid ${String(state.uid)}, which is neither root `
        + `nor this daemon's uid ${String(host.uid)}. Its owner can rename what is below it`)
    }
    if ((state.mode & 0o022) !== 0) {
      throw refuse(BOUNDARY_REFUSE.ANCESTOR_WRITABLE,
        `${at} is an ancestor of ${absolute} and is mode ${(state.mode & 0o777).toString(8)} — group- or `
        + 'world-writable. A writable ancestor can rename this directory')
    }
    // **AND THE MODE IS NOT THE WHOLE ANSWER.** `0755` reads as closed and can still carry an ACE granting
    // another principal write, and `ls -ld` would not show it.
    const writers = aclWritersOtherThan(at, host.uid, aclsOf)
    if (writers.length > 0) {
      throw refuse(BOUNDARY_REFUSE.ANCESTOR_ACL_GRANTS_WRITE,
        `${at} is an ancestor of ${absolute} and its ACL grants a write-class right to another principal: `
        + `${writers.join(' | ')}. An ACE is not a mode bit, and a principal who can write here can replace `
        + 'what is below it')
    }
  }
  return Object.freeze(checked)
}

/**
 * THE KEY FILE: ITS PARENT IS VALIDATED, IT IS CONTAINED UNDER THE OWNER DIRECTORY, AND IT IS NOT A SYMLINK.
 *
 * @param {Readonly<{keyFile: string, ownerDir: string, uid: number, aclsOf?: Function}>} input
 * @returns {string} the resolved key path.
 */
export function assertKeyBoundary(input) {
  const key = resolve(input.keyFile)
  const ownerDir = resolve(input.ownerDir)
  // CONTAINED, COMPARED AS PATHS RATHER THAN PREFIXES: `/a/bc` starts with `/a/b` as a string and is not
  // inside it. The separator is what makes containment a fact rather than a coincidence of spelling.
  if (key !== ownerDir && !key.startsWith(ownerDir + sep)) {
    throw refuse(BOUNDARY_REFUSE.KEY_NOT_CONTAINED,
      `the owner key ${key} is not inside the owner directory ${ownerDir}. A key outside it is a key the `
      + 'directory\'s mode does not protect')
  }
  // ── THE KEY MUST BE A DIRECT CHILD, AND LEXICAL CONTAINMENT WAS NOT ENOUGH (CODEX R6 ITEM 1, NEW P1) ──
  //
  // **MEASURED, AS THE SHAPE OF THE DEFECT: `ownerDir/sub/key` SATISFIED EVERY CHECK BELOW.** Containment is
  // lexical — `key.startsWith(ownerDir + sep)` — so one level down passes it; the parent checks call
  // `lstatSync(dirname(key))`, which for `ownerDir/sub/key` inspects `sub` and **never notices that `sub` is
  // itself unvalidated.** Its MODE is never read, and **`lstat` DOES NOT FOLLOW, so an intermediate that is a
  // SYMLINK reports the LINK's own owner and passes the uid test** while the key is actually created wherever
  // the link points — outside the 0700 directory whose mode is the entire protection.
  //
  // **THE FIX IS THE STRONGEST FORM OF THE RULE RATHER THAN A PATCH TO EACH HOLE**: the key is a DIRECT CHILD
  // of the validated owner directory. That closes the unvalidated intermediate, the symlinked intermediate and
  // any mode on an intermediate **in one line, because there is no intermediate left to be wrong about.** The
  // owner directory itself is already validated by `assertPrivateDirectory` — `0700`, owner-owned, not a
  // symlink, ACL-checked — so a direct child inherits exactly the protection that was verified.
  const parent = dirname(key)
  if (parent !== ownerDir) {
    throw refuse(BOUNDARY_REFUSE.KEY_NOT_DIRECT_CHILD,
      `the owner key ${key} is ${parent === ownerDir ? '' : `in ${parent}, which is`} not a DIRECT child of `
      + `the validated owner directory ${ownerDir}. Containment is lexical and says nothing about what lies `
      + 'between: an intermediate directory is never validated, its mode is never read, and `lstat` does not '
      + 'follow — so an intermediate that is a SYMLINK reports the link\'s own owner and the key is created '
      + 'wherever it points. A direct child has no intermediate to be wrong about')
  }
  const state = lstatSync(parent)
  if (state.uid !== input.uid && state.uid !== 0) {
    throw refuse(BOUNDARY_REFUSE.KEY_PARENT_UNTRUSTED,
      `the owner key's parent ${parent} is owned by uid ${String(state.uid)}, which is neither root nor `
      + `this daemon's uid ${String(input.uid)}`)
  }
  const writers = aclWritersOtherThan(parent, input.uid, input.aclsOf)
  if (writers.length > 0) {
    throw refuse(BOUNDARY_REFUSE.ANCESTOR_ACL_GRANTS_WRITE,
      `the owner key's parent ${parent} has an ACL granting a write-class right to another principal: `
      + `${writers.join(' | ')}`)
  }
  return key
}

/**
 * CREATE A FILE SO THAT IT CANNOT BE SOMETHING ELSE — `O_EXCL` AND `O_NOFOLLOW`, THEN `0600` ON THE HANDLE.
 *
 * **A PLAIN WRITE FOLLOWS A SYMLINK.** A link planted at the key path makes the daemon write wherever it
 * points, as the owner — the exact primitive an attacker without the key would want. `O_EXCL` refuses to open
 * an existing file at all and `O_NOFOLLOW` refuses a link at the final component; the two together mean this
 * call either CREATES the file or fails.
 *
 * @param {string} path
 * @param {Buffer|string} contents
 * @param {Readonly<{exclusive?: boolean}>} [options] `exclusive: false` allows updating a file that exists,
 *   which is used for the journal and never for a key.
 * @returns {string} the path written.
 */
export function createBoundaryFile(path, contents, options) {
  const exclusive = options?.exclusive !== false
  // ── THE FILE IS BUILT SOMEWHERE ELSE AND MOVED INTO PLACE (CODEX R4 ITEM 4) ─────────────────────
  //
  // **`O_EXCL` IS NOT ATOMIC CREATION, AND THE GAP IS THE WHOLE DEFECT.** It guarantees that THIS PROCESS is
  // the one that made the NAME — and then the name exists and is EMPTY until `writeSync` runs. **A crash, a
  // SIGKILL or a power cut in between leaves a zero-length key at the final path**, and the next start sees
  // `existing !== null`, parses it as PKCS8 and dies: **a corrupt file that blocks restart, created by the very
  // call that was supposed to be the safe one.** The daemon's own republish already documents the remedy as
  // "the way a durable replacement is written everywhere else"; creation was the one path not using it.
  //
  // **`linkSync` RATHER THAN `renameSync`, BECAUSE THE EXCLUSIVITY MUST SURVIVE.** `rename` replaces the target
  // SILENTLY, so a temp-then-rename would quietly destroy an existing key — the opposite of `O_EXCL`. `link`
  // fails with `EEXIST` if the name is taken, atomically and in the kernel, and only ever after the contents
  // are durable: **the guarantee `O_EXCL` gave, with nothing reachable until it is complete.**
  const temporary = `${path}.tmp-${String(process.pid)}-${randomBytes(6).toString('hex')}`
  // **EVERYTHING AFTER THE TEMPORARY EXISTS IS INSIDE THIS `try`, AND THE FIRST VERSION WAS NOT.** MEASURED by
  // the two arms below: the write was in its own `try/finally` that only closed the handle, so a failure THERE
  // rethrew straight past the cleanup — **and left `interrupted.key.tmp-…` in the owner directory.** A
  // cleanup that only runs on the paths you thought of is the shape this whole session keeps finding: **the
  // failure case is the one that has to be inside it.**
  try {
    let handle = null
    try {
      handle = openSync(temporary, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | FS.O_NOFOLLOW, 0o600)
    } catch (cause) {
      if (cause?.code === 'ELOOP') {
        throw refuse(BOUNDARY_REFUSE.KEY_IS_SYMLINK,
          `${temporary} is a symlink and this daemon will not follow one: a link at a key path writes wherever `
          + 'it points, as the owner')
      }
      throw cause
    }
    try {
      // THE MODE IS SET ON THE HANDLE, not by a later `chmod` on the path: a `chmod` by path re-resolves the
      // name, so between the create and the chmod the file can be swapped for a link.
      fchmodSync(handle, 0o600)
      writeAllSync(handle, contents)
      // **THE FSYNC THE COMMENT ABOVE PROMISED AND THE CODE DID NOT DO.** MEASURED BY THE KILL COURT: the owner
      // key was written, the process was killed, and the next start died with
      // `asn1 encoding routines::not enough data` — a TRUNCATED key and no second copy. **A doc comment that
      // describes a guarantee the code does not provide is worse than no comment**: it is the reason nobody
      // looked. The bytes are on the handle, not in the file, until this line runs.
      fsyncSync(handle)
    } finally {
      closeSync(handle)
    }
    if (exclusive) {
      try {
        linkSync(temporary, path)
      } catch (cause) {
        if (cause?.code === 'EEXIST') {
          throw refuse(BOUNDARY_REFUSE.FILE_EXISTS,
            `${path} already exists and this daemon creates it exclusively: refusing to replace something that `
            + 'may be a link somebody planted')
        }
        throw cause
      }
      // THE NAME NOW EXISTS AND THE CONTENTS WERE ALREADY DURABLE; the temporary is only a second name for the
      // same inode and goes away.
      unlinkSync(temporary)
    } else {
      // A REPUBLISH, WHERE REPLACING IS THE POINT — and the rename consumes the temporary.
      renameSync(temporary, path)
    }
  } catch (cause) {
    // **THE TEMPORARY IS REMOVED ON EVERY FAILURE**, including the write's own — a refused creation that leaves
    // a `.tmp-*` behind is a file nobody owns, and nothing on this path sweeps them.
    try { unlinkSync(temporary) } catch { /* never created, already renamed, or already gone */ }
    throw cause
  }
  // **AND THE DIRECTORY, WHICH IS WHAT MAKES THE NAME ITSELF DURABLE.** Without this the file's BYTES survive a
  // power cut and the entry that names it may not — the same promise the republish makes.
  syncDirectory(dirname(path))
  return path
}

/**
 * WRITE EVERY BYTE, NOT MERELY THE ONES THE FIRST CALL TOOK (CODEX R5 ITEM F).
 *
 * **`fs.writeSync` RETURNS HOW MANY BYTES IT WROTE, AND IT MAY WRITE FEWER THAN IT WAS GIVEN.** Every call site
 * in this daemon discarded that return value — **so a short write was indistinguishable from a complete one,
 * and the `fsync` that follows made the TRUNCATION durable.** The file would then be a partially written key or
 * a partially written journal record that `fsync` had promised was safely on disk.
 *
 * **IT IS RARE ON REGULAR FILES AND THAT IS EXACTLY WHY IT MATTERS.** A regular-file write usually completes,
 * so this is not a bug that announces itself — it is one that appears under load, on a full disk, or against a
 * descriptor that is not a regular file, **and it appears as a corrupt key rather than as a failure.** The loop
 * costs nothing when the first call writes everything, which is the ordinary case.
 *
 * **A WRITE THAT MAKES NO PROGRESS IS AN ERROR, NOT A REASON TO SPIN.** `writeSync` returning 0 with bytes
 * still owed cannot be retried into success, so it throws rather than becoming an infinite loop — **a
 * durability helper that hangs is worse than one that fails, because the hang has no name.**
 *
 * @param {number} handle an open file descriptor.
 * @param {string|Buffer|Uint8Array} contents
 * @returns {number} the total bytes written, which is the whole buffer or an error.
 */
export function writeAllSync(handle, contents) {
  // **IT REFUSES WHAT IT CANNOT WRITE, RATHER THAN COERCING IT (MEASURED, AND THIS WAS MY OWN REGRESSION).**
  // The first version did `Buffer.from(String(contents))`, which turns `{ not: 'a buffer' }` into the 15 bytes
  // of `"[object Object]"` — **so a caller passing the wrong kind of thing got a SILENT GARBAGE WRITE instead
  // of the error `writeSync` gives.** The item 4 arm caught it: it makes the write fail on purpose, and with
  // the coercion there was nothing to fail, so the file was created and the arm went red.
  // **A durability helper that accepts anything is a durability helper that writes anything.**
  const buffer = Buffer.isBuffer(contents)
    ? contents
    : (typeof contents === 'string' || contents instanceof Uint8Array
      ? Buffer.from(contents)
      : (() => { throw new TypeError('writeAllSync: contents must be a string, Buffer or Uint8Array, and this '
        + `is ${contents === null ? 'null' : typeof contents}. Refusing rather than coercing it into bytes`) })())
  let written = 0
  while (written < buffer.length) {
    const step = writeSync(handle, buffer, written, buffer.length - written)
    if (step <= 0) {
      throw refuse(BOUNDARY_REFUSE.SHORT_WRITE,
        `writing ${String(buffer.length)} bytes stopped after ${String(written)}: the descriptor accepted no `
        + 'more, so the file is incomplete and must not be trusted or fsynced')
    }
    written += step
  }
  return written
}

/**
 * Read a file, pinned to ONE open file descriptor.
 *
 * **THE OLD VERSION LOOKED THE PATHNAME UP TWICE** — `lstatSync(path)` to check it, then `readFileSync(path)`
 * to read it. Everything it proved was proved about the FIRST lookup and every byte came from the SECOND, so
 * between them the name could be made to refer to something else and the check and the read would describe
 * different files while both reported success. **THE FIX IS NOT A BETTER CHECK; IT IS ONE LOOKUP:** open
 * once, `fstat` the HANDLE, validate what the handle actually refers to, and read from that same handle. **A
 * descriptor cannot be re-pointed, so the question "is this the file I checked?" stops existing.**
 *
 * @param {string} path - the file to read.
 * @param {object} [options] - test seams.
 * @param {Function} [options.checkHandle] - called once with the **`fstat` of the descriptor about to be
 *   read**, so a caller can assert ownership and mode against the HANDLE rather than against the name. A
 *   caller that checks the name instead has looked it up a second time, which is the defect this removes.
 * @param {Function} [options.afterStat] - called once, **after the handle is fstat'd and before any byte is
 *   read**. A court stands in the exact moment the pin removes, and asserts the bytes still come from the
 *   file that was checked.
 * @returns {Buffer} the file's bytes.
 */
export function readBoundaryFile(path, options = {}) {
  // **`O_NOFOLLOW` REFUSES A SYMLINK AT THE OPEN, AND `O_NONBLOCK` KEEPS A FIFO FROM BLOCKING IT.** A FIFO
  // with no writer would otherwise make `open` wait forever — **and the daemon holds a lock while it settles,
  // so a blocking open does not fail, it stops the daemon, with no name and no error.**
  let handle
  try {
    handle = openSync(path, FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0) | (FS.O_NONBLOCK ?? 0))
  } catch (cause) {
    // **`ELOOP` IS THE SYMLINK REFUSAL, AND IT MUST KEEP ITS OWN NAME.** It was a named refusal before this
    // change and callers depend on the name, so the errno is translated rather than passed through.
    if (cause?.code === 'ELOOP') {
      throw refuse(BOUNDARY_REFUSE.KEY_IS_SYMLINK,
        `${path} is a symlink and this daemon will not follow one`)
    }
    throw cause
  }
  try {
    // **THE PROPERTIES COME FROM THE HANDLE, NOT FROM THE NAME.** This is the whole of the pin: every question
    // below is asked about the file this descriptor refers to, which is the file that will be read.
    const state = fstatSync(handle)
    if (state.isDirectory()) {
      throw refuse(BOUNDARY_REFUSE.KEY_IS_DIRECTORY,
        `${path} is a directory, and this reads a file`)
    }
    if (!state.isFile()) {
      // **A FIFO, A SOCKET, A DEVICE — REFUSED BY NAME RATHER THAN READ.** A FIFO is the one that matters:
      // reading it waits for a writer that may never come, and the wait has no name.
      throw refuse(BOUNDARY_REFUSE.KEY_IS_NOT_A_REGULAR_FILE,
        `${path} is not a regular file, and this reads only regular files`)
    }
    // **A CALLER WITH ITS OWN RULES ASKS THEM OF THE HANDLE, NOT OF THE NAME.** `assertPrivateFile` used to be
    // handed the path, so it looked the name up a THIRD time — and a file could be swapped for a private one
    // and back around the two checks. Here the caller sees the same `fstat` this read depends on.
    options.checkHandle?.(state, path)
    // **THE COURT'S SEAM, AND IT IS THE POINT OF THE FIX.** It runs after the check and before the read, so a
    // court can replace the path at exactly the moment the old code would have looked it up a second time.
    options.afterStat?.()
    return readFileSync(handle)
  } finally {
    closeSync(handle)
  }
}


/**
 * THE MEMBERS OF A GROUP, READ FROM THE SYSTEM, AND **FAIL-CLOSED WHEN IT CANNOT BE READ**.
 *
 * The run-directory rule turns on whether a group is PRIVATE TO THE OWNER, and that is a fact about group
 * membership rather than about a mode. macOS answers with `dscl`; a system without it is read from
 * `/etc/group`.
 *
 * **AN UNREADABLE GROUP IS NOT AN EMPTY ONE.** Returning `[]` would make every group look private and admit
 * exactly the shared group the rule exists to refuse, so a failure throws and the caller refuses the start.
 *
 * @param {number} gid
 * @returns {readonly string[]}
 */
export function groupMembers(gid) {
  const fromDscl = () => {
    // `dscl` prints `GroupMembership: a b c` or `GroupMembership:` when there are none.
    const out = execFileSync('/usr/bin/dscl', ['.', '-read', `/Groups/${String(gid)}`, 'GroupMembership'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const line = out.split('\n').find(entry => entry.startsWith('GroupMembership:')) ?? ''
    return line.replace('GroupMembership:', '').trim().split(/\s+/u).filter(Boolean)
  }
  const fromEtc = () => {
    const text = readFileSync('/etc/group', 'utf8')
    for (const line of text.split('\n')) {
      const parts = line.split(':')
      if (parts.length < 4 || parts[2] !== String(gid)) continue
      return parts[3].split(',').map(name => name.trim()).filter(Boolean)
    }
    return []
  }
  // **`null` MEANS "NOT ESTABLISHED", AND IT IS NOT AN EMPTY GROUP.** MEASURED (independent review, R15/R7):
  // `dscl . -read /Groups/20 GroupMembership` answers `eDSRecordNotFound` for `staff` on macOS, the `/etc/group`
  // fallback finds nothing, and this returned `[]` — so a group with FIVE THOUSAND implicit members looked
  // PRIVATE, and a group-writable run directory was accepted. **On macOS the explicit membership list is not
  // the membership.** An answer nobody can establish must not be spelled the same way as "nobody is in it".
  try { return Object.freeze(fromDscl()) } catch { /* fall through to /etc/group */ }
  try {
    const text = readFileSync('/etc/group', 'utf8')
    const listed = text.split('\n').some(line => line.split(':')[2] === String(gid))
    if (!listed) return null
    return Object.freeze(fromEtc())
  } catch { return null }
}

/** The host description the boundary checks need, assembled once and from the real system. */
export const systemHost = Object.freeze({
  // **THE ACL READER IS ON THE HOST, AND ITS ABSENCE WAS ITSELF A SEAM THAT WENT NOWHERE.** `aclsOf` was
  // threaded through `assertTrustedAncestors` but not through the two checks above, so an injected reader
  // reached the ancestors and not the directory being validated.
  aclsOf: aclEntries,
  uid: process.getuid(),
  gid: process.getgid(),
  // THE OWNER'S ACCOUNT NAME, for the one rule that asks whether a group is a group OF THE OWNER. From the
  // passwd database rather than the environment, so a shell without `USER` still answers correctly.
  //
  // ── **AND IT IS READ LAZILY, BECAUSE READING IT HERE MADE THE WHOLE MODULE UNIMPORTABLE (AUMLOK-101)** ──
  //
  // **MEASURED ON THIS MAC, WHILE DIRECTORY SERVICES WAS DOWN:** `userInfo()` throws
  // `ERR_SYSTEM_ERROR: uv_os_get_passwd returned ENOENT`. **Called at module scope, that throw happens at IMPORT
  // TIME** — so every module that imports this one becomes unimportable, and every court that touches them goes
  // red, **including for the many callers that never ask about a group's members and never need the account
  // name at all.** Three courts were red for this and none of them was testing anything to do with it.
  //
  // **A SYSTEM SERVICE BEING UNAVAILABLE MUST DEGRADE THE RULE THAT NEEDS IT, NOT THE MODULE THAT CONTAINS IT** —
  // which is the same shape as the `courtScratch` fix in the same goal: a failure that propagated far beyond its
  // subject, so a diagnosis was impossible for reasons unrelated to the diagnosis.
  //
  // **AND IT STAYS FAIL-CLOSED.** The getter throws exactly as before when a rule actually asks; nothing is
  // defaulted, nothing is caught, and a caller that needs the name cannot proceed without it. What changes is
  // WHEN, not WHETHER.
  get account() { return userInfo().username },
  membersOf: groupMembers,
})

/**
 * A PRIVATE DIRECTORY — `0700` or stricter, owned by this process, under trusted ancestors.
 *
 * The ancestors are checked by {@link assertTrustedAncestors}, which is the check the daemon's own version did
 * NOT have: it walked the parents looking only for world-write, so an ancestor owned by a third principal, or
 * one carrying a write ACE, passed. **A directory you cannot write is still one somebody else can RENAME if
 * they can write its parent.**
 *
 * @param {string} path
 * @param {string} label
 * @param {Readonly<{uid: number, gid: number, membersOf: Function, aclsOf?: Function}>} [host]
 * @returns {string} the resolved path.
 */
export function assertPrivateDirectory(path, label, host = systemHost) {
  const absolute = resolve(path)
  if (!existsSync(absolute)) {
    throw refuse(BOUNDARY_REFUSE.OWNER_DIR_ABSENT, `${label} does not exist: ${absolute}`)
  }
  const state = lstatSync(absolute)
  if (state.isSymbolicLink()) {
    throw refuse(BOUNDARY_REFUSE.OWNER_DIR_INSECURE, `${label} is a symlink: ${absolute}`)
  }
  if (!state.isDirectory()) {
    throw refuse(BOUNDARY_REFUSE.OWNER_DIR_INSECURE, `${label} is not a directory: ${absolute}`)
  }
  if (state.uid !== host.uid) {
    throw refuse(BOUNDARY_REFUSE.OWNER_DIR_INSECURE,
      `${label} is owned by uid ${String(state.uid)} and this daemon runs as uid ${String(host.uid)}`)
  }
  if ((state.mode & 0o077) !== 0) {
    throw refuse(BOUNDARY_REFUSE.OWNER_DIR_INSECURE,
      `${label} is mode ${(state.mode & 0o777).toString(8)} and must be 0700 or stricter — a group- or `
      + 'world-accessible directory holding keys is not a boundary')
  }
  // **THE DIRECTORY ITSELF, BEFORE ITS ANCESTORS.** The mode above says what the OWNER set; an ACE says what
  // somebody else may do regardless, and it is invisible to `ls -ld`. Checking the ancestors without checking
  // the thing itself is checking every door except the one being locked.
  assertNoWriteAcls(absolute, host.uid, label, host.aclsOf)
  // **AND THE READ HALF, WHICH WAS NEVER ASKED.** The directory holds the key and the pin; a mode of 0700 with
  // an ACE letting another principal list or search it is a private directory with a public index.
  assertNoSecrecyAcls(absolute, host.uid, label, host.aclsOf)
  assertTrustedAncestors(absolute, host)
  return absolute
}

/** fsync a directory, which is what makes a rename inside it durable. */
function syncDirectory(path) {
  const handle = openSync(path, FS.O_RDONLY)
  try { fsyncSync(handle) } finally { closeSync(handle) }
}

/**
 * PUBLISH A FILE THE AGENT MAY READ AND MAY NOT WRITE — atomically, and `0640`.
 *
 * **INDEPENDENT REVIEW R5.** The daemon recorded its public key at `<ownerDir>/owner.pub`, inside the `0700`
 * owner directory — so the app, running as the AGENT uid, could not traverse to it. **The file's own mode did
 * not matter; the directory was the wall.** `detect.mjs` therefore answered `absent` on every real install and
 * the app fell back to settling in-process, which is the exact claim the daemon exists to retire.
 *
 * **THIS IS A REPUBLISH, SO `O_EXCL` CANNOT BE USED** — the daemon writes it on every start, and refusing an
 * existing path would mean publishing only once and never correcting it. It is written the way a durable
 * replacement is written everywhere else in this daemon: **a temporary created `O_EXCL|O_NOFOLLOW`, fsynced,
 * renamed over the target, and the directory fsynced.** The rename is what makes the file either wholly the
 * old key or wholly the new one — never half of either.
 *
 * **`0640` IS THE POINT AND NOT A DETAIL**: group-readable so the submit group can read it through the `0750`
 * run directory, group-unwritable so the agent can verify the daemon and cannot impersonate it. And the run
 * directory itself refuses group-WRITE outright (`assertRunBoundary`), so the file cannot be replaced by the
 * principal that is allowed to read it.
 *
 * @param {string} path
 * @param {string|Buffer} contents
 * @param {number} [mode]
 * @returns {string} the path.
 */
export function publishBoundaryFile(path, contents, mode = 0o640) {
  const absolute = resolve(path)
  const temporary = `${absolute}.tmp-${String(process.pid)}`
  const handle = openSync(temporary, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | FS.O_NOFOLLOW, mode)
  try {
    fchmodSync(handle, mode)
    writeAllSync(handle, contents)
    // THE BYTES ARE ON THE HANDLE, NOT IN THE FILE, UNTIL THIS RUNS — the same line `createBoundaryFile`
    // promised in its comment and did not do until the kill court found it.
    fsyncSync(handle)
  } finally {
    closeSync(handle)
  }
  renameSync(temporary, absolute)
  syncDirectory(dirname(absolute))
  return absolute
}

/**
 * A PRIVATE FILE — not a symlink, owned by this process, `0600` or stricter — **OR `null` WHEN IT IS ABSENT.**
 *
 * **AN ABSENT KEY IS NOT AN INSECURE ONE.** MEASURED: the caller generates the key when it is missing, so
 * refusing on absence would make a first start impossible; my first version called `lstat` unconditionally and
 * the daemon died on `ENOENT` before it could generate anything. The distinction the caller needs is
 * "present and unsafe" versus "not there yet", so absence returns `null` and only a PRESENT file is judged.
 */
/**
 * The same privacy rules, asked of an OPEN DESCRIPTOR rather than of a name.
 *
 * **THE OWNERSHIP AND MODE COME FROM THE HANDLE THE READ WILL USE**, so they describe the same file as the
 * bytes. `assertPrivateFile` above looks the path up itself, which makes it a THIRD lookup when a caller has
 * already opened the file — and a file can be swapped for a private one and back around two checks that do
 * not share a descriptor. **A check is only as good as its binding to the thing it is checking.**
 *
 * **THE ACL CHECKS ARE STILL BY PATH, AND THAT IS A NAMED CEILING.** macOS exposes no ACL listing on a file
 * descriptor, so `assertNoWriteAcls`/`assertNoSecrecyAcls` must name the path — **which means a swap between
 * this call and theirs could defeat the ACL half while the mode half stays pinned.** The mode and ownership
 * rules are the ones a filesystem swap cannot evade here; the ACL rules remain path-bound, and this comment
 * is the only thing that says so.
 *
 * @param {object} state - the `fstat` of the descriptor about to be read.
 * @param {string} path - the path, for the ACL checks and for the message.
 * @param {string} label - what to call this file in a refusal.
 * @param {Readonly<{uid: number, aclsOf?: Function}>} [host] - the owner, defaulting to the system.
 * @returns {string} the path, when every rule holds.
 */
export function assertPrivateHandle(state, path, label, host = systemHost) {
  const absolute = resolve(path)
  if (state.uid !== host.uid) {
    throw refuse(BOUNDARY_REFUSE.OWNER_DIR_INSECURE,
      `${label} is owned by uid ${String(state.uid)}, and the handle-read file must be owned by uid `
      + `${String(host.uid)}`)
  }
  if ((state.mode & 0o077) !== 0) {
    throw refuse(BOUNDARY_REFUSE.OWNER_DIR_INSECURE,
      `${label} is mode ${(state.mode & 0o777).toString(8)} and must be 0600 or stricter`)
  }
  // **THE ACL HALF, WHICH IS STILL PATH-BOUND** — see the ceiling above.
  assertNoWriteAcls(absolute, host.uid, label, host.aclsOf)
  assertNoSecrecyAcls(absolute, host.uid, label, host.aclsOf)
  return absolute
}

export function assertPrivateFile(path, label, host = systemHost) {
  const absolute = resolve(path)
  if (!existsSync(absolute)) return null
  const state = lstatSync(absolute)
  if (state.isSymbolicLink()) {
    throw refuse(BOUNDARY_REFUSE.KEY_IS_SYMLINK, `${label} is a symlink: ${absolute}`)
  }
  if (state.uid !== host.uid) {
    throw refuse(BOUNDARY_REFUSE.OWNER_DIR_INSECURE, `${label} is owned by uid ${String(state.uid)}`)
  }
  if ((state.mode & 0o077) !== 0) {
    throw refuse(BOUNDARY_REFUSE.OWNER_DIR_INSECURE,
      `${label} is mode ${(state.mode & 0o777).toString(8)} and must be 0600 or stricter`)
  }
  // THE KEY FILE ITSELF: a `0600` mode with a write ACE for `everyone` is a `0600` file anyone may rewrite.
  assertNoWriteAcls(absolute, host.uid, label, host.aclsOf)
  // **AND A `0600` FILE WITH A READ ACE IS A `0600` FILE ANYONE MAY READ — the private half of the same key.**
  assertNoSecrecyAcls(absolute, host.uid, label, host.aclsOf)
  return absolute
}
