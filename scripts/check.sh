#!/bin/sh
# The README reviewer packet. Each independent check gets 55 seconds, including
# its subprocesses. Logs and timings are collected separately, printed in order.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

for tool in perl python3 node; do
    command -v "$tool" >/dev/null 2>&1 || {
        printf 'FAIL: required command not found: %s\n' "$tool" >&2
        exit 1
    }
done

started=$(perl -MTime::HiRes=time -e 'print time')
work=$(mktemp -d /tmp/ac.XXXXXX)
mkdir "$work/tmp"
# Short socket paths on macOS; no bytecode files racing the vendor pin check.
TMPDIR="$work/tmp"
PYTHONDONTWRITEBYTECODE=1
export TMPDIR PYTHONDONTWRITEBYTECODE
pids=
count=0
failed=0
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

check() {
    count=$((count + 1))
    perl -MTime::HiRes=time -e '
        use strict;
        use warnings;
        use Errno qw(EINTR);
        my ($prefix, $command) = @ARGV;
        my $start = time;
        open my $log, ">", "$prefix.log" or die "log: $!";
        my $pid = fork();
        defined $pid or die "fork: $!";
        if ($pid == 0) {
            $SIG{$_} = "DEFAULT" for qw(HUP INT TERM ALRM);
            setpgrp(0, 0) or die "setpgrp: $!";
            open STDOUT, ">&", $log or die "stdout: $!";
            open STDERR, ">&", $log or die "stderr: $!";
            exec "sh", "-c", $command;
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
        while (<$output>) { chomp; $last = $_ if /\S/ }
        close $output;
        open my $row, ">", "$prefix.row" or die "row: $!";
        printf {$row} "%s %6.2fs | %s%s | %s\n",
            $ok ? "PASS" : "FAIL", time - $start, $command,
            $reason eq "" ? "" : " [$reason]", $last;
        close $row or die "close row: $!";
        exit($ok ? 0 : 1);
    ' "$work/$count" "$1" &
    pids="$pids $!"
}

check 'python3 vendor/append-only/verify.py --selftest'
check 'python3 scripts/phase0-check-pins.py'
check 'node plugins/aukora-kira/lib/wasm-cell/courts/harness/wasm-proposal-cell/run.mjs'
check 'node tests/kira-diamond-cold.test.mjs'
check 'node tests/public-evidence.test.mjs'
check 'node tests/receipt-v3.test.mjs'
check 'node tests/aukora-aumlok-verify.test.mjs'
check 'node tests/aukora-dual-verifier.test.mjs'
check 'node tests/aukora-precard-check.test.mjs'
check 'node tests/aukora-approval-roundtrip.test.mjs'
check 'node tests/aukora-trusted-state.test.mjs'
check 'node tests/aukora-airlock.test.mjs'
check 'node tests/aukora-aumlok-cold-root.test.mjs'
check 'node tests/aukora-gate-require-grant.test.mjs'
check 'node tests/kira-control-admission.test.mjs'
check 'node tests/aukora-restore-scope.test.mjs'
check 'node tests/aukora-witness-four.test.mjs'
check 'node tests/kira-consolidate.test.mjs'
check 'python3 vendor/aukora-membrane/minimal/tour.py'
check 'node vendor/authority/conformance.mjs'
check 'node scripts/aukora/box-confinement-check.mjs'

index=0
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
perl -MTime::HiRes=time -e '
    printf "TOTAL %.2fs | %d/%d passed", time - $ARGV[0], $ARGV[1] - $ARGV[2], $ARGV[1];
    print " | logs: $ARGV[3]" if $ARGV[2];
    print "\n";
' "$started" "$count" "$failed" "$work"
[ "$failed" -eq 0 ]
