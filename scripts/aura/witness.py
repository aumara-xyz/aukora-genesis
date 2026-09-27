#!/usr/bin/env python3
"""witness.py — a countersigning witness for retained observations.

    python3 scripts/aura/witness.py serve  --root DIR [--host 127.0.0.1] [--port N]
    python3 scripts/aura/witness.py pubkey --root DIR
    python3 scripts/aura/witness.py fetch  --url URL --chain-key KEY --size N --out DIR
                                           [--node-key FILE] [--expect-witness-pk HEX]
    python3 scripts/aura/witness.py sign   --root DIR --in FILE --out FILE [--key FILE]

WHAT A WITNESS IS HERE, AND WHAT IT IS NOT. A witness receives a retained observation, signs
it with a key of its own, and serves it back. That is all it does: it holds no log, appends
nothing, and reads nothing about the node that sent the observation. Its signature says "this
key saw these bytes at this size", which is a different statement from "this key agrees the
history is append-only" — that question belongs to the vendored court, and the witness never
answers it.

TWO KEYS ARE NOT TWO PRINCIPALS. On this host the witness runs as a separate process with its
own key file and its own root, and it is still the SAME principal: same UID, same machine, same
administrative control. A countersignature therefore adds a second *key* and not a second
party, and every verdict that used it keeps the label `RETAINER_SAME_OWNER`. Independent
custody needs a principal who is not this one; nothing here claims that.

WHY IT STILL EARNS ITS KEEP. A witness that must be reachable, and that refuses to rewrite what
it already signed, moves one specific failure out of the node's reach: the node can rewrite its
log and its local retained copy, and it still cannot make an unreachable witness answer, nor
make this witness sign a different observation for a size it already signed. That is why the
unreachable case must be `CONSISTENCY_UNCHECKED` and never a verdict, and why the fetch refuses
a countersignature that verifies under the NODE's own key: a node signing its own observation
is not a witness, it is the same party talking twice.

STORAGE, one file per stream and size. The path is the sanitized stream name plus a digest of
the whole key, so the mapping is injective and two streams cannot be made to share a path:

    <root>/witness.sk                          hex Ed25519 seed, mode 0600
    <root>/heads/<sanitized>-<keyDigest>/size-<N>.json
                                               {layout, chainKey, size, receivedAt,
                                                observation, witness:{…, sig}}

FIRST RETENTION WINS, ATOMICALLY. The store entry is created with `O_CREAT | O_EXCL`, so when
two retentions for the same stream and size race, exactly one creates the file and the others are
told which case they are in: `retained` (this call wrote it), `already-retained` (it did not
write, and the store already held exactly these bytes) or a named refusal because another writer
retained a *different* observation first. No caller is told it published when it did not.

EVERY READ-BACK IS CHECKED AGAINST THE REQUEST. An envelope is only served, fetched or accepted
if its own `chainKey`/`size` and the observation's `chainKey`/`treeSize` are the ones that were
asked for, so a store that was moved, restored from another stream, or answered by something that
is not this witness is refused by name — `witness-observation-is-not-what-was-asked-for` — rather
than filed under the identity the caller named.

BOUNDS ARE NAMED, PRINTED, AND REFUSE AS BOUNDS. Body size, stream count, sizes held per stream,
total store bytes and retention request rate each have a flag, each is printed at startup, and
each refuses with the bound and the observed value in the reason: a witness that is full must say
so, because anything that looks like an unreachable retainer would be read as
`CONSISTENCY_UNCHECKED` and lose the distinction this whole lane is built on.

`fetch` translates that envelope into `aukora-retainer-v1` (`layout`, `retainedAt`,
`observation`, plus a `witness` block) in the directory it is given, using
`scripts/phase0/retainer.py`'s own path convention, so `scripts/phase0/verify --retainer <dir>`
reads the countersigned head through its own code path, unmodified. Nothing is written when the
witness cannot be reached: an unreachable witness is CONSISTENCY_UNCHECKED, never a merge.
"""
from __future__ import annotations

import argparse
import hashlib
import http.server
import json
import os
import re
import socketserver
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
COMPOSITION_DIR = os.path.join(ROOT, "scripts", "composition")
for directory in (COMPOSITION_DIR,):
    if directory not in sys.path:
        sys.path.insert(0, directory)

