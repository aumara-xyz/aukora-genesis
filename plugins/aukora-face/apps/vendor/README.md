# Bundled Aukora application sources

This directory is the source of record for the stock applications mounted by `@deepseek-ai/dsh-client-ui-stock-apps`. A built or source-launched Aukora UI resolves every application file from this directory; the repositories named below provide provenance only and may be absent.

## Provenance and contents

| Directory | Pinned source | Preserved contents |
|---|---|---|
| `zeta-harp/` | `aumara-xyz/zeta-harp` commit `aa1100fa56e2a86ccd181cb39d13122e62abdf9f`, tree `8c2f47d67479c19ce98e0c8d57916fd6d86feb34` | Complete 13-file tracked tree for the Riemann–Siegel instrument, Fold explainer, reference fixtures, renderer, and Truth Audio. |
| `auma-lingwa/` | Aukora revision `b413a89b109900a9037a9ed725b0d1b474e4f550` | Exact 84-day, 948-word browser runtime plus canon v14.1/v15/v16 history, readers, lint/tooling source, and original tests. |
| `auma-live/` | Aukora revision `b413a89b109900a9037a9ed725b0d1b474e4f550` | Exact browser source; 69 presence, memory, governance, authority, and runtime source files plus 17 relevant original tests; Python duplex sidecar source; and the Aurora prompt setup. |

`manifest.json` records the pinned revisions and a stable SHA-256 and byte count for every preserved file. It deliberately omits itself and this explanatory README. Regenerate or verify it from the package root:

```sh
pnpm vendor:manifest
pnpm vendor:check
```

The package and these sources are distributed under `AGPL-3.0-or-later`.

## Runtime mapping

Auma Lingwa's `runtime/auma-lingwa.html` is served at `/stock-apps/auma-lingwa.html`. Its application files occupy their original `/app/auma/*`, `/app/style.css`, `/app/aura-core.js`, and `/assets/aumara-icon-96.png` paths, byte-identical to the vendored source with one target-owned exception: `/app/auma/auma.js` is served with its lesson gate rewritten to `const isUnlocked = () => true;`, so every lesson opens for reading without prior-day completion. The rewrite happens in `serveOpenedLingwaModule`, leaving the vendored bytes and their manifest digest exact, and `assets.host.spec.ts` pins both the served result and the authored expression so a donor revision that moves the gate fails the suite. `canonical/` and `tooling/` preserve the application's source history and maintenance code without becoming external runtime inputs.

Zeta Harp's complete source tree is served below `/stock-apps/zeta-harp/*`; `/stock-apps/zeta-harp/index.html` is its authored entry. Relative instrument, Fold, fixture, and script URLs remain inside that prefix.

Auma Live keeps unmodified browser files in `source/`, its full imported code closure in `original-closure/`, and the target-owned entry and endpoint adaptation in `runtime/`. The target Host serves `/stock-apps/auma-live.html`, `/app/aumalive.js`, `/app/aumalive-audio.js`, `/app/aura-trace.js`, `/app/field-directives.js`, and `/app/lane-bridge.js`; provides the same-origin presence and selected-Session recent-chat routes; and proxies `/stock-apps/auma-live/voice` to a private loopback sidecar. The same entry accepts the validated `canvas` mode used by Auma Canvas, so its liquid field, Aura trace, microphone, transcript, continuous final-utterance capture, interruption, and speech path remain one implementation. Canvas mode sends bounded same-origin messages to the selected-Session bridge and receives only presentation states, final text, and errors; it never receives tool authority or interaction-response authority inside the iframe. `aura-trace.js` is a presentation-only use of Aura's canonical tesseract topology and does not read Aura coherence coefficients. No public route points at a donor checkout.

The five shell surfaces are always-mounted same-origin iframes. Four contain an imported application's native document; Auma Canvas mounts a second Auma Live document in `canvas` mode behind the selected-Session bridge. This retains document globals, native CSS, browser storage, and full-page behavior while the Host owns every byte and route. The iframe is containment inside this repository's runtime, not a dependency on another application server.

## Local duplex setup

The browser speech fallback and typed input require no Python setup. Local duplex voice uses the code under `auma-live/voice/`; install its managed environment and model weights in the clone. Do not run setup inside a release: added files break its strip manifest and the launcher refuses it. From the clone root:

```sh
cd plugins/aukora-face/apps/vendor/auma-live/voice
bash setup.sh   # needs uv
```

By default, the running Host looks for `.venv/bin/python` in the RELEASE's copy of this directory (it logs that path at boot), and a release does not carry `.venv/` or `models/`, so point `voiceRuntimeDirectory` in the `aukora-face-apps` config at the clone's `plugins/aukora-face/apps/vendor/auma-live/voice`. See [RUNNING.md](../../../../docs/RUNNING.md) for the overlay; a fresh install is NOT VERIFIED. The setup creates `.venv/` (Python 3.12 through `uv`, packages from PyPI per `requirements.txt`) and downloads model weights under this directory: `kokoro-v1.0.onnx` and `voices-v1.0.bin` from `github.com/thewh1teagle/kokoro-onnx` release `model-files-v1.0`, and `mlx-community/whisper-base.en-mlx` from Hugging Face; its warm-up then lets Pocket TTS fetch its own weights from Hugging Face. Those generated files are intentionally untracked and are not read from another repository. The Aurora prompt is not committed: setup derives it from two stock Kokoro voices under the app's state folder, while the sidecar reads the configured runtime's `models/` directory. The stock voice speaks; the cloned Aurora voice stays off. When `.venv/bin/python` exists, the stock-app Host may supervise `sidecar.py` and exposes it to the browser only through the same-origin WebSocket bridge.

## Dakini Code

The circle-menu User App is built from [aumara-xyz/dakini-code](https://github.com/aumara-xyz/dakini-code) at `1fc98117a9a6234e1179bc7c5084a58ade378963`. Run `npm ci && npm run build:app` in that source checkout and copy the complete `dist-app/` contents into `vendor/dakini-code/`. Update the source commit in [the manifest generator](../scripts/vendor-manifest.mjs), then run `pnpm vendor:manifest` and `pnpm vendor:check` in this package. The Host serves that static tree at `/stock-apps/dakini-code/`; its relative asset paths keep the app independent of checkout locations and development ports. Its same-origin shell activity messages pause hidden audio and rendering while retaining the selected glyph.

