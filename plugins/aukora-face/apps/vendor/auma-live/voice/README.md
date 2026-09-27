# Auma Live local voice organ

This directory is the runnable, repository-owned speech sidecar for Auma Live. It has no dependency on a donor checkout or another Aukora process. The `ui-stock-apps` host plugin launches `.venv/bin/python sidecar.py` from this directory, assigns its private loopback port through `AUKORA_VOICE_PORT`, and proxies the browser's same-origin `/stock-apps/auma-live/voice` WebSocket to it.

The sidecar owns only audio rendering and hearing:

- 16 kHz microphone PCM enters Silero VAD and Whisper STT.
- Final transcripts return to the browser, which sends them to the host-owned presence route.
- Streamed response text enters Pocket-TTS or Kokoro and returns as 24 kHz PCM.
- The browser worklet continuously resamples PCM across WebSocket frames, buffers the first 180 ms, and uses explicit stream-end markers so short replies play without waiting for another turn.
- Barge-in cancels queued speech and raises the VAD threshold while Auma is audible.
- Audio remains in memory. The sidecar is not handed harness credentials (its environment is scrubbed) and dispatches no model requests; it runs as the same user, so file permissions alone would not stop it reading them (same-UID ceiling).

The same-origin host owns model routing, identity and canon context, cross-lane continuity, session-event recording, and OpenRouter credentials. Browser speech recognition and speech synthesis remain the first-class fallback when the local sidecar is not installed.

## Local setup

Run once from this directory:

```sh
./setup.sh
```

The setup script creates `.venv` here, downloads open-source engine weights into `models/`, and, when it is absent, generates the clone prompt `models/aurora-prompt.wav` by synthesizing a sentence with a blend of two stock Kokoro voices. These generated files are intentionally untracked; the prompt is not committed. Pocket-TTS voice cloning remains subject to its upstream gated-model terms. The complete source and tests remain in this repository even when optional weights have not been downloaded.

After setup, restart the Aukora UI server. It launches and stops the sidecar with the Web host. For a manual diagnostic run:

```sh
AUKORA_VOICE_PORT=7512 ./run.sh
.venv/bin/python test_loop.py
AUKORA_SESSION_ID=<live-session-id> .venv/bin/python test_e2e.py
```

`test_e2e.py` uses `http://127.0.0.1:5173` by default. Set `AUKORA_WEB_URL` when the Aukora UI host uses another local address. The balanced voice mind is DeepSeek V4 Flash; its provider request is recorded and flushed to `AUKORA_SESSION_ID` before dispatch.

The private listener accepts no browser Origin by default. Browser access goes through the Web host proxy; local diagnostics without an Origin header can reach the private listener directly.

## Engines

| Role | Local engine |
| --- | --- |
| STT | MLX Whisper `base.en`, with `faster-whisper` CPU fallback |
| VAD | Silero v6 through the faster-whisper assets |
| Primary TTS | Kyutai Pocket-TTS |
| Fallback TTS | Kokoro-82M ONNX |

This directory is the host-integrated runnable copy of a donor-era voice directory that this repository does not carry.

