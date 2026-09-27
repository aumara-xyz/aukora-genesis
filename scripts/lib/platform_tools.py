"""platform_tools.py — alpha-26: the PYTHON side of the one shared platform-tool seam.

Its twin is scripts/lib/platform-tools.mjs, and they exist separately only because the callers are written in two
languages; the ANSWER must not differ between them. `lsof`, `launchctl` and `footprint` are macOS instruments that are
absent in the Linux container, and each caller used to make its own guess — which is why the same absence arrived as
`FileNotFoundError: 'lsof'` in one file, a silent pass in another, and a correct skip in a third.

THREE ANSWERS, AND ONLY THREE:
  AVAILABLE  the tool is on PATH (or named by its override). Use it.
  STUBBED    AUKORA_LSOF_BIN / AUKORA_LAUNCHCTL_BIN / AUKORA_FOOTPRINT_BIN names a stand-in. The override WINS over the
             platform, which is how a court stands in for a tool it does not want to run for real.
  ABSENT     nothing to run: the caller gets None and a NOT RUN line NAMING the tool, its purpose and the variable
             that would stub it. It never raises, because a helper that crashed while reporting a missing tool would
             be the bug it was written to remove.
"""
from __future__ import annotations

import os
import shutil
from typing import NamedTuple, Optional

TOOLS = {
    'lsof': ('AUKORA_LSOF_BIN', 'which process holds a TCP port, so a listener can be attributed rather than guessed'),
    'launchctl': ('AUKORA_LAUNCHCTL_BIN', 'load and unload launchd jobs, so a desktop cutover can be started and stopped'),
    'footprint': ('AUKORA_FOOTPRINT_BIN', 'the memory footprint of a live process, so a launch can be measured instead of assumed'),
}


class UnknownPlatformTool(KeyError):
    """Asked about a tool this seam does not know — a programming error, not a host condition."""


class PlatformTool(NamedTuple):
    name: str
    available: bool
    bin: Optional[str]
    source: str          # 'override' | 'path' | 'absent'
    purpose: str
    env: str


def platform_tool(name: str, env: Optional[dict] = None) -> PlatformTool:
    """Resolve one tool. Never raises for absence; raises only for a name it does not know."""
    if name not in TOOLS:
        raise UnknownPlatformTool(name)
    env = os.environ if env is None else env
    var, purpose = TOOLS[name]
    override = env.get(var) or ''
    if override:
        if os.path.isfile(override) and os.access(override, os.X_OK):
            return PlatformTool(name, True, override, 'override', purpose, var)
        return PlatformTool(name, False, override, 'absent', purpose, var)
    found = shutil.which(name)
    if found:
        return PlatformTool(name, True, found, 'path', purpose, var)
    return PlatformTool(name, False, None, 'absent', purpose, var)


def platform_tool_skip(name: str, env: Optional[dict] = None, purpose: Optional[str] = None) -> Optional[str]:
    """The NOT RUN line, or None when the tool IS available.

    Returning None when the host can measure is the point: a function whose job is to say "this host cannot measure X"
    must not say it on a host that can, or a reader learns to distrust the line that matters.

    `purpose` OVERRIDES the default one MEASURED INTO PLACE: the table's sentence for `lsof` is about attributing a
    TCP port, and a call site that runs `lsof +D` to list open FILES under a directory needs a line that describes
    what IT was doing. The tool name and the variable stay the seam's; only the sentence changes.
    """
    tool = platform_tool(name, env)
    if tool.available:
        return None
    why = tool.purpose if purpose is None else purpose
    return (f'NOT RUN: {tool.name}-unavailable — {tool.name} is not on PATH; {why}. '
            f'Set {tool.env} to a stand-in to exercise this arm on this host.')


def require_platform_tool(name: str, env: Optional[dict] = None, quiet: bool = False,
                          purpose: Optional[str] = None) -> Optional[str]:
    """The tool's path, or None after SAYING SO. It does not exit: the caller decides whether to stop."""
    tool = platform_tool(name, env)
    if tool.available:
        return tool.bin
    if not quiet:
        print(platform_tool_skip(name, env, purpose))
    return None
