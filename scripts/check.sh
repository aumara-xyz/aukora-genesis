#!/bin/sh
# The README reviewer packet. Each independent check gets 55 seconds, including
# its subprocesses. Logs and timings are collected separately, printed in order.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

for tool in perl python3 node ssh-keygen; do
    command -v "$tool" >/dev/null 2>&1 || {
        printf 'FAIL: required command not found: %s\n' "$tool" >&2
        exit 1
    }
done
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || {
    printf 'FAIL: Node.js 22 or newer is required; found %s\n' "$(node -v)" >&2
    exit 1
}

# Inline so the TODO list is visible, not swallowed by the parallel runner's last-line summary.
python3 - <<'PY_FACE_COLOURS'
from pathlib import Path
import re
root = Path("plugins/aukora-face")
tokens = "layout/src/client/spatial-tokens.css"
legacy = {
    "aumlok/src/client/Aumlok.module.css",
    "apps/src/client/StockApps.module.css",
    "documents/src/client/Documents.module.css",
    "layout/src/client/Approvals.module.css",
    "layout/src/client/FirstRun.module.css",
    "layout/src/client/Health.module.css",
    "layout/src/client/Why.module.css",
    "settings/src/client/AuraCoherenceSurface.module.css",
    "settings/src/client/GeneralSection.module.css",
    "settings/src/client/SettingsDocumentAction.module.css",
    "settings/src/client/SettingsRoot.module.css",
    "sidebar/src/client/SidebarRoot.module.css",
    "threads/src/client/ThreadHeaderActions.module.css",
    "threads/src/client/ThreadListHeaderActions.module.css",
    "threads/src/client/WorkspaceBrowser.module.css",
    "threads/src/client/WorkspacePicker.module.css",
    "threads/src/client/rows/Rows.module.css",
}
print("TODO face colour migration (paths under plugins/aukora-face): " + ", ".join(sorted(legacy)))
raw = re.compile(r"(?:#[0-9a-f]{8}|#[0-9a-f]{6}|#[0-9a-f]{4}|#[0-9a-f]{3})(?![\w-])|\brgba?\s*\(", re.I)
failures = []
for path in sorted(root.glob("*/src/**/*")):
    if path.suffix.lower() not in {".css", ".scss", ".sass", ".less"} or "vendor" in path.parts:
        continue
    name = path.relative_to(root).as_posix()
    if name in legacy:
        continue
    source = re.sub(r"/\*.*?\*/", "", path.read_text(encoding="utf-8"), flags=re.S)
    source = re.sub(r'''url\([^)]*\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*' ''', "", source, flags=re.I | re.X)
    for declaration in re.finditer(r"(?:^|[;{])\s*([\w-]+)\s*:\s*([^;{}]+)", source):
        property_name, value = declaration.groups()
        if name == tokens and property_name.startswith("--"):
            continue
        if raw.search(value):
            failures.append(str(path))
            break
if failures:
    raise SystemExit("FAIL face raw colours: " + ", ".join(failures))
print("PASS face stylesheet colours")
PY_FACE_COLOURS

started=$(perl -MTime::HiRes=time -e 'print time')
work=$(mktemp -d /tmp/ac.XXXXXX)
mkdir -m 700 "$work/tmp"
# Short socket paths on macOS; no bytecode files racing the vendor pin check.
TMPDIR="$work/tmp"
PYTHONDONTWRITEBYTECODE=1
export TMPDIR PYTHONDONTWRITEBYTECODE
pids=
active=0
index=0
count=0
failed=0
skipped=0
cleanup() {
    trap '' HUP INT TERM
    for pid in $pids; do kill -TERM "$pid" 2>/dev/null || :; done
    for pid in $pids; do wait "$pid" 2>/dev/null || :; done
    rm -rf "$work/tmp"
    if [ "$failed" -eq 0 ]; then rm -rf "$work"; fi
}
trap cleanup 0
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

