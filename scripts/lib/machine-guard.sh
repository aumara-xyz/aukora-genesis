#!/usr/bin/env bash
# machine-guard.sh — MACHINE SAFETY, SOURCED BY EVERY HARNESS THAT CAN START A CONTAINER.
#
# ══ WHY THIS EXISTS ═════════════════════════════════════════════════════════════════════════════════════════
# *** SWAP WAS MEASURED AT 14.2 OF 15.4 GB USED, AND AUMA MEASURED 910 MB FREE WHEN TWO REHEARSALS OVERLAPPED.
# THAT IS THE CONDITION THAT TAKES PETER'S APP AND EVERY LANE DOWN. *** This is not a performance concern and it
# is not a preference: it is the failure mode where seven lanes lose their work at once, and it is caused by
# lanes each doing something individually reasonable.
#
# ══ THE RULES, EACH ONE A NAMED REFUSAL RATHER THAN A HOPE ══════════════════════════════════════════════════
#   1. ANY docker run OR REHEARSAL RUNS ONLY INSIDE `scripts/heavy-run.sh`, SO THERE IS ONE HEAVY THING
#      MACHINE-WIDE AT A TIME. The wrapper's lock is the only thing that can enforce that, and a harness that
#      skips it is a harness that can overlap with another lane's.
#   2. AT MOST ONE CONTAINER AT A TIME UNTIL FABLE LIFTS THIS. `rehearse-all.sh` shards 1, not 2.
#   3. BEFORE STARTING, READ `sysctl vm.swapusage`. *** IF FREE IS UNDER 3 GB, DO NOT START; WAIT AND RE-CHECK. ***
#   4. REMOVE CONTAINERS BY THEIR FULL NAME ONLY, NEVER A PREFIX MATCH. *** AUMA REMOVED ANOTHER LANE'S
#      CONTAINER THAT WAY TONIGHT. ***
#
# ══ HOW TO SOURCE IT ════════════════════════════════════════════════════════════════════════════════════════
#     . "$(dirname "${BASH_SOURCE[0]}")/../lib/machine-guard.sh"
#     guard_swap_floor          # refuses by name when swap is too low
#     guard_under_heavy_run     # refuses when not running inside heavy-run.sh
#     guard_container_ceiling 1 # refuses when more than N containers are running
#     guard_remove_full_name <name>   # the only removal this tree allows
set -uo pipefail

# THE FLOOR IS NAMED HERE AND NOWHERE ELSE, so raising it is one edit rather than a search.
AUKORA_SWAP_FLOOR_MB="${AUKORA_SWAP_FLOOR_MB:-3072}"
AUKORA_CONTAINER_CEILING="${AUKORA_CONTAINER_CEILING:-1}"

guard_refuse() { printf 'MACHINE SAFETY REFUSED: %s\n' "$1" >&2; exit 2; }

# ── 3. THE MEMORY GATE — AND THE METRIC IT USES WAS CORRECTED ═══════════════════════════════════════════════
# *** THE FIRST VERSION OF THIS GUARD USED `free` FROM `vm.swapusage`, AND THAT WAS THE WRONG METRIC. ***
# macOS GROWS AND SHRINKS ITS SWAP FILES ON DEMAND, SO "free" STAYS LOW FROM LONG-AGO PAGE-OUTS EVEN WHEN THE
# MACHINE IS HEALTHY. It was measured refusing at 1.29 GB free while `kern.memorystatus_level` WAS 71 -- SEVENTY-ONE
# PERCENT OF MEMORY FREE -- WITH 34 GiB OF DISK FOR SWAP TO GROW INTO.
# *** A GATE THAT REFUSES A HEALTHY MACHINE IS NOT A SAFE GATE; IT IS A GATE THAT GETS DISABLED, AND THEN
# NOTHING IS GUARDED. *** That is the same failure as a court that is red for the wrong reason.
#
# THE GATE IS NOW TWO CONDITIONS, BOTH MEASURED, BOTH NAMED IN THE REFUSAL:
#     kern.memorystatus_level >= 35   -- the kernel's OWN view of how much memory is available
#     free disk on /        >= 10 GiB -- because swap is DISK, and the level is only meaningful if there is
#                                         somewhere for it to grow
# THE DISK HALF IS NOT DECORATION: `memorystatus_level` DESCRIBES PRESSURE, AND A MACHINE WITH 71 PERCENT FREE
# AND 200 MB OF DISK WOULD STILL TAKE SEVEN LANES DOWN. Neither number is sufficient alone.
AUKORA_MEMORY_LEVEL_MIN="${AUKORA_MEMORY_LEVEL_MIN:-35}"
AUKORA_DISK_FLOOR_GB="${AUKORA_DISK_FLOOR_GB:-10}"

guard_memory_level() {
  [ -x /usr/sbin/sysctl ] || return 1
  local v
  v="$(/usr/sbin/sysctl -n kern.memorystatus_level 2>/dev/null)" || return 1
  case "$v" in ''|*[!0-9]*) return 1 ;; esac
  printf '%s' "$v"
}

guard_disk_free_gb() {
  # -g IS GiB ON macOS'S df. `/` IS THE RIGHT VOLUME: swap lives on the boot volume.
  /bin/df -g / 2>/dev/null | /usr/bin/awk 'NR==2 { print $4 }'
}

