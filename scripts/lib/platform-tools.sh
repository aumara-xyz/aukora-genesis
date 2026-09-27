#!/bin/sh
# platform-tools.sh — alpha-26: the SHELL side of the one shared platform-tool seam.
#
# Its twins are scripts/lib/platform-tools.mjs and scripts/lib/platform_tools.py. They are separate files only because
# their callers are written in different languages; THE ANSWER MUST NOT DIFFER BETWEEN THEM. `lsof`, `launchctl` and
# `footprint` are macOS instruments that are absent in the Linux container. About a dozen shell scripts test for them
# with `command -v` and then continue SILENTLY, which is the failure this file removes: silently continuing after a
# failed probe reads exactly like a successful probe that found nothing.
#
# SOURCE IT, do not execute it:  . "$(dirname "$0")/lib/platform-tools.sh"
#
# THREE ANSWERS, AND ONLY THREE:
#   AVAILABLE  platform_tool <name> prints the path and returns 0.
#   STUBBED    AUKORA_LSOF_BIN / AUKORA_LAUNCHCTL_BIN / AUKORA_FOOTPRINT_BIN names a stand-in; the override WINS over
#              the platform, which is how a court stands in for a tool it does not want to run for real.
#   ABSENT     platform_tool returns 1 and prints nothing; platform_tool_skip PRINTS A NAMED LINE saying which tool is
#              missing, what it is for, and which variable would stub it. A caller that cannot measure must use that
#              line rather than an empty answer.
#
# IT NEVER EXITS THE CALLER. Every function returns a status; nothing calls `exit`, because a helper that killed the
# script it was sourced into would be a worse bug than the one it exists to fix.

# The variables, in one place, so the three languages cannot drift.
platform_tool_env() {
  case "$1" in
    lsof)      printf '%s\n' AUKORA_LSOF_BIN ;;
    launchctl) printf '%s\n' AUKORA_LAUNCHCTL_BIN ;;
    footprint) printf '%s\n' AUKORA_FOOTPRINT_BIN ;;
    *)         return 2 ;;
  esac
}

platform_tool_purpose() {
  case "$1" in
    lsof)      printf '%s\n' 'which process holds a port or a file open, so a holder can be attributed rather than guessed' ;;
    launchctl) printf '%s\n' 'load and unload launchd jobs, so a cutover can be started and stopped' ;;
    footprint) printf '%s\n' 'the memory footprint of a live process, so a launch can be measured instead of assumed' ;;
    *)         return 2 ;;
  esac
}

# Prints the tool's path and returns 0, or prints nothing and returns 1. NEVER prints an error of its own: absence is
# reported by platform_tool_skip, in one place, with the tool's name in it.
platform_tool() {
  _pt_name=$1
  _pt_env=$(platform_tool_env "$_pt_name") || return 2
  eval "_pt_override=\${$_pt_env:-}"
  if [ -n "$_pt_override" ]; then
    if [ -x "$_pt_override" ]; then printf '%s\n' "$_pt_override"; return 0; fi
    return 1
  fi
  _pt_found=$(command -v "$_pt_name" 2>/dev/null) || return 1
  [ -n "$_pt_found" ] || return 1
  printf '%s\n' "$_pt_found"
  return 0
}

# The NAMED SKIP, or nothing at all when the tool IS there.
#
# Returning nothing when the host can measure is the point: a function whose job is to say "this host cannot measure X"
# must not say it on a host that can, or a reader learns to distrust the line that matters.
platform_tool_skip() {
  _pt_name=$1
  _pt_purpose=${2:-}
  _pt_env=$(platform_tool_env "$_pt_name") || return 2
  if platform_tool "$_pt_name" >/dev/null 2>&1; then return 0; fi
  [ -n "$_pt_purpose" ] || _pt_purpose=$(platform_tool_purpose "$_pt_name")
  printf 'NOT RUN: %s-unavailable — %s is not on PATH; %s. Set %s to a stand-in to exercise this arm on this host.\n' \
    "$_pt_name" "$_pt_name" "$_pt_purpose" "$_pt_env"
  return 0
}

# Was this resolution a stand-in rather than the platform's own tool? A reader is entitled to know.
platform_tool_is_stub() {
  _pt_name=$1
  _pt_env=$(platform_tool_env "$_pt_name") || return 2
  eval "_pt_override=\${$_pt_env:-}"
  [ -n "$_pt_override" ] && [ -x "$_pt_override" ]
}
