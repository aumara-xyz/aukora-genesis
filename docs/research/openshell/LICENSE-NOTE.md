# Apache-2.0 OpenShell beside AGPL AUKORA

Not a legal opinion. The open question in `docs/research/LICENSING.md` stays open: how far AGPL section 5 reaches across AUKORA and the harness is not decided here, and this note does not decide it for OpenShell either.

## What is being combined

[NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell) is Apache License 2.0, Copyright NVIDIA CORPORATION & AFFILIATES. AUKORA's published authority and evidence layers are AGPL-3.0-or-later, copyright Peter Michael Viviani, as `docs/research/LICENSING.md` states. The root `LICENSE` of this repository is that AGPL.

This sketch uses OpenShell as an adjacent process: a gateway and a sandbox the operator starts, addressed by the `openshell` CLI. It is not vendored, not linked into a plugin, and not built into the app. Apache-2.0 section 1 says a derivative work does not include a work that stays separable and merely links or binds by name to the interfaces. An adjacent process is the shape that sentence describes. That is the intended composition. It is not a ruling that a court would sort the programs the same way if someone later linked them.

## Attribution if the binary is ever shipped

This branch does not ship the `openshell` binary. If a later release does, Apache-2.0 section 4 requires, with the binary:

- a copy of the Apache License 2.0,
- retention of NVIDIA's copyright, patent, trademark, and attribution notices, and of any NOTICE file,
- a prominent notice on files that were changed.

Do not relicense OpenShell as AGPL. Apache-2.0 section 4 allows additional terms on your own modifications. It does not let those terms replace NVIDIA's license on NVIDIA's work.

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
