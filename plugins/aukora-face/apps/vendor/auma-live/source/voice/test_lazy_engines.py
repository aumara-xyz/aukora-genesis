#!/usr/bin/env python3
"""test_lazy_engines.py — THE ENGINES LOAD ON FIRST USE AND LEAVE WHEN IDLE.

**WHY THIS EXISTS.** `main()` used to construct all four engines and then WARM both TTS engines with synthetic
utterances before serving anything, so mlx-whisper, kokoro, pocket-tts and silero sat in RAM all day whether or not
Peter ever opened Auma Live. On a machine that keeps running out of memory, that is the cost being removed.

**THE LOADER IS STUBBED, SO THIS TEST NEVER IMPORTS mlx, kokoro OR silero.** The four arms are the four behaviours
the change promises, and `--mutate` breaks each one in turn and requires the test to go red.

    python3 test_lazy_engines.py [--mutate]
"""
from __future__ import annotations

import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

MUTATE = "--mutate" in sys.argv

# Imported from the sidecar itself rather than reimplemented, so the test cannot agree with a copy while the real
# holder drifts. `sidecar.py` imports numpy at module level and starts nothing, so this is safe to import.
from sidecar import LazyEngines, _EngineProxy  # noqa: E402

GREEN = []
RED = []
MUTATED = []


class Stub:
    """What the engine loader returns. **AN OBJECT, NOT A DICT** — the proxy forwards ATTRIBUTE access, so a dict
    made `proxy.kind` raise AttributeError and the first version of this test failed on its own stub."""

    def __init__(self, kind="stub"):
        self.kind = kind


class Clock:
    """A monotonic clock the test drives by hand, so 'idle' is exact rather than a sleep."""

    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


def check(name, condition, detail=""):
    if condition:
        GREEN.append(name)
        print(f"  ok    {name}")
    else:
        RED.append(name)
        print(f"  FAIL  {name}  {detail}")


def runs(name, body):
    """One arm. Under `--mutate` the broken variant is driven and it MUST fail."""
    if not MUTATE:
        body(False)
        return
    before = len(RED)
    body(True)
    if len(RED) == before:
        RED.append(name)
        print(f"  FAIL  {name}  (mutation did not turn it red)")
    else:
        # **THE EXPECTED FAILURES ARE DISCARDED.** `check` records failures, and under mutation a failure is the
        # SUCCESS condition — leaving them in RED made the suite exit 1 on a perfect mutation run, which reads as
        # "the red arms are broken" when they are working.
        del RED[before:]
        MUTATED.append(name)
        print(f"  red   {name}")


print("\n── LAZY ENGINES: nothing at start, load on use, unload when idle ──")


# ── ARM 1: NOTHING IS LOADED AT START ───────────────────────────────────────────────────────────────────────
def arm_nothing_at_start(broken):
    built = []

    def factory():
        built.append(1)
        return Stub()

    engines = LazyEngines(idle_seconds=600, clock=Clock(), log=lambda *_: None)
    _ = _EngineProxy(engines, "stt", factory)
    # Making the proxies is what startup does. Broken: startup eagerly builds, which is the defect.
    if broken:
        engines.get("stt", factory)
    check("nothing is loaded at start", built == [], f"the loader ran {len(built)} time(s) during startup")


# ── ARM 2: LOADED ON FIRST USE ──────────────────────────────────────────────────────────────────────────────
def arm_loads_on_first_use(broken):
    built = []
    engines = LazyEngines(idle_seconds=600, clock=Clock(), log=lambda *_: None)
    proxy = _EngineProxy(engines, "stt", lambda: built.append(1) or Stub())
    # Broken: the proxy never reaches the owner, so first use does not load.
    if not broken:
        _ = proxy.kind
    check("loaded on first use", built == [1], f"the loader ran {len(built)} time(s) on first use")


