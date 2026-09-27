/**
 * Whether the subscription hands are fenced away from the operator's protected trees.
 *
 * **THE FENCE IS THE FILESYSTEM, NOT A SEATBELT PROFILE — AND THAT IS A MEASUREMENT, NOT A PREFERENCE.**
 * AUMLOK-95 item 3 asked for a Seatbelt profile that stops a hand's Bash reading `~/Library/Application
 * Support/AUKORA` and `~/aukora-private`. **MEASURED, NO SEATBELT SHAPE DOES IT**, five ways against a real
 * secret and a real process:
 *
 *     (allow default) + (deny file-read* (subpath X))                 -> X IS READABLE
 *     the same deny placed BEFORE the allow                            -> X IS READABLE
 *     (deny file-read-data (subpath X)) instead                        -> X IS READABLE
 *     (deny default) + (allow file-read* (subpath "/")) + the deny     -> X IS READABLE
 *     a NARROW allow-list omitting X                                   -> THE PROCESS ABORTS (134)
 *
 * **The last one is decisive: `bash -c 'echo'`, which reads no file, dies with SIGABRT under a narrow list**
 * — even with `/usr`, `/bin`, `/System`, `/Library`, `/private`, `/var`, `/etc` and `/opt` granted. So the
 * two available shapes are broad reads whose denies do not apply, or a narrow list that cannot start a shell.
 *
 * **WHAT DOES WORK IS ALREADY ON DISK.** Both directories are `drwx------` and owned by the operator, so
 * **any uid other than the operator's is refused by the kernel**, with no profile involved. The fence is
 * therefore a property to CHECK rather than a profile to build, and the requirement it implies is that the
 * hands must not run as the operator.
 *
 * @module aukora-core-read-deny/lib/hands-fence
 */

/** The mode a protected directory must carry: the operator's alone. */
export const FENCED_MODE = 'drwx------'

/**
 * Why a protected path is not fenced, or an empty list when it is.
 *
 * **IT TAKES FACTS RATHER THAN A PATH SO IT CAN BE TESTED WITHOUT TOUCHING THE DIRECTORIES IT GOVERNS.** A
 * court proving it can go red by chmodding `~/aukora-private` would be **modifying the operator's private
 * tree to test a claim about it**, which is the kind of side effect a court must never have.
 *
 * @param {{mode: string, uid: number}} facts - what `stat` reported for the path.
 * @param {number} operatorUid - the operator's uid, i.e. the one the hands must NOT run as.
 * @returns {string[]} the unmet fences, empty when the path is fenced.
 */
export function handsFenceUnmet(facts, operatorUid) {
  const unmet = []
  if (facts.mode !== FENCED_MODE) {
    unmet.push(`mode is ${facts.mode}, not ${FENCED_MODE}, so every uid can reach it`)
  }
  if (facts.uid !== operatorUid) {
    unmet.push(`owned by uid ${String(facts.uid)}, not the operator's ${String(operatorUid)}`)
  }
  return unmet
}
