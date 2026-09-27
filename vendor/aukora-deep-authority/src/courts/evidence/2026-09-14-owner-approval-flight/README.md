# Attended Web approval flight, 2026-09-14

English | [中文](README.zh.md)

This directory keeps the first attended brokered effect through the live AUKORA Web assembly reproducible from files alone, with no live broker and no private key.

## Provenance

- Deployed candidate source: `/Users/peterviviani/aukora-deep/.worktrees/owner-approval-panel` at `5142bd9d74f1d74b887952cbf55d303b618953fe`, whose Git tree equals the recorded main commit.
- Main: `58aca798af7b36abfb6dcf8578242b71086a7fb8`, the merge of PR #276.
- Live assembly at the time of the flight: parent 52959, broker 54039, issuer 54040, guest 54041, plus an owner-review client that was replaced after its renderer was found detached.
- `broker-public.pem` is the public half only. It is force-added past the repository's `*.pem` exclusion, which stays in force for every other PEM; no private material is tracked here.
- Observed object: `/Users/peterviviani/aukora-governed-workspace/popup-proof-20260914T050437Z.txt`. `content.txt` is a byte copy; the original file remains in the governed workspace.

## What the flight did

One `workspace.patch` proposal, submitted once with no retries: create-only file `popup-proof-20260914T050437Z.txt` in workspace alias `project` (resolved to `/Users/peterviviani/aukora-governed-workspace`), `beforeSha256: null`, content `AUKORA popup approval test.` plus one final newline, 28 bytes, sha256 `c8313e770bcd37d9ffc69adbfd23606376bfde490f6934f8574598c9a9c770d0`. The owner answered the parent review and then the separate issuer confirmation in the paired chat tab. The broker returned `{"ok":true,"state":"SETTLED","proposalId":"aa0aaa32b0ca50da135e5c38c0c2fd8a"}`.

`receipt.json` is the broker's persisted receipt, copied without modification; `MANIFEST.txt` records its sha256 so the copy can be compared against the store.

## Three claims, deliberately kept apart

1. **Signature and content.** `verify-offline.mjs` verifies the Ed25519 signature over the receipt's own signed fields and checks the exported bytes against the signed content digest and length. The run includes refusal controls: a tampered signature must refuse as `receipt:signature-invalid` and tampered content as `receipt:content-mismatch`. Both refuse, so a passing signature line cannot come from a verifier that accepts everything.
2. **Key trust.** The supplied public key's id equals the activation receipt key id recorded in `pin.json`. Both travel inside this same bundle, so the agreement shows internal consistency and a local same-UID pin: the key is the one the recorded activation names. It is not independent custody, and `verifyReceipt` itself says the class gate is worth only the reader's out-of-band binding of the key.
3. **Human attendance.** Not established by this bundle, and not establishable by any scripted run. Attendance is the owner's own observation of the prompts he answered. Screenshots of those prompts are his artifact and are not included yet.

## Offline reproduction

This data directory is not a standalone executable package. `verify-offline.mjs` imports the repository's verifier modules (`aukora/broker/receipt.mjs` and `aukora/host-dsh/src/grant.mjs`), so it runs from a checkout or a `git archive` export of a commit that contains this directory. Only the five data files are taken from the bundle.

```
git archive <commit> | tar -x -C <export>
mkdir -p <scratch>/bundle
cp <export>/courts/evidence/2026-09-14-owner-approval-flight/{receipt.json,content.txt,broker-public.pem,operation.json,pin.json} <scratch>/bundle/
cd <scratch>
env -i /Users/peterviviani/.hermes/node/bin/node <export>/courts/evidence/2026-09-14-owner-approval-flight/verify-offline.mjs <scratch>/bundle
```

Expected result: eleven `PASS` lines and a final `VERIFIED` with exit status 0. `verify-output.txt` records one such run against a copy of this bundle with a cleared environment, so no ambient credential, configuration or state could participate. The script reads only the bundle directory it is given; it does not open broker state, a private key, a pairing token, a session log or the broker store.

## Limits this bundle does not paper over

- `inode` and `mtimeNs` are the receipt's claims. An off-host copy cannot re-observe the original object, and the verifier labels that substitution in its output. The live re-observation happened at settlement time and is not repeated here.
- The receipt is the broker's attestation of its own post-dispatch observation. It does not prove which call created the file, and it says nothing beyond that observation.
- Excluded by design: private keys, credentials, pairing tokens, session logs, the broker store and everything unrelated to this one operation.

## Export defect the refusal controls caught

The first export wrote the public PEM with a doubled trailing newline (114 bytes). The strict canonical ed25519 check refused it as `receipt:key-not-ed25519` while key-id computation still succeeded, which is exactly the failure a bundle can hide if it only prints a happy path. Re-exporting the stored value with `jq -j` yields the canonical 113-byte PEM and every check passes.

## Preceding failure kept for the reliability work

The first attempt at this flight was refused as `broker:review-timed-out`. By then the owner-review client held no transport sockets while its browser API stayed up and the browser stayed connected, so no prompt could be displayed.

That observation followed a timeout rather than preceding it, so it does not establish that the client was detached before the submission: a timed-out request destroys the renderer's transport peer, so the detachment may have begun at that expiry instead. Nor do the transport timers at `scripts/launchd-review-transport.mjs` lines 162 and 282 explain it — those cover authentication and are cleared after the handshake, so they are not an ongoing idle timeout.

A disposable reproduction now shows the mechanism directly: with a paired session and a watching browser, one unanswered request ends with the transport timing out at 20 s, the client reading `disconnected` afterwards, and no re-attachment until an explicit authenticated reconnect. The fix belongs to the approval-connection reliability task.
