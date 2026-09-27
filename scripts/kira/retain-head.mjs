#!/usr/bin/env node
/**
 * retain-head — keep the Kira memory log's Merkle head OUTSIDE the memory state directory.
 *
 * THE SENTENCE THIS TOOL EXISTS TO MAKE AVAILABLE.
 * `plugins/aukora-kira/lib/memory-owner.mjs` names its own ceiling in shipped bytes:
 *
 *   'TRUNCATION_UNANCHORED: the log is append-only and self-contained, so a tail removed TOGETHER
 *    WITH the store's own `seq` marker is indistinguishable from a log that was never extended;
 *    detecting that needs a head retained OUTSIDE this store'
 *
 * This tool is that head. It reads `<stateDir>/aura.jsonl`, folds the entries into an RFC 6962
 * Merkle tree, and writes an observation into a directory you name — which is NOT the state
 * directory, and which the state directory never writes to. Later, `present` re-reads the log and
 * writes an observation carrying the consistency proof from what you kept to what is there now.
 * The pair is then a question `vendor/append-only/verify.py` can settle cold, on bytes.
 *
 * WHAT IT DOES NOT DO. It does not validate the hash chain, spend nonces, check grants or read
 * approvals: `memory-owner.mjs` is the chain's own check and this tool deliberately does not
 * restate it. It does not prove any entry is true, that any event occurred, that the subject keeps
 * only one log, or that the bytes on disk are append-only — anyone who can write `aura.jsonl` can
 * rewrite it and recompute every hash in it. A retained head detects a tail dropped TOGETHER WITH
 * `seq` ONLY when the surviving log is SHORTER than the retained size; a head retained below the
 * drop point cannot see the drop, and `tests/kira-memory-retention.test.mjs` measures that limit
 * rather than hiding it. `retain` reports a head over a log that ends mid-line as a refusal, never
 * as a head.
 *
 * ARITHMETIC IS NOT RE-DERIVED HERE. `phase0log.tree_head` and `phase0log.proof_from` are the
 * repo's measured producer, and `phase0log.py`'s own docstring records that the proof shape is
 * "not something to re-derive from memory". This tool imports those functions in a subprocess
 * rather than restating them, so there is exactly one implementation of the fold in this repo.
 *
 * LEAF CONVENTION, NAMED. `rfc6962-leaf-sha256-0x00-prefixed-v1` — leaf k is
 * `sha256(0x00 || entry_hash_k)`, where `entry_hash_k` is the `hash` field `auraEntryHash` wrote
 * into line k. This is the convention `scripts/aura/adapter.py` and `scripts/composition/aura.py`
 * already name for an entry-hash log, and it is stated in every document this tool writes so a
 * reader cannot mistake which verifier consumes it. Measured, not assumed: both this convention
 * and the raw-line-digest convention verify against the pinned court at every retained size
 * including powers of two; the test asserts the one named here.
 *
 * USAGE
 *   node scripts/kira/retain-head.mjs retain  --state <stateDir> --retain <dir> [--size <m>] [--chain-key <key>]
 *   node scripts/kira/retain-head.mjs present --state <stateDir> --retained <file> --out <file> [--chain-key <key>]
 *
 * `--size <m>` retains the head over the first m entries instead of the whole log. Retaining at the
 * TIP is what protects the tip; a head retained below the tip cannot see a later tail dropped above
 * it, which is why the court measures that case as a named limit.
 *
 * EXIT CODES. 0 the document was written; 2 a named refusal, which means the question could not be
 * asked; 1 unrunnable (bad usage, no interpreter, unreadable output). A refusal is not a head.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PHASE0_DIR = join(ROOT, 'scripts', 'phase0')
const LOG_NAME = 'aura.jsonl'
const DEFAULT_CHAIN_KEY = 'aukora-kira-memory-log-v1'
const EXIT_OK = 0
const EXIT_UNRUNNABLE = 1
const EXIT_REFUSED = 2

/**
 * The producer program. It holds no verdict and computes no judgement: it folds leaves with the
 * repo's own arithmetic and writes the document. Every refusal below is a question that could not
 * be asked, and it is named rather than answered with a head.
 */