import ed25519  # noqa: E402  (the accepted primitives, read-only use)
from jcs import canonicalize_bytes  # noqa: E402

WITNESS_LAYOUT = "aukora-aura-witness-v1"
RETAINER_LAYOUT = "aukora-retainer-v1"
ALGORITHM = "ed25519"
SAME_OWNER_NOTE = "RETAINER_SAME_OWNER"
KEY_NAME = "witness.sk"
DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")

#: What this witness will accept and hold, in one place. Every bound is named, printed at
#: startup, and refuses by name with the bound and the observed value in the reason — a bound
#: that is hit must read as a bound, never as an unreachable retainer, and never as a verdict.
#:
#: The defaults are sized for one installation's own stream: an observation is a few hundred
#: bytes, a stream grows by one size per settle, and a witness that is asked to hold a year of
#: settles at one per minute is still well under a hundred megabytes. An operator who needs more
#: says so with a flag, deliberately.
DEFAULT_BOUNDS = {
    "max_body_bytes": 512 * 1024,
    "max_streams": 32,
    "max_sizes_per_stream": 4096,
    "max_total_bytes": 64 * 1024 * 1024,
    "max_requests_per_minute": 240,
}


class Bounds:
    """The five resource bounds, with the flag names that set them."""

    FLAGS = {
        "max_body_bytes": "--max-body-bytes",
        "max_streams": "--max-streams",
        "max_sizes_per_stream": "--max-sizes-per-stream",
        "max_total_bytes": "--max-total-bytes",
        "max_requests_per_minute": "--max-requests-per-minute",
    }

    def __init__(self, **values):
        for name, default in DEFAULT_BOUNDS.items():
            value = values.get(name, default)
            if isinstance(value, bool) or not isinstance(value, int) or value < 1:
                raise WitnessRefusal("witness-bound-invalid", f"{name} must be a positive integer, got {value!r}")
            setattr(self, name, value)

    def line(self) -> str:
        return (f"body<={self.max_body_bytes}B streams<={self.max_streams} "
                f"sizes/stream<={self.max_sizes_per_stream} store<={self.max_total_bytes}B "
                f"rate<={self.max_requests_per_minute}/min")

    def as_dict(self) -> dict:
        return {name: getattr(self, name) for name in DEFAULT_BOUNDS}


class WitnessRefusal(Exception):
    """A refusal with a name, never a silent fallback and never a verdict."""

    def __init__(self, code: str, reason: str):
        super().__init__(f"{code}: {reason}")
        self.code = code
        self.reason = reason


def key_path(root: str) -> str:
    return os.path.join(os.path.abspath(root), KEY_NAME)


def now_ms() -> int:
    """When the witness received the observation, stamped in the envelope, never in the
    observation. The witness does not report the node's clock: it has no way to check it."""
    return int(time.time() * 1000)


def load_or_create_key(root: str) -> bytes:
    """This witness's own signing seed, created once and never regenerated on read."""
    path = key_path(root)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as handle:
            seed = bytes.fromhex(handle.read().strip())
        if len(seed) != 32:
            raise WitnessRefusal("witness-key-unusable", f"{path} does not hold a 32-byte seed")
        return seed
    seed, _public = ed25519.keygen()
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(seed.hex() + "\n")
    os.chmod(path, 0o600)
    return seed


def public_key(root: str) -> str:
    return ed25519.public_from_seed(load_or_create_key(root)).hex()


def head_relpath(chain_key: str, size: int) -> str:
    """Where the RETAINER layout expects a head: `heads/<sanitized>/size-<N>.json`.

    This is `scripts/phase0/retainer.py`'s convention, and `fetch` must keep writing it: the
    court reads the fetched copy through that lane's own reader, which sanitizes the same way.
    The witness's own store does NOT use this — see `store_relpath` for why.
    """
    safe = "".join(c if c.isalnum() or c in "-._" else "_" for c in chain_key)
    return os.path.join("heads", safe, f"size-{size}.json")


