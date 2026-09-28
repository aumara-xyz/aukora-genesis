# Guest confinement provenance

[`guest-confinement.mjs`](guest-confinement.mjs) adapts the deny-default Seatbelt rendering, fixed runtime reads and sysctl selection, canonical path and alias checks, closed launch environment, and live enforcement-canary approach from `aukora-cordis` commit `626310e2cbd76eff87a6ab306dbc083ae5527618`, file `src/confined/sandbox.ts`, Git blob `09d75ce78d0d6aa37817a6c4ab8d7ca9e5db6cb5`.

The source is Copyright (c) 2026 Aumara LLC, licensed AGPL-3.0-or-later. Its SPDX/copyright notice is retained in the adapted module; [`confinement.LICENSE`](confinement.LICENSE) is the complete upstream `LICENSE` at that commit, Git blob `be3f7b28e564e7dd05eaf59d64adba1a4065ac0e`.

Deep's adaptation adds its exact broker Unix connection, direct-parent IPC, prepared read-only Cordis profile, installation read inventory, launcher activation measurements, and existing supervisor lifecycle. It does not import the broader Web launch profiles from Deep PRs 184 or 151. All runtime imports resolve inside this repository or its installed dependencies; the sibling Cordis checkout is provenance only, not a runtime dependency. The sealed MIT donors and their license files are unchanged.