const PRODUCER = `
import hashlib, json, os, sys
sys.path.insert(0, os.environ["KIRA_PHASE0_DIR"])
import phase0log

LEAF_CONVENTION = "rfc6962-leaf-sha256-0x00-prefixed-v1"
TREE_CONVENTION = "rfc6962-merkle-tree-sha256-v1"
DOMAIN = "aukora:kira-memory-retention:v1"

def refuse(reason):
    print(json.dumps({"refusal": reason}))
    sys.exit(2)

payload = json.loads(sys.stdin.read())
log_path = payload["log"]
try:
    with open(log_path, "rb") as fh:
        raw = fh.read()
except OSError as exc:
    refuse("memory_log_unreadable: %s: %s" % (log_path, exc))
try:
    text = raw.decode("utf-8")
except UnicodeDecodeError as exc:
    refuse("memory_log_is_not_utf8: %s" % (exc,))
if not text.endswith("\\n"):
    refuse("memory_log_ends_mid_line: the last entry is a partial write, so there is no head to retain")
lines = [line for line in text.split("\\n") if line.strip()]
if not lines:
    refuse("memory_log_is_empty: a store that never settled has no head to retain")

leaves = []
for number, line in enumerate(lines, start=1):
    try:
        entry = json.loads(line)
    except ValueError as exc:
        refuse("entry_%d_is_not_admissible_json: %s" % (number, exc))
    digest = entry.get("hash") if isinstance(entry, dict) else None
    if not isinstance(digest, str) or len(digest) != 64:
        refuse("entry_%d_carries_no_usable_hash: %r" % (number, digest))
    try:
        raw_digest = bytes.fromhex(digest)
    except ValueError:
        refuse("entry_%d_hash_is_not_hex: %r" % (number, digest))
    leaves.append(hashlib.sha256(b"\\x00" + raw_digest).digest())

def observe(size):
    return {
        "schema": "aukora-head-log-v1",
        "domain": DOMAIN,
        "chainKey": payload["chainKey"],
        "leafConvention": LEAF_CONVENTION,
        "treeConvention": TREE_CONVENTION,
        "treeSize": size,
        "root": phase0log.tree_head(leaves[:size]).hex(),
        "firstUnverifiedLine": None,
    }

if payload["mode"] == "retain":
    size = payload.get("size") or len(leaves)
    if not isinstance(size, int) or isinstance(size, bool) or size < 1 or size > len(leaves):
        refuse("retain_size_%r_is_not_within_this_logs_%d_entries" % (size, len(leaves)))
    document = observe(size)
    document["retainedFrom"] = log_path
    document["retainedAt"] = payload["atGeneration"]
    document["retainedEntryCount"] = size
else:
    try:
        with open(payload["retained"], "rb") as fh:
            retained = json.loads(fh.read().decode("utf-8"))
    except OSError as exc:
        refuse("retained_observation_unreadable: %s: %s" % (payload["retained"], exc))
    except (UnicodeDecodeError, ValueError) as exc:
        refuse("retained_observation_is_not_admissible_json: %s" % (exc,))
    retained_size = retained.get("treeSize")
    if not isinstance(retained_size, int) or isinstance(retained_size, bool) or retained_size < 1:
        refuse("retained_observation_names_no_usable_tree_size: %r" % (retained_size,))
    document = observe(len(leaves))
    document["retainedTreeSize"] = retained_size
    document["retainedRoot"] = retained.get("root")
    if retained_size <= len(leaves):
        document["proofFromPrevious"] = [h.hex() for h in phase0log.proof_from(retained_size, leaves)]
    else:
        document["proofFromPrevious"] = []
        document["proofAbsent"] = (
            "presented_size_%d_is_below_retained_size_%d: a consistency proof from the retained "
            "observation to this log does not exist" % (len(leaves), retained_size))

target = payload["target"]
os.makedirs(os.path.dirname(os.path.abspath(target)), exist_ok=True)
with open(target, "w", encoding="utf-8") as fh:
    fh.write(json.dumps(document, sort_keys=True, separators=(",", ":")) + "\\n")
print(json.dumps({
    "mode": payload["mode"], "target": target, "treeSize": document["treeSize"],
    "root": document["root"], "leafConvention": LEAF_CONVENTION,
    "entryCount": len(lines), "proofElements": len(document.get("proofFromPrevious", [])),
    "retainedTreeSize": document.get("retainedTreeSize"),
}))
`