def store_relpath(chain_key: str, size: int) -> str:
    """Where THIS witness keeps a head: sanitized name plus a digest of the whole key.

    Sanitizing alone is lossy — `a:b` and `a_b` collapse to one directory — so two different
    streams could be made to share a path, and the second one's first retention would land in
    the first one's directory. Appending a digest of the full chain key makes the mapping
    injective: a collision is not merely detected on read-back, it cannot be constructed.
    """
    safe = "".join(c if c.isalnum() or c in "-._" else "_" for c in chain_key)[:64]
    return os.path.join("heads", f"{safe}-{hashlib.sha256(chain_key.encode('utf-8')).hexdigest()[:16]}",
                        f"size-{size}.json")


def signed_bytes(observation: dict) -> bytes:
    """What a countersignature covers: the observation's canonical bytes, and nothing else.

    The envelope is not signed, so translating the envelope between layouts cannot invalidate
    or silently re-point a signature: the bytes the witness signed are the bytes a reader
    re-derives from the observation it was handed.

    This is also why `retainedAt` is refused inside an observation: `scripts/phase0/retainer.py`
    strips that key when it reads an envelope, so signing a document that carries it would
    sign bytes the reader never sees, and the signature would be over a document nobody can
    reconstruct. The timestamp belongs to the envelope.
    """
    if "retainedAt" in observation:
        raise WitnessRefusal(
            "witness-observation-carries-envelope-field",
            "the observation carries retainedAt, which the retainer reader strips before the court "
            "sees it; signing it would sign bytes no reader can re-derive. Send the observation and "
            "let the envelope carry the timestamp.",
        )
    return canonicalize_bytes(observation)


def countersign(root: str, observation: dict, key_file: str | None = None) -> dict:
    seed = load_or_create_key(root) if key_file is None else bytes.fromhex(open(key_file, encoding="utf-8").read().strip())
    public = ed25519.public_from_seed(seed)
    signature = ed25519.sign(seed, signed_bytes(observation))
    return {
        "algorithm": ALGORITHM,
        "publicKey": public.hex(),
        "sig": signature.hex(),
        "signs": "jcs(observation)",
        "signedSha256": hashlib.sha256(signed_bytes(observation)).hexdigest(),
    }


def read_public_key(value: str) -> str:
    """A public key given either as 64 hex characters or as a path to a file holding one.

    Both spellings are accepted because both are real: the CLI takes a path (the state's
    `issuer.pk`), and a caller already holding the key hands over the key itself. Reading a
    key that is not there raises rather than returning None — a check that cannot run must
    not look like a check that passed.
    """
    candidate = value.strip()
    if DIGEST_RE.match(candidate):
        return candidate
    with open(value, encoding="utf-8") as handle:
        loaded = handle.read().strip()
    if not DIGEST_RE.match(loaded):
        raise WitnessRefusal("witness-key-unusable", f"{value} holds no 64-hex public key")
    return loaded


def verify_countersignature(envelope: dict, *, node_key: str | None = None, expect_witness_pk: str | None = None) -> dict:
    """Check the countersignature, and refuse one this node could have produced itself.

    Order matters: the refusal that a countersignature verifies under the NODE's own key comes
    first, because that case is not a weak witness, it is not a witness at all.
    """
    observation = envelope.get("observation")
    witness = envelope.get("witness")
    if not isinstance(observation, dict) or not isinstance(witness, dict):
        raise WitnessRefusal("witness-envelope-malformed", "the envelope carries no observation or no witness block")
    public_hex = witness.get("publicKey")
    signature_hex = witness.get("sig")
    if not isinstance(public_hex, str) or not DIGEST_RE.match(public_hex) or not isinstance(signature_hex, str):
        raise WitnessRefusal("witness-envelope-malformed", "the witness block names no usable key or signature")
    message = signed_bytes(observation)
    if not ed25519.verify(bytes.fromhex(public_hex), message, bytes.fromhex(signature_hex)):
        raise WitnessRefusal("witness-signature-invalid", f"the countersignature does not verify under {public_hex[:16]}…")
    if node_key is not None:
        node_public = read_public_key(node_key)
        if public_hex == node_public or ed25519.verify(bytes.fromhex(node_public), message, bytes.fromhex(signature_hex)):
            raise WitnessRefusal(
                "witness-signature-is-the-nodes-own",
                f"the countersignature verifies under the node's key {node_public[:16]}…, which is the same "
                "key the node already holds. A node countersigning its own observation is the same party "
                "talking twice, and this is refused rather than labelled a witness.",
            )
    if expect_witness_pk is not None and public_hex != read_public_key(expect_witness_pk):
        raise WitnessRefusal("witness-key-unexpected", f"the envelope was signed by {public_hex[:16]}…, not the expected {read_public_key(expect_witness_pk)[:16]}…")
    return {"publicKey": public_hex, "signedSha256": hashlib.sha256(message).hexdigest(), "algorithm": witness.get("algorithm")}


