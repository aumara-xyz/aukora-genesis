# Running AUKORA Genesis on your Mac

For the coding agent a friend points at this repository. NOT VERIFIED means nobody has run that step end to end on a fresh Mac.

## What you get and what you don't

- Research software, not for daily use. There is no prebuilt app and no GitHub release: you build it here.
- Measured on one Mac only: Apple M4, 16 GB, macOS 26.1, Node 22.23.0, and it runs under memory pressure there. Voice and OpenViking need Apple Silicon. Other Macs: NOT VERIFIED.
- The agent runs as your macOS user. Full-access sessions are not confined by Seatbelt; the action gate is an in-process check, not isolation.
- Your approval key is a software key in the app's state folder. Any process running as you can read it. A click is recorded, not proven.
- Your seven Aumlok words are shown once and are your identity. They have about 34 bits and can be guessed offline.
- Auma Live sends each turn to OpenRouter under your key and keeps transcripts unreviewed. The local voice process only hears and speaks.
- Owner-only, not in the repo: his extra overlays (lanes, live tools, voice path, OpenViking link), his approved plugin set, his Airlock account, his memories and keys. `self-change` and `advance` push the owner's `main`; `become` replaces the installed app. Don't run them.
- In the tree: the faces, Kira memory, Aumlok, Aura, the action gate, and the apps Auma Live (and Canvas), Auma Lingwa, Zeta Harp and Dakini Code. Lingwa, Zeta Harp and Dakini Code are static pages the app serves. Luminara is gone.

## Steps

You need macOS, Xcode Command Line Tools (`/usr/bin/cc`; `xcode-select --install`), Node.js 22.23.0 or newer, pnpm 11.7.0 or newer (`corepack enable`), python3, perl, git, 10 GB free and network. "Support folder" means `~/Library/Application Support/AUKORA`.

1. Clone and check (keyless; expected final line: `TOTAL <elapsed>s | 19/19 passed`):
   ```sh
   git clone https://github.com/aumara-xyz/aukora-genesis && cd aukora-genesis
   sh scripts/check.sh
   ```
2. Build. The dry run walks every step and builds nothing:
   ```sh
   scripts/install-mac.sh --dry-run
   scripts/install-mac.sh
   ```
   It builds the pinned DeepSeek Harness (about 1.8 GB, minutes), keeps the committed faces, materializes `~/aukora-release-<commit>` and packages an unsigned app. Full run: NOT VERIFIED. Never run `build-face.py`: it changes committed bytes and the materializer then refuses.
3. Start it:
   ```sh
   cd apps/aukora-desktop && npm start
   ```
   It picks the newest `~/aukora-release-*` and keeps its state under `state/` in the support folder. With no approval installed it starts under a first-run waiver: plugin bytes are checked, not enforced.
4. System menu → Models: enter your DeepSeek API key. It is saved in `state/home/.credentials.yaml`.
5. For Auma Live, add your OpenRouter key to that file (mode 600; reloads without a restart):
   ```yaml
   version: 1
   refs:
     DEEPSEEK_API_KEY: <yours>
     OPENROUTER_API_KEY: <yours>
   ```
   Without it Auma Live says no OpenRouter key is loaded. Entering it through the UI: NOT VERIFIED.
6. Aumlok screen: write down the seven words, then type them back. This keeps a machine key in `state/aumlok/` and writes `kira-deployment-overlay.patch.yml` into the support folder. Quit and reopen; Kira mounts from then on.
7. Optional, NOT VERIFIED: from the clone root in another terminal, approve the plugin set while the app runs:
   ```sh
   node scripts/aukora/plugin-set.mjs approve --release ~/aukora-release-<commit>
   ```
   From then on every launch enforces it, and changed plugin bytes need a new approval.

From the clone root, to update: `git pull`, then `scripts/install-mac.sh` again; the app picks the newest release.

From the clone root, optional semantic memory: `sh scripts/openviking-setup.sh install`, then `sh scripts/openviking-setup.sh serve`, after step 6. Needs uv or Python 3.11, `brew install llama.cpp`, and downloads a 639 MB embedding model. Without it Kira recalls lexically.

Optional, CORE hands (Codex and Claude Code subagents): those CLIs installed and signed in. NOT VERIFIED on a fresh install.

## Optional: Auma Live voice

Without this, Auma Live uses the browser's own speech and typing.

Local voice needs Apple Silicon and `uv` (it fetches Python 3.12). It downloads Kokoro-82M (`kokoro-v1.0.onnx`, `voices-v1.0.bin`) from the kokoro-onnx GitHub release, `mlx-community/whisper-base.en-mlx` from Hugging Face, and Kyutai Pocket-TTS weights on first warm-up: about 711 MB of weights and a 1.2 GB environment.

Do not run it inside `~/aukora-release-*`: added files break the release's strip manifest and the launcher refuses it. Run it in the clone, where both folders are gitignored:

```sh
cd plugins/aukora-face/apps/vendor/auma-live/voice && bash setup.sh
```

Then point the app at it, NOT VERIFIED. In the support folder create `voice.patch.yml` (a row replaces that plugin's whole config, so restate the release's values):

```yaml
- id: aukora-face-apps
  config:
    voiceRuntimeDirectory: <absolute path to that voice folder>
    organismDshHome: <absolute path to the support folder>/state/home
    offeredMinds: [balanced, deep, quick, muse, opus]
```

In the support folder's `config.json`, set `"patch"` to three absolute paths in this order: the release's `aukora-composition.patch.yml`, `kira-deployment-overlay.patch.yml`, `voice.patch.yml`. A `patch` list replaces the defaults. Restart. The stock voice speaks; the cloned Aurora voice stays off.

## What never to copy from someone else's Mac

- Anything in their support folder: API keys (`state/home/.credentials.yaml`), the Aumlok machine key (`state/aumlok/`), `config.json` (it can hold a backend token), `kira-deployment-overlay.patch.yml` (it pins their identity), approvals in `state/gate-state/`, memories, sessions and transcripts.
- Their `~/aukora-release-*` folders: a release bakes in the home paths of the Mac that built it. Build your own.
- Their seven words, their Airlock config (`/etc/aukora/owner-daemon.json`) or key, OpenViking's `root.key`, and their Codex or Claude logins.
