#!/usr/bin/env python3
"""The composition mediator — an on/off gate whose OFF state fails closed.

DOCTRINE, AND WHERE IT COMES FROM. The sealed control plane this brick follows
states it in one line: mediator-off means no new governed effects. This module
is that line, and it is deliberately a single boolean rather than something
more expressive. An OFF that can be argued with is not an OFF.

WHY `MEDIATOR_OFF` IS THE TOY'S OWN STRING. An operator grepping logs across
both systems should see the same word for the same state. The constant is
imported from `refusals.py` where it is spelled once, and the reason line that
accompanies it says the same thing the toy says.

WHAT THIS IS NOT, AND THE DISTINCTION IS THE WHOLE POINT. This is not a Cordis
broker, not a capability system, not a process boundary, and not an authority.
It is one process-local flag consulted immediately before a governed effect is
applied. It prevents *this* loader, in *this* process, from applying a
composition transition while it is off. It cannot prevent another process, a
different build, or a caller who imports `loader` and skips this module from
doing anything at all. A flag inside the thing it constrains is a fail-closed
default, not an enforcement boundary, and no text in this repository should
describe it as one.

The default is ON, and the ways to turn it off are deliberately few and greppable:
the `AUKORA_MEDIATOR` environment variable, or an explicit constructor argument.
"""
from __future__ import annotations

import os

from refusals import MEDIATOR_OFF, CompositionRefusal

#: Values of AUKORA_MEDIATOR that mean OFF. Anything else — including an empty
#: string and an unrecognised value like "yes" or "banana" — means ON, which is
#: the one place this module prefers a permissive default. The reason is that the
#: variable is read in a context where an operator sets it to stop things: a typo
#: that silently disabled composition would be a surprise, while a typo that
#: silently left it enabled is the documented default. OFF must be spelled.
_OFF_VALUES = frozenset({"0", "off", "false", "no", "disabled"})

#: The environment variable's name, spelled here once so it can be grepped.
ENV_VAR = "AUKORA_MEDIATOR"

#: The state word this module prints. Lowercase, because it is a state and not a code.
ON = "on"
OFF = "off"


def env_state(raw: str | None = None) -> str:
    """The state the environment asks for. `raw=None` reads the environment."""
    value = (os.environ.get(ENV_VAR, "1") if raw is None else raw)
    return OFF if str(value).strip().lower() in _OFF_VALUES else ON


def resolve_state(explicit: bool | None = None, raw: str | None = None) -> str:
    """An explicit argument wins over the environment, because a caller that made
    a decision should not be silently overridden by an ambient variable."""
    if explicit is None:
        return env_state(raw)
    return ON if explicit else OFF


class Mediator:
    """The gate. Construct with an explicit state for tests, or read the environment."""

    def __init__(self, enabled: bool | None = None, raw: str | None = None):
        self.state = resolve_state(enabled, raw)
        self.source = "argument" if enabled is not None else f"env:{ENV_VAR}"

    @property
    def enabled(self) -> bool:
        return self.state == ON

    def describe(self) -> str:
        return f"MEDIATOR: {self.state} (from {self.source})"

    def require_enabled(self) -> None:
        """Refuse when the mediator is off. Call immediately before applying a
        governed effect, never after: checking afterwards would mean the effect
        happened and was then reported as refused, which is the failure mode this
        method exists to make impossible."""
        if not self.enabled:
            raise CompositionRefusal(
                MEDIATOR_OFF,
                "mediator is off — no new governed effects (set "
                f"{ENV_VAR} to a value other than {sorted(_OFF_VALUES)} to turn it on)",
            )