# ── the store: first retention wins, atomically, once per stream and size ───────────────────


def count_streams(root: str) -> int:
    heads = os.path.join(os.path.abspath(root), "heads")
    try:
        return sum(1 for name in os.listdir(heads) if os.path.isdir(os.path.join(heads, name)))
    except OSError:
        return 0


def count_sizes(root: str, chain_key: str, size: int) -> int:
    directory = os.path.dirname(os.path.join(os.path.abspath(root), store_relpath(chain_key, size)))
    try:
        return sum(1 for name in os.listdir(directory)
                   if name.startswith("size-") and name.endswith(".json"))
    except OSError:
        return 0


def store_bytes(root: str) -> int:
    total = 0
    heads = os.path.join(os.path.abspath(root), "heads")
    for directory, _names, files in os.walk(heads):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(directory, name))
            except OSError:
                continue
    return total


def check_bounds(root: str, chain_key: str, size: int, incoming: int, bounds: Bounds) -> None:
    """Refuse by name before any side effect. Every limit reports itself as a limit."""
    if incoming > bounds.max_body_bytes:
        raise WitnessRefusal(
            "witness-body-too-large",
            f"the request body is {incoming} bytes and this witness accepts at most "
            f"{bounds.max_body_bytes} ({Bounds.FLAGS['max_body_bytes']})",
        )
    path = os.path.join(os.path.abspath(root), store_relpath(chain_key, size))
    new_stream = not os.path.isdir(os.path.dirname(path))
    new_size = not os.path.exists(path)
    if new_stream and count_streams(root) + 1 > bounds.max_streams:
        raise WitnessRefusal(
            "witness-stream-limit",
            f"this witness holds {count_streams(root)} stream(s) and accepts at most "
            f"{bounds.max_streams} ({Bounds.FLAGS['max_streams']}); a new stream is refused "
            "rather than evicting one it already signed for",
        )
    if new_size and count_sizes(root, chain_key, size) + 1 > bounds.max_sizes_per_stream:
        raise WitnessRefusal(
            "witness-size-limit",
            f"this stream holds {count_sizes(root, chain_key, size)} size(s) and this witness "
            f"accepts at most {bounds.max_sizes_per_stream} per stream "
            f"({Bounds.FLAGS['max_sizes_per_stream']})",
        )
    if new_size and store_bytes(root) + incoming > bounds.max_total_bytes:
        raise WitnessRefusal(
            "witness-storage-limit",
            f"this witness holds {store_bytes(root)} bytes and accepts at most "
            f"{bounds.max_total_bytes} ({Bounds.FLAGS['max_total_bytes']}); a head that does not "
            "fit is refused, never accepted and then dropped",
        )