collect_checks() {
    for pid in $pids; do
        index=$((index + 1))
        if ! wait "$pid"; then failed=$((failed + 1)); fi
        if [ -f "$work/$index.row" ]; then
            cat "$work/$index.row"
        else
            printf 'FAIL      ?s | check %s | runner did not produce a result\n' "$index"
        fi
    done
    pids=
    active=0
}

run_check() {
    count=$((count + 1))
    perl -MTime::HiRes=time -e '
        use strict;
        use warnings;
        use Errno qw(EINTR);
        my ($prefix, $command, $run) = @ARGV;
        my $start = time;
        open my $log, ">", "$prefix.log" or die "log: $!";
        my $pid = fork();
        defined $pid or die "fork: $!";
        if ($pid == 0) {
            $SIG{$_} = "DEFAULT" for qw(HUP INT TERM ALRM);
            setpgrp(0, 0) or die "setpgrp: $!";
            open STDOUT, ">&", $log or die "stdout: $!";
            open STDERR, ">&", $log or die "stderr: $!";
            exec "sh", "-c", $run;
            die "exec: $!";
        }
        close $log;
        my $stop = sub {
            kill "KILL", -$pid;
            kill "KILL", $pid; # Also covers a signal before setpgrp in the child.
        };
        my $reason = "";
        $SIG{ALRM} = sub { $reason = "timeout after 55s"; $stop->() };
        for my $signal (qw(HUP INT TERM)) {
            $SIG{$signal} = sub { $reason = "interrupted by $signal"; $stop->() };
        }
        alarm 55;
        my $waited;
        do { $waited = waitpid($pid, 0) } while $waited == -1 && $! == EINTR;
        my $status = $?;
        alarm 0;
        kill "KILL", -$pid; # Stop any lingering signer or verifier descendants.
        die "waitpid: $!" if $waited == -1;
        my $ok = $status == 0 && $reason eq "";
        if (!$ok && $reason eq "") {
            $reason = ($status & 127) ? "signal " . ($status & 127) : "exit " . ($status >> 8);
        }
        open my $output, "<", "$prefix.log" or die "read log: $!";
        my $last = "(no output)";
        my (@tail, $private);
        while (<$output>) {
            chomp;
            my $end_private = /-----END .*PRIVATE KEY-----/;
            $private ||= /-----BEGIN .*PRIVATE KEY-----/;
            $_ = "[private key omitted]" if $private;
            $private = 0 if $end_private;
            s{(https?://)[^/\s]+\@}{${1}[redacted]\@}giu;
            s{\b(Bearer\s+)\S+}{${1}[redacted]}giu;
            $_ = "[sensitive or environment field omitted]" if
                /(?:password|secret|token|authorization|cookie|api[_-]?key|private[_-]?key)[a-z0-9_-]*\s*["\x27]?\s*[:=]/iu ||
                /^\s*["\x27]?[A-Z][A-Z0-9_]*["\x27]?\s*[:=]/u;
            $_ = substr($_, 0, 512);
            $last = $_ if /\S/;
            if (!$ok && /\S/) { push @tail, $_; shift @tail if @tail > 32 }
        }
        close $output;
        open my $row, ">", "$prefix.row" or die "row: $!";
        printf {$row} "%s %6.2fs | %s%s | %s\n",
            $ok ? "PASS" : "FAIL", time - $start, $command,
            $reason eq "" ? "" : " [$reason]", $last;
        if (!$ok) {
            print {$row} "  failed-check output (last 32 nonempty lines, up to 512 bytes each):\n";
            print {$row} "  | $_\n" for @tail;
        }
        close $row or die "close row: $!";
        exit($ok ? 0 : 1);
    ' "$work/$count" "$1" "$2" &
    pids="$pids $!"
    active=$((active + 1))
    # Bound fixture contention; each watchdog still starts only when its check launches.
    if [ "$active" -eq 4 ]; then collect_checks; fi
}
# The precard caller supplies a private interpreter dispatcher from the base.
# Standalone checks use their normal interpreters and make no confinement claim.
check_self_confined() { run_check "$1" "$1"; }
check() { run_check "$1" "$1"; }

# Unavailable Seatbelt checks are explicit skips, never counted as passes.
skip() {
    printf 'SKIP      -  | %s | %s\n' "$1" "$2"
    skipped=$((skipped + 1))
}
os=$(uname -s)
check_darwin() {
    if [ "$os" = Darwin ]; then check_self_confined "$1"
    else skip "$1" "macOS only: needs Seatbelt (/usr/bin/sandbox-exec); on $os it proves nothing"; fi
}

check 'python3 vendor/append-only/verify.py --selftest'
check 'python3 scripts/phase0-check-pins.py'
check 'node plugins/aukora-kira/lib/wasm-cell/courts/harness/wasm-proposal-cell/run.mjs'
check 'node tests/kira-diamond-cold.test.mjs'
check 'node tests/kira-injection.test.mjs --mutate'
check 'node tests/public-evidence.test.mjs'
check 'node tests/receipt-v3.test.mjs'
check 'node tests/aukora-aumlok-verify.test.mjs'
check 'node tests/aukora-dual-verifier.test.mjs'
check 'node tests/aukora-precard-check.test.mjs'
check 'node tests/aukora-approval-roundtrip.test.mjs'
check 'node tests/aukora-trusted-state.test.mjs'
check 'node tests/aukora-airlock.test.mjs'
check 'node tests/aukora-aumlok-cold-root.test.mjs'
check 'node tests/aukora-aumlok-fresh-bind.test.mjs'
check 'node tests/aukora-gate-require-grant.test.mjs'
check 'node tests/aukora-commit-bind-custody.test.mjs'
check 'node tests/aukora-commit-bind-proof-store.test.mjs'
check 'node tests/aukora-commit-ssh-sign.test.mjs'
check 'node tests/kira-control-admission.test.mjs'
check 'node tests/aukora-restore-scope.test.mjs'
check 'node tests/aukora-witness-four.test.mjs'
check 'node tests/kira-consolidate.test.mjs'
check 'node tests/kira-partial-failure.test.mjs --mutate'
check 'node tests/kira-consequential-gate.test.mjs'
check 'node tests/kira-recall-output-seam.test.mjs'
check 'node tests/kira-a1-ledger-availability.test.mjs'
check 'node tests/kira-a1-legacy-forget.test.mjs'
check 'node tests/kira-openviking-governed.test.mjs'
check 'node tests/kira-reserved-slots.test.mjs'
check 'node tests/kira-a4-window-tier.test.mjs'
check 'node tests/kira-a4-window-size.test.mjs'
check 'node tests/kira-continuity-metrics.test.mjs'
check 'node tests/kira-memory-live-path.test.mjs --plugin-only'
check 'node tests/kira-memory-law.test.mjs'
check 'node tests/kira-memory-reader.test.mjs'
check 'node tests/kira-openviking-recall.test.mjs --red'
check 'node tests/broker-grant.test.mjs'
check 'node tests/aukora-auma-live-fresh-install.test.mjs --mutate'
check 'python3 plugins/aukora-face/apps/vendor/auma-live/voice/test_aurora_prompt.py'
check 'python3 vendor/aukora-membrane/minimal/tour.py'
check 'node vendor/authority/conformance.mjs'
check_darwin 'node scripts/aukora/box-confinement-check.mjs'
check_darwin 'node scripts/aukora/caged-worker.mjs'
check_darwin 'node scripts/aukora/caged-broker-effect.mjs'

collect_checks
perl -MTime::HiRes=time -e '
    printf "TOTAL %.2fs | %d/%d passed", time - $ARGV[0], $ARGV[1] - $ARGV[2], $ARGV[1];
    print " | logs: $ARGV[3]" if $ARGV[2];
    print " | $ARGV[4] skipped (see SKIP lines)" if $ARGV[4];
    print "\n";
' "$started" "$count" "$failed" "$work" "$skipped"
[ "$failed" -eq 0 ]
