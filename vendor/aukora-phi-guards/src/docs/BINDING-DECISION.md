# BINDING — one decision the code will not make for you

`aukora bind` mints a root key and wraps its private half so that opening it needs **two factors**: a
phrase you remember, and a secret stored on this machine.

The phrase half is settled. The machine half is not, and this document exists because choosing it on
your behalf would be exactly the overclaim this repository refuses everywhere else.

---

## What is actually true today

**Neither lineage has a Secure Enclave or TPM path.** Not aukora-seed, not φ. There is no code in
either lineage that has ever put a key inside hardware. If you have been assuming there is, that
assumption is the thing this page exists to correct.

> **CORRECTION, 2026-08-03.** This paragraph used to end "…and none that could be enabled by a flag."
> That is true of Secure Enclave and **false in general**, and the difference matters because it hid a
> real option from a decision that wraps your root.
>
> `aukora-one/authority/secure-custody.mjs` is a working macOS **Keychain** backend, and it is not a
> sketch: `scripts/bind.mjs:33` imports it and `:61` selects it with exactly the flag this page said
> did not exist — `real ? resolveSecureCustody() : ephemeralMemoryCustody()`. Verified by reading that
> file, not by report.
>
> The sentence conflated two different things. **Hardware custody** (Secure Enclave, TPM) does not
> exist in either lineage — that half stands. **OS-backed custody** does exist, works, and is called.
> It is now **option D**, so the choice below is between four things rather than three.

What `bind` implements today is **option A** below. The plan printed by `aukora bind` says so, and
carries this question with it, so it cannot be accepted unread.

---

## The four options

### A · A 0600 file in `~/.aukora/keys` — what the code does today

The device secret is 32 random bytes in `~/.aukora/keys/device.secret`, mode 0600, owned by you.

- **Defends against:** someone who obtains the wrapped root file alone — from a repository, a backup of
  the repository, a leaked `aukora.pub`, or a copy of the chain. The phrase's ~14.34 bits of entropy is
  not attacked directly, because the phrase alone cannot open the wrap.
- **Does not defend against:** anything running as your user on this machine. A malicious dependency, a
  compromised editor extension, or an agent with shell access can read a 0600 file as easily as you
  can. Nor does it defend against someone who restores your **whole-machine** backup, since the secret
  is in it.
- **Costs:** if the machine dies and you did not write down the recovery secret, the root is
  permanently unreachable.

### B · Phrase only, no device factor

Drop the second factor. The wrap is portable: the same phrase opens the root on any machine.

- **Defends against:** almost nothing that A does not. It returns the phrase to standing alone, and at
  ~14.34 bits a stolen wrap file is a short offline search. This is the exact weakness the two-factor
  wrap was built to remove — it is listed here for completeness, not as a live recommendation.
- **Buys:** genuine portability, and no dead-machine risk.

### C · Wait for hardware

Do not bind until a Secure Enclave / TPM path exists.

- **Defends against:** everything A does, plus local software reading the secret, because the key never
  leaves the hardware.
- **Costs:** this is a decision to stay **unbound indefinitely**. Nobody is writing that path today, so
  "wait" has no date attached. Concretely, staying unbound means: `bound: false`, receipts continuing
  to accumulate unsigned, no genesis anchor, and the face's shape seeded from an empty `genesisRef` —
  the same fallback pattern it renders for anyone.

### D · The macOS login Keychain — code that already exists and is already called

The device secret lives in your login Keychain instead of a 0600 file, reached through `security(1)`.
`aukora-one/authority/secure-custody.mjs` implements this today; it is **not ported to φ**, and porting
it is the work this option costs.

- **Defends against:** everything A does, plus a **copy of your home directory**. There is no file to
  read: the secret is in the keychain database, encrypted at rest, and it is not in a `~/.aukora`
  backup. A stolen repository, a stolen backup of it, and a stolen `~/.aukora` all come up empty.
- **Does NOT defend against:** a process running as you while the keychain is unlocked — which it is,
  from the moment you log in. `security(1)` will hand the secret to anything that asks with your
  privileges. **This is not Secure Enclave and must not be read as it:** the key is extractable, it
  simply lives somewhere better than a flat file. Option C is still the only one where the key never
  leaves hardware.
- **Costs:** macOS only. A Linux node needs a different backend or falls back to A, so this is a choice
  about *this* machine rather than about the lineage.

**Zero npm.** The module imports `node:child_process` and nothing else, so φ's zero-dependency posture
does not forbid it — that was checked rather than assumed.

**Three details it already gets right, each of which a fresh implementation gets wrong:**

1. **No owner byte reaches `argv`.** It runs `add-generic-password -U -s <service> -a <account> -w`
   with **no value after `-w`**, and feeds the secret twice on stdin (`` `${secret}\n${secret}\n` ``).
   A value on the command line is visible in `ps` to every process on the machine.
2. **`stdio: ['pipe', 'pipe', 'ignore']`.** stderr is discarded rather than captured, so a failure
   message that quoted the secret could not be carried back into a log or an error string.
3. **A secret containing `\r`, `\n` or `\0` is REFUSED** (`secretValid`, :121–122), because `security(1)`
   reads stdin to a newline — a secret with one in it would be silently truncated and the wrap would be
   built around a fraction of the key. Refused, not trimmed.

It also pins `/usr/bin/security` absolutely and passes arguments as an array, so no account name can
inject a flag.

*(A fourth property is worth knowing before porting: `store` gates its only collision refusal on
`!replace`, and `-U` overwrites in place. `aukora-one/ui/ceremony/commit.mjs` records a live incident
where a caller passed `replace: true` unconditionally and turned that check off — a complete
consume-then-overwrite path to a binding that could not be recovered. Port the caller's decision, not
just the backend.)*

---

## What binding does NOT do, whichever you choose

- **No existing receipt is altered, re-signed, or removed.** The receipts written before binding stay
  unsigned. Calling them signed afterwards would be a lie, and `verifyChain`'s signature-gap check is
  positional precisely so an honest unsigned prefix is not read as tampering.
- **No chain is truncated, reordered or migrated.**
- **The private half never enters the repository.** `aukora.pub` carries public material and the device
  certificate; the wrapped root lives in `~/.aukora/keys`.

## The recovery secret

Whichever option you pick, `bind` mints a high-entropy recovery secret that opens the same root
independently of the phrase and of this machine. **It is printed once and stored nowhere.** A recovery
secret written beside the wrap it opens is not a recovery path — it is a second copy of the key.

Write it on paper. If the machine dies and you do not have it, there is no rotation, no un-vow, and no
second chance.

---

## How to decide

The question is not "which is most secure" — it is **what threat you are actually buying protection
from.** A is worth having if the realistic risk is a leaked file, a cloud backup, or a public
repository. A is worth very little if the realistic risk is code running as you on this laptop, and in
that case C is honest and B is not.

**D sits between A and C, and it is the option this page was hiding.** It answers a threat A does not —
a copy of your home directory, which is the most likely way a file-based secret actually leaves this
machine — without the indefinite wait C asks for. It does **not** answer the threat C answers: a
process running as you can still read it. So if your real worry is a stolen backup, D is strictly
better than A and available now. If your real worry is a compromised dependency running as you, D buys
you nothing over A and C is still the honest answer.

Nothing in the code prefers one. `aukora bind` prints the plan, states this question, and waits.

**On D specifically:** the code exists in `aukora-one` and is called there; it is not in φ. Choosing D
is choosing to port it — and to port the caller's `replace` decision with it, not only the backend.