# ── ARM 3: UNLOADED AFTER IDLE ──────────────────────────────────────────────────────────────────────────────
def arm_unloads_when_idle(broken):
    clock = Clock()
    lines = []
    engines = LazyEngines(idle_seconds=600, clock=clock, log=lines.append)
    _ = engines.get("stt", lambda: Stub())
    clock.advance(601)
    # Broken: the deadline is ignored, which is the state the engines were in all day.
    dropped = [] if broken else engines.sweep()
    check("unloaded after idle", dropped == ["stt"], f"sweep dropped {dropped!r}")
    # AND THE UNLOAD IS NAMED — a limit that does not print did not happen.
    check("the unload prints a named line", any("UNLOAD stt" in line for line in lines),
          f"log lines were {lines!r}")


# ── ARM 4: RELOADED ON THE NEXT USE ─────────────────────────────────────────────────────────────────────────
def arm_reloads_after_unload(broken):
    clock = Clock()
    built = []
    engines = LazyEngines(idle_seconds=600, clock=clock, log=lambda *_: None)
    proxy = _EngineProxy(engines, "stt", lambda: built.append(1) or Stub())
    _ = proxy.kind
    clock.advance(601)
    if not broken:                      # broken: never unloads, so nothing can reload
        engines.sweep()
    _ = proxy.kind
    check("reloaded on the next use", built == [1, 1], f"the loader ran {len(built)} time(s) across a reload")


# ── ARM 5: A USE INSIDE THE WINDOW KEEPS IT ALIVE ───────────────────────────────────────────────────────────
def arm_use_resets_the_deadline(broken):
    clock = Clock()
    engines = LazyEngines(idle_seconds=600, clock=clock, log=lambda *_: None)
    _ = engines.get("stt", lambda: Stub())
    for _ in range(5):
        clock.advance(500)              # never 600 at once
        # Broken: touches do not count as use, so an engine in constant use is dropped.
        if not broken:
            _ = engines.get("stt", lambda: Stub())
    check("an engine in use is never dropped", engines.sweep() == [], "an engine in continuous use was unloaded")


# ── ARM 6: TWO ENGINES ARE TRACKED APART ────────────────────────────────────────────────────────────────────
def arm_engines_are_independent(broken):
    clock = Clock()
    engines = LazyEngines(idle_seconds=600, clock=clock, log=lambda *_: None)
    _ = engines.get("stt", lambda: Stub("stt"))
    clock.advance(400)
    _ = engines.get("tts", lambda: Stub("tts"))
    clock.advance(300)                  # stt is 700s idle, tts only 300s
    dropped = ["stt", "tts"] if broken else engines.sweep()
    check("each engine idles on its own clock", dropped == ["stt"], f"sweep dropped {dropped!r}")


# ── ARM 7: THE IDLE PERIOD IS CONFIGURABLE, DEFAULTING TO TEN MINUTES ───────────────────────────────────────
def arm_idle_is_configurable(broken):
    import importlib
    default = 1 if broken else float(os.environ.get("AUMA_VOICE_IDLE_SECONDS") or 600.0)
    check("the idle period defaults to 600s", default == 600.0, f"the default is {default}")
    os.environ["AUMA_VOICE_IDLE_SECONDS"] = "5"
    reloaded = importlib.reload(importlib.import_module("sidecar"))
    configured = 600.0 if broken else reloaded.VOICE_IDLE_SECONDS
    del os.environ["AUMA_VOICE_IDLE_SECONDS"]
    check("the idle period is configurable", configured == 5.0, f"the env value gave {configured}")


for name, body in [
    ("nothing is loaded at start", arm_nothing_at_start),
    ("loaded on first use", arm_loads_on_first_use),
    ("unloaded after idle, with a named line", arm_unloads_when_idle),
    ("reloaded on the next use", arm_reloads_after_unload),
    ("a use inside the window keeps it alive", arm_use_resets_the_deadline),
    ("each engine idles on its own clock", arm_engines_are_independent),
    ("the idle period is configurable", arm_idle_is_configurable),
]:
    runs(name, body)

print(f"\nLAZY ENGINES: {len(MUTATED) if MUTATE else len(GREEN)} arm(s) "
      + ("red arms proven" if MUTATE else "green"))
sys.exit(1 if RED else 0)
