# Pitch (half page)

**Problem.** When software changes under you — a plugin loads, a binary
swaps, a log rewrites — a stranger has no cheap way to keep an earlier
observation and check a later one. Trust collapses into “believe the
operator” or “believe the cloud.”

**What this toy shows (Phase 0 + composition).**

1. **Phase 0** — keep a retained Aura head; later check a presented head.
   Honest growth → `APPEND_ONLY`. Tamper the presented root →
   `OBSERVATION_CONFLICT`. A second retained observation written by a
   **separate process under a separate root** still says `APPEND_ONLY`
   when only A’s copy is mutated. Measured: separate process + separate
   root — not device independence.
2. **Composition grant** — load/unload of an ephemeral plugin is refused
   without a one-use grant. Loader requires a structural mediator
   provider; disable → `MEDIATOR_OFF` before grant evaluation. Nonces are
   atomic across processes (`O_EXCL`). Ceilings print: `BOOTSTRAP_UNGATED`,
   `SAME_UID`.
3. **v3-shaped receipts** — each load/unload issues `aukora-receipt/v3-toy`.
   A stranger cold-verifies with `--pub` → `SIGNER_KEY_MATCHED`
   (fail closed without; `--allow-unanchored` is demo-only).
   Class is derived: live receipts are **unattributed / NON-CONFORMING**.
   No `alg` field. Forged `owner`/`identity`/`did` refuse. Fixtures use a
   separate kind. `foreign/` is a second-implementation smoke verifier.

The cold court also names the approval lab's limits: scripted approval labels
never become measured human presence, unsupported human-ceremony claims refuse,
and cell execution stays `NOT_ESTABLISHED`. A coherent attacker-signed history
cannot substitute for the caller's expected key. Public evidence still verifies
after the disposable producer's private key is removed.

**Honest limits.** Not a propose runtime (no WASM cell, no Seatbelt guest,
no Electron — `CONTINUITY-SPINE.md`). Not CONFORMING. Not L1. Not isolation. Cold verify alone
is `CONSISTENCY_UNCHECKED` — Phase 0 is a different court. Attendance is
**reported-not-proven**. Append-only is cryptographic/logical, not a
crash-safe WAL. **This toy has no human-ceremony** — agent/governor keys
must not mint one (flip-risk). No CRT / ghost-mesh / immortal-organism.

**Next bricks.** Owner key at the load gate; a real second device holding
its own retained observation.