def store_observation(root: str, chain_key: str, size: int, observation: dict, *,
                      key_file: str | None = None, bounds: Bounds | None = None) -> dict:
    """Retain one observation, exactly once, with the first write winning.

    The check-then-write this replaces had a window: two first-retentions for the same stream and
    size could both find nothing, both sign, and the second would land on top of the first — so
    a caller could be told it published while the store held someone else's observation. The
    store is now created with `O_CREAT | O_EXCL`, which the kernel resolves atomically: exactly
    one writer creates the file, and every other writer is told which case it is in.

      retained         this call created the file; the store did not hold this size before
      already-retained this call did NOT write; the store already held exactly these bytes
      (refused)        another writer retained a DIFFERENT observation for this size, or a bound
                       was reached — both by name, with the observed value in the reason
    """
    bounds = bounds or Bounds()
    path = os.path.join(os.path.abspath(root), store_relpath(chain_key, size))

    # Build the bytes first: a witness that signs and then discovers it cannot write has told the
    # caller a signature exists for bytes it did not keep.
    envelope = {
        "layout": WITNESS_LAYOUT,
        "chainKey": chain_key,
        "size": size,
        "receivedAt": now_ms(),
        "observation": observation,
        "witness": countersign(os.path.abspath(root), observation, key_file),
    }
    blob = json.dumps(envelope, sort_keys=True, separators=(",", ":")).encode("utf-8") + b"\n"

    # The bounds are checked BEFORE the stream directory is created. Creating it first made every
    # stream look like one this witness already held, so the stream bound could never fire — which
    # is what a bound that is only ever tested in isolation would not have caught.
    check_bounds(os.path.abspath(root), chain_key, size, len(blob), bounds)
    os.makedirs(os.path.dirname(path), exist_ok=True)

    # Write the bytes to a temporary name first, then link it into place. Creating the FINAL name
    # exclusively would be atomic about the name and not about the content: a second caller that
    # found the name would read a half-written envelope. `os.link` fails with EEXIST and only ever
    # publishes a file that is already complete, so the loser always reads the winner's whole
    # observation — which is the difference between being told it lost and being told it is
    # malformed.
    handle, staged = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".first-retention-", suffix=".tmp")
    with os.fdopen(handle, "wb") as stream:
        stream.write(blob)
    try:
        os.link(staged, path)
    except FileExistsError:
        existing = read_observation(os.path.abspath(root), chain_key, size)
        if existing["observation"].get("root") == observation.get("root"):
            return {"envelope": existing, "outcome": "already-retained", "won": False, "path": path}
        raise WitnessRefusal(
            "witness-lost-first-retention",
            f"another writer retained a different observation for size {size} of {chain_key} "
            "first, so this one did not land. A witness that can be made to sign twice for one "
            "size is not a witness, and the loser is told it lost rather than told it published.",
        ) from None
    finally:
        if os.path.exists(staged):
            os.unlink(staged)
    return {"envelope": envelope, "outcome": "retained", "won": True, "path": path}


def read_observation(root: str, chain_key: str, size: int) -> dict:
    """Read one head back, and check it is the head that was asked for.

    Every read-back is checked against the REQUEST — the envelope's `chainKey` and `size` and the
    observation's own `chainKey` and `treeSize` — rather than trusting that the path it was found
    at names it. Without this, a store that collided, a file restored from the wrong stream, or a
    witness answering with a different stream's head would all be served as a plausible answer to
    a question nobody asked.
    """
    path = os.path.join(os.path.abspath(root), store_relpath(chain_key, size))
    if not os.path.exists(path):
        raise WitnessRefusal("witness-holds-no-observation", f"no countersigned observation for size {size} of {chain_key} at {path}")
    with open(path, "rb") as handle:
        envelope = json.loads(handle.read().decode("utf-8"))
    if envelope.get("layout") != WITNESS_LAYOUT:
        raise WitnessRefusal("witness-envelope-malformed", f"{path} carries layout {envelope.get('layout')!r}, not {WITNESS_LAYOUT!r}")
    return verify_identity(envelope, chain_key, size, where=path)


def verify_identity(envelope: dict, chain_key: str, size: int, *, where: str) -> dict:
    """The read-back check itself, shared by the store read and the client's fetch."""
    observation = envelope.get("observation")
    if envelope.get("chainKey") != chain_key or envelope.get("size") != size:
        raise WitnessRefusal(
            "witness-observation-is-not-what-was-asked-for",
            f"{where} is labeled chainKey={envelope.get('chainKey')!r} size={envelope.get('size')!r}, "
            f"and this read asked for {chain_key!r} size {size}. A head is only comparable to the "
            "observation it actually claims to be.",
        )
    if not isinstance(observation, dict) or observation.get("chainKey") != chain_key or observation.get("treeSize") != size:
        raise WitnessRefusal(
            "witness-observation-is-not-what-was-asked-for",
            f"the observation inside {where} says chainKey={observation.get('chainKey') if isinstance(observation, dict) else None!r} "
            f"treeSize={observation.get('treeSize') if isinstance(observation, dict) else None!r}, and this read "
            f"asked for {chain_key!r} size {size}",
        )
    return envelope