/** @param {string} reason @returns {number} */
function refuse(reason) {
  process.stderr.write(`REFUSED: ${reason}\n`)
  return EXIT_REFUSED
}

/** @param {string[]} argv @returns {Record<string, string>} */
function parseFlags(argv) {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith('--')) {
      flags[argv[index].slice(2)] = argv[index + 1]
      index += 1
    }
  }
  return flags
}

/** @param {string} mode @returns {number} */
function main(mode) {
  const flags = parseFlags(process.argv.slice(3))
  if (mode !== 'retain' && mode !== 'present') {
    return refuse(`usage: retain-head.mjs <retain|present> ... (got ${JSON.stringify(mode ?? null)})`)
  }
  if (!flags.state) return refuse('no_state_directory_named: pass --state <stateDir>')
  if (mode === 'retain' && !flags.retain) return refuse('no_retained_directory_named: pass --retain <dir>')

  const stateDir = resolve(flags.state)
  const log = join(stateDir, LOG_NAME)
  if (!existsSync(stateDir)) return refuse(`state_directory_absent: ${stateDir}`)
  if (!existsSync(log)) return refuse(`memory_log_absent: ${log}`)

  const chainKey = flags['chain-key'] ?? DEFAULT_CHAIN_KEY
  const atGeneration = Number(flags['at-generation'] ?? Math.floor(Date.now() / 1000))
  let target
  if (mode === 'retain') {
    target = join(resolve(flags.retain), `${chainKey.replace(/[^A-Za-z0-9._-]/g, '_')}.json`)
    // The retained directory is named by the caller and is deliberately NOT checked against the
    // state directory: refusing to retain inside the state directory would be the tool enforcing
    // the very property it cannot establish. The caller's path is printed, and the court that
    // reads it is where "outside" is measured.
  } else {
    if (!flags.retained) return refuse('no_retained_observation_named: pass --retained <file>')
    if (!flags.out) return refuse('no_output_named: pass --out <file>')
    if (!existsSync(flags.retained)) return refuse(`retained_observation_absent: ${flags.retained}`)
    target = resolve(flags.out)
  }

  const produced = spawnSync(process.env.KIRA_PYTHON ?? 'python3', ['-B', '-c', PRODUCER], {
    input: JSON.stringify({
      mode, log, target, chainKey, atGeneration,
      size: flags.size === undefined ? null : Number(flags.size),
      retained: flags.retained ? resolve(flags.retained) : null,
    }),
    encoding: 'utf8',
    env: { ...process.env, KIRA_PHASE0_DIR: PHASE0_DIR },
  })
  if (produced.error) return refuse(`producer_could_not_be_run: ${produced.error.code ?? produced.error.message}`)
  const line = (produced.stdout ?? '').trim().split('\n').filter(Boolean).pop()
  let report
  try {
    report = JSON.parse(line)
  } catch {
    return refuse(`producer_printed_no_report (status ${produced.status}): ${(produced.stderr ?? '').trim()}`)
  }
  if (report.refusal) return refuse(report.refusal)
  if (produced.status !== 0) return refuse(`producer_exited_${produced.status}: ${(produced.stderr ?? '').trim()}`)
  process.stdout.write(`${mode.toUpperCase()} ${report.target}\n`)
  process.stdout.write(`  treeSize ${report.treeSize} root ${report.root}\n`)
  process.stdout.write(`  leafConvention ${report.leafConvention}\n`)
  if (mode === 'present') {
    process.stdout.write(`  retainedTreeSize ${report.retainedTreeSize} proofElements ${report.proofElements}\n`)
  }
  return EXIT_OK
}

process.exit(main(process.argv[2]))
