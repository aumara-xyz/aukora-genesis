#!/usr/bin/env python3
"""Run the REAL consumer under an enforced import guard and a verdict guard.

    python3 isolation_probe.py --closure <dir> --target <dir> --consumer <script> \
                               --expect-verdict verified [--import-outside <module>] \
                               [-- <consumer arguments...>]

WHY THIS IS NOT A DIAGNOSTIC. An earlier version printed the modules it found outside the closure and
then exited 0 — a report, not a control, and a harness that lists a hole and passes is a harness that
certifies the hole. Three things are ENFORCED here, each with its own named failure:

  DEPENDENCY CLOSURE   every import RESOLVED during the consumer's run is recorded, and one that
                       resolves outside the staged closure and the standard library is
                       `ISOLATION_IMPORT_OUTSIDE_CLOSURE`. This is evidence about the dependency
                       closure of one invocation. It is NOT a claim of OS-level confinement: a
                       process can still open sockets, read files and spawn children, and none of
                       that is measured here.
  CONSUMER OUTCOME     the consumer must EXIT SUCCESSFULLY and must PRINT the verdict the caller
                       expects (`--expect-verdict`), or the probe refuses with `CONSUMER_EXIT_NONZERO`
                       / `CONSUMER_VERDICT_NOT_OBSERVED`. A consumer that crashed is not evidence of
                       anything, and in particular it is NOT counted as import-control detection.
  CLOSED ALLOWANCE     the standard-library allowance is the interpreter's OWN standard library and
                       extension directories. Third-party package roots (`site-packages`, `purelib`,
                       `platlib`) and broad interpreter prefixes are NOT allowed: an unlisted
                       dependency installed beside the interpreter is still an outside import.

HOW IMPORTS ARE RECORDED, AND WHY NOT FROM `sys.modules`. A module that is imported and then removed
from the module cache leaves no trace in a final snapshot, and an audit hook that only inspects
`sys.modules` sees nothing before the first import is committed. Both holes were measured. So the
primary mechanism is a META-PATH FINDER placed in front of the import machinery: it resolves every
import through the same finders that would have handled it, records the resolved origin at that
moment, and hands the spec back unchanged. The record therefore survives cache deletion, and the
audit hook (kept as a second witness) covers imports that bypass the meta path.
"""
from __future__ import annotations

import argparse
import importlib.machinery
import importlib.util
import json
import os
import runpy
import sys
import sysconfig
from pathlib import Path

#: An import resolved outside the closure and the standard library.
ISOLATION_FAILURE = "ISOLATION_IMPORT_OUTSIDE_CLOSURE"
#: The consumer did not exit successfully, so the run is evidence of nothing.
CONSUMER_EXIT_FAILURE = "CONSUMER_EXIT_NONZERO"
#: The consumer exited 0 but never printed the verdict the caller required.
CONSUMER_VERDICT_FAILURE = "CONSUMER_VERDICT_NOT_OBSERVED"
#: The probe could not establish the run at all (missing closure, target or consumer).
SETUP_FAILURE = "ISOLATION_SETUP_FAILED"