# ── the service ─────────────────────────────────────────────────────────────────────────────


class Handler(http.server.BaseHTTPRequestHandler):
    root = ""
    key_file: str | None = None
    quiet = True
    bounds = Bounds()
    #: Retention requests in the last minute. The rate bound covers the requests with side
    #: effects — the ones that make this witness sign something — and deliberately not reads: a
    #: verifier that is being throttled cannot tell that apart from a retainer that is down, and
    #: the whole point of the unreachable case is that it stays unambiguous.
    hits: list[float] = []
    hits_lock = threading.Lock()

    def log_message(self, *args):  # noqa: D102 - the suite reads stdout, not access logs
        if not self.quiet:
            super().log_message(*args)

    def _send(self, status: int, payload: dict) -> None:
        blob = json.dumps({**payload, "custody": payload.get("custody", SAME_OWNER_NOTE)},
                          sort_keys=True).encode("utf-8") + b"\n"
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(blob)))
        self.end_headers()
        self.wfile.write(blob)

    def _rate_allows(self) -> bool:
        now = time.monotonic()
        with Handler.hits_lock:
            Handler.hits = [at for at in Handler.hits if now - at < 60.0]
            if len(Handler.hits) >= self.bounds.max_requests_per_minute:
                return False
            Handler.hits.append(now)
            return True

    def do_GET(self) -> None:  # noqa: N802 - http.server's spelling
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/pub":
            self._send(200, {"algorithm": ALGORITHM, "publicKey": public_key(self.root),
                             "bounds": self.bounds.as_dict(), "custody": SAME_OWNER_NOTE})
            return
        parts = [urllib.parse.unquote(part) for part in parsed.path.strip("/").split("/") if part]
        if len(parts) == 3 and parts[0] == "heads":
            match = re.fullmatch(r"size-(\d+)\.json", parts[2])
            if match is None:
                self._send(404, {"ok": False, "refuse": "witness-path-invalid", "reason": parsed.path})
                return
            try:
                envelope = read_observation(self.root, parts[1], int(match.group(1)))
            except WitnessRefusal as refusal:
                # Not found and not-what-was-asked-for are different answers: one says this
                # witness never held it, the other says something is here that is not the head
                # the caller named. Collapsing them would hide the second behind the first.
                status = 404 if refusal.code == "witness-holds-no-observation" else 409
                self._send(status, {"ok": False, "refuse": refusal.code, "reason": refusal.reason})
                return
            self._send(200, envelope)
            return
        self._send(404, {"ok": False, "refuse": "witness-path-invalid", "reason": parsed.path})

    def do_POST(self) -> None:  # noqa: N802
        if urllib.parse.urlparse(self.path).path != "/retain":
            self._send(404, {"ok": False, "refuse": "witness-path-invalid", "reason": self.path})
            return
        if not self._rate_allows():
            self._send(429, {"ok": False, "refuse": "witness-rate-limited",
                             "reason": f"this witness accepts {self.bounds.max_requests_per_minute} retention "
                                       f"request(s) per minute ({Bounds.FLAGS['max_requests_per_minute']})"})
            return
        # The declared length is checked BEFORE anything is read, so an oversized body is refused
        # without being buffered, and a body with no usable length is refused rather than guessed
        # at: "read until the socket goes quiet" is how a witness is made to hold whatever a
        # caller feels like sending.
        declared = self.headers.get("content-length")
        if declared is None or not declared.strip().isdigit():
            self._send(411, {"ok": False, "refuse": "witness-body-length-required",
                             "reason": "a retention request must declare its content-length so the "
                                       "body bound can be checked before the body is read"})
            return
        length = int(declared.strip())
        if length > self.bounds.max_body_bytes:
            self._send(413, {"ok": False, "refuse": "witness-body-too-large",
                             "reason": f"content-length {length} exceeds this witness's "
                                       f"{self.bounds.max_body_bytes} byte bound ({Bounds.FLAGS['max_body_bytes']})"})
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            self._send(400, {"ok": False, "refuse": "witness-body-not-admissible", "reason": str(exc)})
            return
        chain_key = body.get("chainKey")
        size = body.get("size")
        observation = body.get("observation")
        if not isinstance(chain_key, str) or not isinstance(size, int) or not isinstance(observation, dict):
            self._send(400, {"ok": False, "refuse": "witness-body-not-admissible", "reason": "chainKey, size and observation are required"})
            return
        if observation.get("chainKey") != chain_key or observation.get("treeSize") != size:
            self._send(
                400,
                {"ok": False, "refuse": "witness-observation-disagrees",
                 "reason": f"observation says chainKey={observation.get('chainKey')!r} treeSize={observation.get('treeSize')!r}, body says {chain_key!r} {size!r}"},
            )
            return
        try:
            result = store_observation(self.root, chain_key, size, observation,
                                       key_file=self.key_file, bounds=self.bounds)
        except WitnessRefusal as refusal:
            self._send(409, {"ok": False, "refuse": refusal.code, "reason": refusal.reason})
            return
        # `outcome` and `won` are always reported: a caller is told whether this request created
        # the store entry or found it already there, so "published" is never inferred from a 200.
        self._send(200, {"ok": True, "chainKey": chain_key, "size": size,
                         "outcome": result["outcome"], "won": result["won"],
                         "witness": result["envelope"]["witness"], "custody": SAME_OWNER_NOTE})


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def serve(root: str, host: str, port: int, key_file: str | None = None, bounds: Bounds | None = None) -> int:
    os.makedirs(os.path.abspath(root), exist_ok=True)
    Handler.root = os.path.abspath(root)
    Handler.key_file = key_file
    Handler.bounds = bounds or Bounds()
    Handler.hits = []
    with Server((host, port), Handler) as httpd:
        print(f"WITNESS LISTENING http://{host}:{httpd.server_address[1]} root={Handler.root} publicKey={public_key(Handler.root)}", flush=True)
        print(f"BOUNDS        : {Handler.bounds.line()}", flush=True)
        print(f"CUSTODY       : {SAME_OWNER_NOTE} — a separate process and a separate key, the same principal", flush=True)
        httpd.serve_forever()
    return 0


