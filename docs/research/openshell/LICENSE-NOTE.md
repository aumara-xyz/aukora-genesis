# Apache-2.0 OpenShell beside AGPL AUKORA

Not a legal opinion. The open question in `docs/research/LICENSING.md` stays open: how far AGPL section 5 reaches across AUKORA and the harness is not decided here, and this note does not decide it for OpenShell either.

The v0.2 specification's packaging decision is §20.21, recorded in `SPEC-v0.2-INTAKE.md`. Apache-2.0 is not, by itself, a reason to avoid OpenShell or to reimplement it, and it is not a reason to relicense AUKORA as Apache. AGPL obligations on the AUKORA side remain. A process boundary does not automatically settle copyleft. This note describes the intended adjacent-process shape. It is not that review.

## What is being combined

[NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell) is Apache License 2.0, Copyright NVIDIA CORPORATION & AFFILIATES. The spec inspected `main` at `1358941b818d4126a7374aaf5216d87fc960e122` and tag `v0.1.2` at `6648bd0c290efbc41ba131ee9831ee45cd431f94`. Those commits differ. This repository does not vendor either of them.

AUKORA's published authority and evidence layers are AGPL-3.0-or-later, copyright Peter Michael Viviani, as `docs/research/LICENSING.md` states. The root `LICENSE` of this repository is that AGPL.

This research uses OpenShell as an adjacent process: a gateway and a sandbox the operator starts, addressed by the `openshell` CLI. It is not vendored, not linked into a plugin, and not built into the app. Apache-2.0 section 1 says a derivative work does not include a work that stays separable and merely links or binds by name to the interfaces. An adjacent process is the shape that sentence describes. That is the intended composition. It is not a ruling that a court would sort the programs the same way if someone later linked them.

## Attribution if the binary is ever shipped

This branch does not ship the `openshell` binary. If a later release does, Apache-2.0 section 4 requires, with the binary:

- a copy of the Apache License 2.0,
- retention of NVIDIA's copyright, patent, trademark, and attribution notices, and of any NOTICE file,
- a prominent notice on files that were changed.

Do not relicense OpenShell as AGPL. Apache-2.0 section 4 allows additional terms on your own modifications. It does not let those terms replace NVIDIA's license on NVIDIA's work. §20.21 also says to keep a dependency and license inventory, source pins, and a separate look at drivers, images, model weights, and third-party services, and to avoid wording that implies NVIDIA endorsed AUKORA.

Suggested line, kept next to the binary or in a NOTICE file:

```text
This product runs NVIDIA OpenShell as a separate process.
Copyright NVIDIA CORPORATION & AFFILIATES.
Licensed under the Apache License, Version 2.0.
https://github.com/NVIDIA/OpenShell
```

The policy YAML in this directory is original AUKORA text, licensed with the rest of this repository (AGPL-3.0-or-later). It targets OpenShell's published schema. It is not a copy of an OpenShell source file.

## AGPL on the published AUKORA side

Prefer AGPL for published AUKORA layers, including this design. AGPL section 13 applies when a modified version of the AGPL work is offered to users over a network: those users must be able to get the corresponding source. A local, unmodified OpenShell gateway is not that offer. A modified AUKORA plugin that called out to it would still be AGPL, and section 13 would still apply to that modified AUKORA.

## Crown stays closed

Admit, spend, and keystone stay closed. They are not in this branch. Do not copy them into the sandbox image, into an OpenShell tree, or into an Apache-licensed file so the cage can make an authority decision. The spend gate recorded in `docs/AUKORA-GOLDEN-BOUNDARY-EVIDENCE.md` is private only. The keystone note on the typed action registry is not a license to republish that decision core under Apache-2.0.

OpenShell may refuse a path, a host, or a credential. It does not admit an effect, spend a grant, or hold the keystone. Those answers stay in the closed crown and in Aumlok Approve.
