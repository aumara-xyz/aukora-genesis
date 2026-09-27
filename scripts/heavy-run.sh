#!/bin/sh
# ONE HEAVY RUN AT A TIME. Usage: scripts/heavy-run.sh -- <command> [args...]
#
# THE WRAPPER EXISTS SO A LANE DOES NOT HAVE TO REMEMBER A NODE INVOCATION: `scripts/heavy-run.sh -- make x`
# takes the lock, runs the command, and releases it. Everything after `--` is the command, so no argument this
# script has can collide with an argument of yours.
#
# IT EXITS WITH THE COMMAND'S OWN CODE, which is what makes it safe to put in front of a court: a wrapper that
# always exits 0 would turn every red court green, and THAT IS THE WORST THING A RESOURCE GATE COULD DO.
set -eu

if [ "${1:-}" != "--" ]; then
  echo "usage: scripts/heavy-run.sh -- <command> [args...]" >&2
  exit 2
fi
shift
if [ "$#" -eq 0 ]; then
  echo "heavy-run: no command after --" >&2
  exit 2
fi

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$here/lib/heavy-run-cli.mjs" "$@"