class IsolationRefusal(Exception):
    """A named refusal about the run. `code` is a stable string."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


def stdlib_roots() -> list[Path]:
    """The interpreter's OWN standard library and extension directories, and nothing wider.

    MEASURED DEFECT this function exists to close: an earlier version also trusted `purelib`,
    `platlib` and the whole interpreter prefix. A disposable virtual environment keeps its
    third-party packages under `<venv>/lib/pythonX.Y/site-packages`, which is exactly where
    `purelib` points — so an unlisted dependency imported from there was classified as standard
    library and the run reported GREEN with `outside=0`. A control that allows third-party package
    roots is not a dependency-closure control.

    The extension directories are taken from the interpreter's own extension modules rather than
    guessed from `lib-dynload` under one prefix: a framework build places them somewhere sysconfig's
    `stdlib` does not name, and building the set from `*.py` files alone is what mislabelled the
    standard-library `binascii` in the first place.
    """
    roots: list[Path] = []
    paths = sysconfig.get_paths()
    for key in ("stdlib", "platstdlib"):
        value = paths.get(key)
        if value:
            roots.append(Path(value).resolve())
    # Where this interpreter's C extensions actually live, measured from a module that IS one.
    try:
        import binascii  # noqa: PLC0415 - deliberately late, and deliberately a real extension module

        if getattr(binascii, "__file__", None):
            roots.append(Path(binascii.__file__).resolve().parent)
    except ImportError:  # pragma: no cover - an interpreter without binascii is not one we support
        pass
    for probe in ("_socket", "array", "math"):
        module = sys.modules.get(probe)
        file = getattr(module, "__file__", None) if module is not None else None
        if file:
            roots.append(Path(file).resolve().parent)

    forbidden = []
    for key in ("purelib", "platlib"):
        value = paths.get(key)
        if value:
            forbidden.append(Path(value).resolve())

    # A third-party root that happens to sit INSIDE a standard-library root would be allowed by the
    # containment test below, so it is removed here by name instead of trusted to layout.
    allowed = []
    for root in roots:
        if any(root == bad or bad in root.parents for bad in forbidden):
            continue
        if any(bad == root or bad in root.parents for bad in forbidden):
            continue
        if root not in allowed:
            allowed.append(root)
    return allowed


def _classify_origin(resolved: str, closure: Path, stdlib: list[Path],
                     forbidden: list[Path]) -> str:
    """`closure`, `stdlib`, or `outside`, decided by the RESOLVED origin."""
    path = Path(resolved)
    if path == closure or closure in path.parents:
        return "closure"
    if any(path == bad or bad in path.parents for bad in forbidden):
        return "outside"
    if any(path == root or root in path.parents for root in stdlib):
        return "stdlib"
    return "outside"


def _forbidden_roots() -> list[Path]:
    """Third-party package roots, named so they can be refused even when nested in a stdlib root."""
    roots = []
    for key in ("purelib", "platlib"):
        value = sysconfig.get_paths().get(key)
        if value:
            roots.append(Path(value).resolve())
    return roots


class RecordingFinder:
    """A meta-path finder that resolves every import and RECORDS where it lands.

    It is placed in front of the import machinery, resolves through the same finders that would have
    handled the import, records the origin, and returns the spec unchanged. Because the record is
    taken at resolution time, it survives the module being deleted from `sys.modules` afterwards —
    the hole that a final cache snapshot cannot see.
    """

    def __init__(self, closure: Path, stdlib: list[Path], forbidden: list[Path]) -> None:
        self.closure = closure
        self.stdlib = stdlib
        self.forbidden = forbidden
        self.outside: list[tuple[str, str]] = []
        self.resolved_count = 0
        self._delegates = [finder for finder in sys.meta_path if finder is not self]

    def find_spec(self, fullname, path=None, target=None):  # noqa: D102 - the import protocol
        for finder in self._delegates:
            try:
                # `find_spec` is the modern protocol; a couple of legacy finders only offer
                # `find_module`, and the import system would call that path for them anyway.
                find_spec = getattr(finder, "find_spec", None)
                spec = find_spec(fullname, path, target) if find_spec is not None else None
            except Exception:  # noqa: BLE001 - a finder that raises is not this probe's business
                continue
            if spec is None:
                continue
            self.resolved_count += 1
            origin = getattr(spec, "origin", None)
            if isinstance(origin, str) and origin not in ("built-in", "frozen") and origin:
                try:
                    resolved = str(Path(origin).resolve())
                except (OSError, ValueError):
                    resolved = origin
                if _classify_origin(resolved, self.closure, self.stdlib, self.forbidden) == "outside":
                    entry = (fullname, resolved)
                    if entry not in self.outside:
                        self.outside.append(entry)
            return spec
        return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="run the consumer under an enforced import guard")
    parser.add_argument("--closure", required=True, help="the staged closure directory")
    parser.add_argument("--target", required=True, help="the directory the consumer must run FROM")
    parser.add_argument("--consumer", required=True, help="the consumer script to execute")
    parser.add_argument("--import-outside", default=None,
                        help="import this module before the consumer (NEGATIVE CONTROL ONLY)")
    parser.add_argument("--expect-verdict", default=None,
                        help="the verdict line the consumer MUST print, e.g. 'verified'")
    parser.add_argument("--json", action="store_true")
    # The consumer's own flags are NOT this tool's flags. Everything after a literal `--` is passed
    # through verbatim; parsing it with argparse would make `--record` an error of the probe.
    raw = list(argv if argv is not None else sys.argv[1:])
    if "--" in raw:
        cut = raw.index("--")
        probe_args, consumer_argv = raw[:cut], raw[cut + 1:]
    else:
        probe_args, consumer_argv = raw, []
    args = parser.parse_args(probe_args)

    closure = Path(args.closure).resolve()
    target = Path(args.target).resolve()
    consumer = Path(args.consumer).resolve()
    report: dict = {
        "closure": str(closure), "target": str(target), "consumer": str(consumer),
        "consumerExitStatus": None, "expectedVerdict": args.expect_verdict,
        "verdictObserved": False, "outsideResolvedDuringRun": [], "outsideInFinalSnapshot": [],
        "outsideImportsSeenByTheAuditHook": [], "resolvedImportsObserved": 0,
        "stdlibRoots": [], "forbiddenRoots": [],
    }

    def finish(code: int, lines: list[str]) -> int:
        for line in lines:
            print(line)
        if args.json:
            print("PROBE-JSON-BEGIN")
            print(json.dumps(report, indent=2, sort_keys=True))
            print("PROBE-JSON-END")
        return code

    try:
        if not closure.is_dir():
            raise IsolationRefusal(SETUP_FAILURE, f"the closure directory does not exist: {closure}")
        if not target.is_dir():
            raise IsolationRefusal(SETUP_FAILURE, f"the target directory does not exist: {target}")
        if not consumer.is_file():
            raise IsolationRefusal(SETUP_FAILURE, f"the consumer script does not exist: {consumer}")
        os.chdir(target)
        sys.path.insert(0, str(closure))
    except IsolationRefusal as refusal:
        report["refusal"] = {"code": refusal.code, "detail": refusal.detail}
        return finish(2, [f"ISOLATION: {refusal.code}", f"  {refusal.detail}",
                          "ISOLATION RESULT: RED"])
    except OSError as error:
        report["refusal"] = {"code": SETUP_FAILURE, "detail": str(error)}
        return finish(2, [f"ISOLATION: {SETUP_FAILURE}", f"  {error}", "ISOLATION RESULT: RED"])

    stdlib = stdlib_roots()
    forbidden = _forbidden_roots()
    report["stdlibRoots"] = [str(root) for root in stdlib]
    report["forbiddenRoots"] = [str(root) for root in forbidden]

    # ── the controlled import, before the guard is installed and before the consumer runs ──────
    if args.import_outside:
        import importlib  # noqa: PLC0415

        importlib.import_module(args.import_outside)

    # ── the guard: resolution is recorded by a finder, not read from a cache afterwards ────────
    recorder = RecordingFinder(closure, stdlib, forbidden)
    sys.meta_path.insert(0, recorder)
    seen_by_hook: list[tuple[str, str]] = []

    def audit(event: str, event_args: tuple) -> None:
        if event != "import":
            return
        values = list(event_args) + [None] * 5
        name, filename = values[0], values[1]
        if not isinstance(name, str) or not isinstance(filename, str) or not filename:
            return
        try:
            resolved = str(Path(filename).resolve())
        except (OSError, ValueError):
            return
        if _classify_origin(resolved, closure, stdlib, forbidden) == "outside":
            entry = (name.split(".")[0], resolved)
            if entry not in seen_by_hook:
                seen_by_hook.append(entry)

    sys.addaudithook(audit)

    # ── the consumer's output is TEE'd, so the verdict it prints is evidence the probe can check ─
    class Tee:
        def __init__(self, stream) -> None:
            self.stream = stream
            self.lines: list[str] = []

        def write(self, text: str) -> int:
            self.lines.append(text)
            return self.stream.write(text)

        def flush(self) -> None:
            self.stream.flush()

        def __getattr__(self, name):
            return getattr(self.stream, name)

    tee = Tee(sys.stdout)
    saved_stdout = sys.stdout
    saved_argv = sys.argv
    consumer_status = 0
    raised: str | None = None
    sys.stdout = tee
    try:
        sys.argv = [str(consumer)] + list(consumer_argv)
        runpy.run_path(str(consumer), run_name="__main__")
    except SystemExit as exit_request:
        consumer_status = int(exit_request.code or 0)
    except BaseException as error:  # noqa: BLE001 - the consumer's crash is REPORTED, not disguised
        consumer_status = 70
        raised = f"{type(error).__name__}: {error}"
    finally:
        sys.stdout = saved_stdout
        sys.argv = saved_argv

    output = "".join(tee.lines)
    report["consumerExitStatus"] = consumer_status
    report["consumerRaised"] = raised
    report["verdictObserved"] = (f"EXPECTATION: {args.expect_verdict} OBSERVED" in output
                                 if args.expect_verdict else True)
    report["outsideResolvedDuringRun"] = [list(entry) for entry in recorder.outside]
    report["outsideImportsSeenByTheAuditHook"] = [list(entry) for entry in seen_by_hook]
    report["resolvedImportsObserved"] = recorder.resolved_count

    snapshot = []
    for name in sorted(sys.modules):
        if name.split(".")[0] in ("isolation_probe", "__main__"):
            continue
        module = sys.modules[name]
        spec = getattr(module, "__spec__", None)
        origin = getattr(spec, "origin", None) if spec is not None else None
        file = getattr(module, "__file__", None)
        resolved = origin if isinstance(origin, str) and origin not in ("built-in", "frozen") else file
        if not isinstance(resolved, str) or not resolved:
            continue
        try:
            path = str(Path(resolved).resolve())
        except (OSError, ValueError):
            continue
        if _classify_origin(path, closure, stdlib, forbidden) == "outside" and [name, path] not in snapshot:
            snapshot.append([name, path])
    report["outsideInFinalSnapshot"] = snapshot

    outside = [tuple(entry) for entry in report["outsideResolvedDuringRun"]]
    for entry in report["outsideImportsSeenByTheAuditHook"]:
        if tuple(entry) not in outside:
            outside.append(tuple(entry))
    for entry in snapshot:
        if tuple(entry) not in outside:
            outside.append(tuple(entry))

    lines = [
        "",
        "── ISOLATION PROBE (the run above, classified by RESOLVED ORIGIN) ──",
        f"   closure                        : {closure}",
        f"   cwd at consumer run time       : {target}",
        f"   consumer exit status           : {consumer_status}"
        + (f" ({raised})" if raised else ""),
        f"   expected consumer verdict      : {args.expect_verdict or '(none required)'}",
        f"   verdict observed               : {report['verdictObserved']}",
        f"   imports resolved during the run: {recorder.resolved_count}",
        f"   modules from the closure       : "
        f"{sum(1 for name in sys.modules if _module_in_closure(name, closure))}",
        f"   modules from the interpreter   : "
        f"{sum(1 for name in sys.modules if _module_in_stdlib(name, stdlib, forbidden))}",
        f"   outside imports RESOLVED       : {len(report['outsideResolvedDuringRun'])}"
        + (f" {[name for name, _ in report['outsideResolvedDuringRun']]}"
           if report["outsideResolvedDuringRun"] else ""),
        f"   outside modules in the final cache: {len(snapshot)}"
        + (f" {[name for name, _ in snapshot]}" if snapshot else ""),
    ]
    for name, resolved in outside:
        lines.append(f"   OUTSIDE: {name} -> {resolved}")

    # ── the verdict of THIS probe, in the order that matters ─────────────────────────────────
    if consumer_status != 0 or raised is not None:
        report["refusal"] = {"code": CONSUMER_EXIT_FAILURE,
                             "detail": f"the consumer exited {consumer_status}"
                                       + (f" after raising {raised}" if raised else "")}
        lines.append(f"ISOLATION: {CONSUMER_EXIT_FAILURE}")
        lines.append("  The consumer did not complete successfully, so this run is evidence of "
                     "nothing: it is NOT counted as import-control detection, in either direction. "
                     "Fix the consumer run first.")
        return finish(4, lines + ["ISOLATION RESULT: RED"])
    if args.expect_verdict and not report["verdictObserved"]:
        report["refusal"] = {"code": CONSUMER_VERDICT_FAILURE,
                             "detail": f"the consumer never printed "
                                       f"'EXPECTATION: {args.expect_verdict} OBSERVED'"}
        lines.append(f"ISOLATION: {CONSUMER_VERDICT_FAILURE}")
        lines.append(f"  The consumer exited 0 but never printed the verdict this run required "
                     f"({args.expect_verdict!r}). A run whose outcome was not observed cannot carry "
                     f"an isolation claim.")
        return finish(4, lines + ["ISOLATION RESULT: RED"])
    if outside:
        report["refusal"] = {"code": ISOLATION_FAILURE,
                             "detail": f"{len(outside)} import(s) resolved outside the staged closure "
                                       f"and the standard library"}
        lines.append(f"ISOLATION: {ISOLATION_FAILURE}")
        lines.append(f"  {len({name for name, _ in outside})} module(s) resolved outside the staged "
                     f"closure and the standard library.")
        lines.append("  The consumer's own verification is NOT accepted as evidence that this run is "
                     "isolated: an outside import is a claim about what the run could reach.")
        lines.append("  NOTE: the consumer's verification SUCCEEDED on this run — which is exactly "
                     "the case this control exists for. A green verification does not make an "
                     "unreachable closure true.")
        lines.append("  SCOPE: this is dependency-closure evidence. It is not a claim of OS "
                     "confinement: sockets, files and child processes are not measured here.")
        return finish(3, lines + ["ISOLATION RESULT: RED"])
    lines.append("ISOLATION RESULT: GREEN (nothing outside the closure and the standard library was "
                 "resolved, and the consumer's expected verdict was observed)")
    return finish(0, lines)


def _module_in_closure(name: str, closure: Path) -> bool:
    module = sys.modules.get(name)
    file = getattr(module, "__file__", None)
    if not file:
        return False
    try:
        path = Path(file).resolve()
    except (OSError, ValueError):
        return False
    return path == closure or closure in path.parents


def _module_in_stdlib(name: str, stdlib: list[Path], forbidden: list[Path]) -> bool:
    module = sys.modules.get(name)
    spec = getattr(module, "__spec__", None)
    origin = getattr(spec, "origin", None) if spec is not None else None
    file = getattr(module, "__file__", None)
    resolved = origin if isinstance(origin, str) and origin not in ("built-in", "frozen") else file
    if not isinstance(resolved, str) or not resolved:
        return origin in ("built-in", "frozen")
    try:
        path = Path(resolved).resolve()
    except (OSError, ValueError):
        return False
    return _classify_origin(str(path), Path("/nonexistent-closure"), stdlib, forbidden) == "stdlib"


if __name__ == "__main__":
    sys.exit(main())