guard_swap_floor() {
  local level disk
  level="$(guard_memory_level)" || {
    printf 'MACHINE SAFETY: cannot read kern.memorystatus_level on this host, so the memory gate cannot be checked.\n' >&2
    printf '  THIS IS REPORTED RATHER THAN PASSED: a guard that proceeds because it could not measure the\n' >&2
    printf '  condition it guards is the fail-open this tree exists to remove. Set AUKORA_SWAP_UNCHECKED=1\n' >&2
    printf '  to proceed deliberately, and that choice will be visible in the log.\n' >&2
    [ -n "${AUKORA_SWAP_UNCHECKED:-}" ] || exit 2
    return 0
  }
  disk="$(guard_disk_free_gb)"
  case "$disk" in ''|*[!0-9]*) printf 'MACHINE SAFETY: cannot read free disk on /.\n' >&2; exit 2 ;; esac

  if [ "$level" -lt "$AUKORA_MEMORY_LEVEL_MIN" ]; then
    guard_refuse "kern.memorystatus_level IS ${level} AND THE MINIMUM IS ${AUKORA_MEMORY_LEVEL_MIN}.

  *** THIS IS THE CONDITION THAT TAKES PETER'S APP AND EVERY LANE DOWN. *** A container started here does not
  fail on its own -- it swaps the HOST, and seven lanes lose their work at once.

  NOTHING WAS STARTED. Wait and re-check:
      sysctl -n kern.memorystatus_level
  NOTE THE METRIC, BECAUSE IT WAS CORRECTED: \`free\` IN \`vm.swapusage\` STAYS LOW FROM LONG-AGO PAGE-OUTS EVEN
  ON A HEALTHY MACHINE, SO IT IS NOT THE NUMBER TO WATCH. THE KERNEL'S OWN LEVEL IS.
  This refusal is a NAMED condition, not a technical failure: the harness is fine and the work is fine."
  fi
  if [ "$disk" -lt "$AUKORA_DISK_FLOOR_GB" ]; then
    guard_refuse "FREE DISK ON / IS ${disk} GiB AND THE FLOOR IS ${AUKORA_DISK_FLOOR_GB} GiB.

  *** SWAP IS DISK. *** kern.memorystatus_level IS ${level} AND HEALTHY, BUT A MACHINE WITH NO ROOM FOR THE SWAP
  FILES TO GROW WILL STILL STALL -- so the level alone is not sufficient and this is the other half of the gate.
  NOTHING WAS STARTED. Free space and re-check:  df -g /"
  fi
  printf '  memory level %s (min %s), disk free %s GiB (min %s) — ok to start\n' \
    "$level" "$AUKORA_MEMORY_LEVEL_MIN" "$disk" "$AUKORA_DISK_FLOOR_GB"
}

# ── 1. ONE HEAVY THING MACHINE-WIDE ─────────────────────────────────────────────────────────────────────────
# The wrapper takes a machine-wide lock; nothing else does. So the only way to be sure this harness cannot
# overlap with another lane's is to require that it IS the wrapper's child.
guard_under_heavy_run() {
  if [ -z "${AUKORA_HEAVY_RUN_LOCK:-}" ]; then
    guard_refuse "THIS HARNESS STARTS CONTAINERS AND IS NOT RUNNING INSIDE scripts/heavy-run.sh.

  *** ONE HEAVY THING MACHINE-WIDE AT A TIME IS THE RULE, AND THE WRAPPER'S LOCK IS THE ONLY THING THAT CAN
  ENFORCE IT. *** A harness that skips the wrapper is one that can overlap with another lane's, which is how
  910 MB free was measured.

  RUN IT AS:
      ./scripts/heavy-run.sh -- $0 $*
  AND NOT DIRECTLY."
  fi
}

# ── 2. THE CONTAINER CEILING ────────────────────────────────────────────────────────────────────────────────
guard_container_ceiling() {
  local allowed="${1:-$AUKORA_CONTAINER_CEILING}"
  local running
  running="$(docker ps -q 2>/dev/null | wc -l | tr -d ' ')"
  if [ "${running:-0}" -ge "$allowed" ]; then
    guard_refuse "$running container(s) are already running and the ceiling is $allowed.

  *** THIS LOWERED FROM 3 TO 1 FOR MACHINE SAFETY AND IT IS NOT A PERFORMANCE PREFERENCE. ***
  This harness does not stop anybody else's container to make room:
      $(docker ps --format '{{.Names}}' 2>/dev/null | tr '\n' ' ')
  Wait for one to finish. If a container is YOURS and is stuck, remove it BY FULL NAME (rule 4)."
  fi
}

# ── 4. REMOVAL BY FULL NAME ONLY ────────────────────────────────────────────────────────────────────────────
# *** AUMA REMOVED ANOTHER LANE'S CONTAINER WITH A PREFIX MATCH TONIGHT. *** `docker rm $(docker ps -q -f name=X)`
# matches EVERY container whose name STARTS WITH X, and the names in this tree are long shared prefixes --
# `aukora-ci-local-linux-<epoch>-<pid>` -- SO A PREFIX MATCH IS ROUTINELY SOMEBODY ELSE'S CONTAINER.
guard_remove_full_name() {
  local name="$1"
  [ -n "$name" ] || guard_refuse "refusing to remove a container with an EMPTY name"
  # THE EXACT-MATCH CHECK IS THE GUARD: `docker ps -f name=^X$` ANCHORS BOTH ENDS, and the comparison below
  # refuses if ANY returned name is not character-for-character the one asked for.
  local matched
  matched="$(docker ps -a --format '{{.Names}}' -f "name=^${name}$" 2>/dev/null)"
  if [ -z "$matched" ]; then return 0; fi   # not ours, nothing to do
  while IFS= read -r got; do
    [ "$got" = "$name" ] || guard_refuse "a prefix match offered \`$got\` when asked to remove \`$name\`.
  *** REMOVAL IS BY FULL NAME ONLY. *** Refusing rather than removing something that merely starts the same."
  done <<EOF
$matched
EOF
  docker rm -f "$name" >/dev/null 2>&1 || true
}