# ── the client: fetch, verify, and translate into the retainer layout ───────────────────────


def http_get(url: str) -> dict:
    try:
        with urllib.request.urlopen(url, timeout=5) as response:  # noqa: S310 - loopback or an operator-named URL
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            return json.loads(exc.read().decode("utf-8"))
        except Exception:  # noqa: BLE001
            raise WitnessRefusal("witness-unreachable", f"{url} answered HTTP {exc.code}") from exc
    except Exception as exc:  # noqa: BLE001 - any transport failure is unreachable, never a verdict
        raise WitnessRefusal("witness-unreachable", f"{url}: {type(exc).__name__}: {exc}") from exc


def fetch(url: str, chain_key: str, size: int, out: str, *, node_key: str | None = None, expect_witness_pk: str | None = None) -> dict:
    """Read one countersigned head back and write it where the court can read it.

    Nothing is written before every check passes. An unreachable witness, an invalid
    countersignature and a signature produced by the node's own key all leave the output
    directory untouched, so an unanswered consistency question can never look merged.
    """
    base = url.rstrip("/")
    envelope = http_get(f"{base}/heads/{urllib.parse.quote(chain_key, safe='')}/size-{size}.json")
    if envelope.get("ok") is False:
        raise WitnessRefusal(str(envelope.get("refuse") or "witness-refused"), str(envelope.get("reason") or "the witness refused"))
    if not isinstance(envelope, dict) or "observation" not in envelope:
        raise WitnessRefusal("witness-envelope-malformed", f"{base} did not return an observation envelope")
    # The read-back check runs on the CLIENT side too, before anything is verified or written: a
    # witness — or anything answering in its place — that hands back another stream's head, or
    # the same stream at another size, is refused by name rather than verified and filed under
    # the identity that was asked for.
    verify_identity(envelope, chain_key, size, where=f"{base}/heads/{chain_key}/size-{size}.json")
    checked = verify_countersignature(envelope, node_key=node_key, expect_witness_pk=expect_witness_pk)
    observation = envelope["observation"]
    document = {
        "layout": RETAINER_LAYOUT,
        "retainedAt": envelope.get("receivedAt"),
        "retainedBy": f"witness {base}",
        "observation": observation,
        "witness": envelope["witness"],
        "witnessCustody": SAME_OWNER_NOTE,
    }
    target = os.path.join(os.path.abspath(out), head_relpath(chain_key, size))
    os.makedirs(os.path.dirname(target), exist_ok=True)
    blob = json.dumps(document, sort_keys=True, separators=(",", ":")).encode("utf-8") + b"\n"
    with open(target, "wb") as handle:
        handle.write(blob)
    return {
        "witness": base,
        "chainKey": chain_key,
        "size": size,
        "path": target,
        "sha256": hashlib.sha256(blob).hexdigest(),
        "countersignature": checked,
        "custody": SAME_OWNER_NOTE,
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="aurawitness", description="Countersigning witness for retained observations.")
    verbs = parser.add_subparsers(dest="verb", required=True)

    serve_parser = verbs.add_parser("serve", help="run the witness")
    serve_parser.add_argument("--root", required=True)
    serve_parser.add_argument("--host", default="127.0.0.1")
    serve_parser.add_argument("--port", type=int, default=4479)
    serve_parser.add_argument("--key", help="sign with this seed file instead of the root's own key (test aid)")
    for name, flag in Bounds.FLAGS.items():
        serve_parser.add_argument(flag, type=int, default=DEFAULT_BOUNDS[name],
                                  dest=name, help=f"bound {name} (default {DEFAULT_BOUNDS[name]})")

    pub = verbs.add_parser("pubkey", help="print this witness's public key")
    pub.add_argument("--root", required=True)

    fetch_parser = verbs.add_parser("fetch", help="read a countersigned head back and write it in the retainer layout")
    fetch_parser.add_argument("--url", required=True)
    fetch_parser.add_argument("--chain-key", required=True)
    fetch_parser.add_argument("--size", required=True, type=int)
    fetch_parser.add_argument("--out", required=True)
    fetch_parser.add_argument("--node-key", help="the node's own public key; a countersignature that verifies under it is refused")
    fetch_parser.add_argument("--expect-witness-pk")

    sign_parser = verbs.add_parser("sign", help="countersign one observation document into an envelope (test aid)")
    sign_parser.add_argument("--root", required=True)
    sign_parser.add_argument("--in", dest="source", required=True)
    sign_parser.add_argument("--out", required=True)
    sign_parser.add_argument("--key", help="sign with this seed file instead of the root's own key")

    args = parser.parse_args(argv[1:])
    try:
        if args.verb == "serve":
            bounds = Bounds(**{name: getattr(args, name) for name in Bounds.FLAGS})
            return serve(args.root, args.host, args.port, key_file=args.key, bounds=bounds)
        if args.verb == "pubkey":
            print(public_key(args.root))
            return 0
        if args.verb == "sign":
            with open(args.source, "rb") as handle:
                observation = json.loads(handle.read().decode("utf-8"))
            envelope = {
                "layout": WITNESS_LAYOUT,
                "chainKey": observation.get("chainKey"),
                "size": observation.get("treeSize"),
                "receivedAt": now_ms(),
                "observation": observation,
                "witness": countersign(os.path.abspath(args.root), observation, args.key),
            }
            with open(args.out, "wb") as handle:
                handle.write(json.dumps(envelope, sort_keys=True, separators=(",", ":")).encode("utf-8") + b"\n")
            print(json.dumps({"path": args.out, "publicKey": envelope["witness"]["publicKey"]}))
            return 0
        result = fetch(args.url, args.chain_key, args.size, args.out, node_key=args.node_key, expect_witness_pk=args.expect_witness_pk)
        print(f"WITNESS       : {result['witness']}")
        print(f"  countersigned by {result['countersignature']['publicKey'][:16]}… over jcs(observation) {result['countersignature']['signedSha256'][:16]}…")
        print(f"  written       {result['path']}  sha256 {result['sha256'][:16]}…")
        print(f"  CUSTODY       : {result['custody']} — a separate process and key, the same principal; not independent custody")
        return 0
    except WitnessRefusal as exc:
        print(f"REFUSE: {exc.code}: {exc.reason}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
