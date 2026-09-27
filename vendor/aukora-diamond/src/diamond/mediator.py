"""Structural composition mediator — required provider, fail-closed.

Loader construction requires a MediatorProvider. Absence raises
CompositionError before any grant path. disable() / remove_provider()
causes activate to refuse with MEDIATOR_OFF before grant evaluation.

Optional strict patent-license policy: env AUKORA_STRICT_PATENT_LICENSE=1
or construct with require_patent_license=True. When set, Loader.activate
also requires a valid unconsumed aukora-patent-license/v1 grant. This is
authorization plumbing for conforming practice — not DRM over forks.

This is not a Cordis broker. Evidence never authorizes. Identity never
crowns. Grants authorize.
"""

from __future__ import annotations

import os

_ENV_OFF = {"0", "off", "false", "no", "disabled"}
_ENV_ON = {"1", "true", "yes", "on"}


class CompositionError(TypeError):
    """Loader cannot be built or activated without a mediator provider."""

    CODE = "MEDIATOR_REQUIRED"


class MediatorError(ValueError):
    """Named refusal when the mediator is deselected."""

    CODE = "MEDIATOR_OFF"


def env_enabled() -> bool:
    raw = os.environ.get("AUKORA_MEDIATOR", "1").strip().lower()
    return raw not in _ENV_OFF


def env_strict_patent_license() -> bool:
    raw = os.environ.get("AUKORA_STRICT_PATENT_LICENSE", "0").strip().lower()
    return raw in _ENV_ON


class MediatorProvider:
    """Sole structural gate. Must be passed into Loader.__init__."""

    def __init__(
        self,
        *,
        enabled: bool | None = None,
        require_patent_license: bool | None = None,
    ):
        if enabled is None:
            enabled = env_enabled()
        self._enabled = bool(enabled)
        self._present = True
        if require_patent_license is None:
            require_patent_license = env_strict_patent_license()
        self._require_patent_license = bool(require_patent_license)

    def disable(self) -> None:
        self._enabled = False

    def enable(self) -> None:
        self._enabled = True

    def remove(self) -> None:
        """Remove the sole provider — subsequent require() refuses."""
        self._present = False
        self._enabled = False

    def set_require_patent_license(self, value: bool) -> None:
        self._require_patent_license = bool(value)

    @property
    def present(self) -> bool:
        return self._present

    @property
    def enabled(self) -> bool:
        return self._present and self._enabled

    @property
    def require_patent_license(self) -> bool:
        """True when activate must consume a patent-license grant."""
        return self._require_patent_license

    def require(self) -> None:
        """Refuse before grant evaluation when off or removed."""
        if not self._present or not self._enabled:
            raise MediatorError(
                "MEDIATOR_OFF: mediator disabled — no new governed effects"
            )


def require_provider(mediator: MediatorProvider | None) -> MediatorProvider:
    """Structural check at Loader construction time."""
    if mediator is None:
        raise CompositionError(
            "MEDIATOR_REQUIRED: Loader requires a MediatorProvider "
            "(construct with mediator=MediatorProvider())"
        )
    if not isinstance(mediator, MediatorProvider):
        raise CompositionError(
            "MEDIATOR_REQUIRED: mediator must be a MediatorProvider instance"
        )
    return mediator


_ORIGINAL_REQUIRE = MediatorProvider.require


def verify_mediator_integrity(mediator: object) -> None:
    """Refuse a mediator whose gate has been swapped or selectively widened.

    This catches three things, all of which are in-process substitutions:

      1. a subclass that overrides require()/enabled/present to pass
      2. a monkey-patched require() on the instance or the class
      3. an implementation replacement that is not a MediatorProvider

    It does NOT close them. Python cannot give us an immutable object: an
    attacker running code in this process can re-patch whatever we check.
    The honest ceiling is therefore PYTHON_RUNTIME_TCB + MEDIATOR_INPROCESS,
    printed on every activate. Closing this needs a host boundary (separate
    process / OS principal), which this toy does not have and does not claim.
    """
    from diamond.refuse_codes import CEILING_MEDIATOR_INPROCESS, CEILING_PYTHON_TCB

    if type(mediator) is not MediatorProvider:
        raise MediatorError(
            f"MEDIATOR_INTEGRITY: expected exactly MediatorProvider, got "
            f"{type(mediator).__name__} ({CEILING_MEDIATOR_INPROCESS})"
        )
    instance_require = mediator.__dict__.get("require")
    if instance_require is not None and getattr(instance_require, "__func__", None) is not (
        MediatorProvider.require
    ):
        raise MediatorError(
            f"MEDIATOR_INTEGRITY: instance require() replaced "
            f"({CEILING_MEDIATOR_INPROCESS})"
        )
    if MediatorProvider.require is not _ORIGINAL_REQUIRE:
        raise MediatorError(
            f"MEDIATOR_INTEGRITY: MediatorProvider.require patched "
            f"({CEILING_PYTHON_TCB})"
        )
    for name in ("enabled", "present"):
        prop = getattr(type(mediator), name, None)
        if not isinstance(prop, property):
            raise MediatorError(
                f"MEDIATOR_INTEGRITY: {name} is no longer a property "
                f"({CEILING_MEDIATOR_INPROCESS})"
            )
    if not callable(getattr(mediator, "require", None)):
        raise MediatorError(
            f"MEDIATOR_INTEGRITY: require() not callable ({CEILING_MEDIATOR_INPROCESS})"
        )
