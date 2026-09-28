# It writes the code. You hold the key.

AUKORA Genesis is a desktop AI where the software that proposes an action is not the authority that permits it. On its governed approval paths, the owner approves exact bytes with a software key held in the Airlock that the agent cannot read; a kernel decides; every governed decision is receipted and can be checked cold, from an empty directory.

## What is not enforced

- The app and agent share a macOS UID. Airlock holds the software approval key in a separate account, but its socket accepts signature requests from any process of the app's UID.
- Attendance is reported, not proven. A recorded click and signature do not establish that a person approved.
- The phrase-derived root has about 34 bits. Its seven-word phrase and public handle permit offline guessing.
- Embedded app frames share the desktop origin; the null-origin sandbox is off.
- The live agent runs on the host. Deep's box is in the tree, not wired to the live agent. Full-access sessions remain unconfined by Seatbelt.
- Nothing on GitHub requires the approval routes. The macOS user holds push credentials; a direct push to `main` is not stopped. The app's action gate is an in-process check, not isolation.
- The project's break corpus records 17 breaches, 11 open when frozen on 2026-08-21 against an earlier harness; these have not been re-measured on this tree.

## Check it yourself

On macOS with Python 3, Node.js 22 or newer, Perl and `/usr/bin/cc` (Xcode Command Line Tools):

```sh
git clone https://github.com/aumara-xyz/aukora-genesis && cd aukora-genesis && sh scripts/check.sh
```

Expected final line (elapsed time varies):

```text
TOTAL <elapsed>s | 19/19 passed
```

CI runs the same checks on every push. They check disposable repository fixtures, not an installed app. Read each result: PASS means exit zero, and the box check can report SKIPPED or NOT RUN. The verifiers are this project's own code, not independent implementations.

## Running release

The installed app runs `aukora-release-0496ba077`, built from main `0496ba077` (operator-reported). This page is not independent live verification of the installed app.

## Read

- [AUKORA Golden Boundary — Rev 2.3 front](https://github.com/aumara-xyz/aukora-genesis/blob/main/docs/AUKORA-GOLDEN-BOUNDARY.md)
- [Claims and their limits](https://github.com/aumara-xyz/aukora-genesis/blob/main/docs/CLAIMS.md)
- [Running AUKORA on your Mac](https://github.com/aumara-xyz/aukora-genesis/blob/main/docs/RUNNING.md)
- [Break corpus](https://github.com/aumara-xyz/aukora-genesis/blob/main/docs/BREAK-CORPUS.md)
- [Care Without Control](https://github.com/aumara-xyz/aukora-genesis/blob/main/docs/CARE-WITHOUT-CONTROL.md) — a speculative design note

Care grants no authority. Auma is not an authorizer. Warmth, memory and confidence approve nothing.

## Contribute

Open an issue or send a patch as a proposal. The project's rule is that `main` moves only through the owner's key, held in the Airlock, using the approval routes. GitHub does not enforce that rule. This is a known founder bottleneck. Send security reports through a GitHub security advisory. Backlog: [issue #1, “organism-line”](https://github.com/aumara-xyz/aukora-genesis/issues/1).

## License

[AGPL-3.0-or-later](https://github.com/aumara-xyz/aukora-genesis/blob/main/LICENSE). Copyright (c) 2026 Aumara and Peter Viviani (the named owner). Third-party components retain their own licenses and notices.
