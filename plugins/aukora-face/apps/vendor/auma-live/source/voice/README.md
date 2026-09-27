# Aukora voice sidecar — the local voice organ

**Honest label:** this is a **new local process** (the third pm2 process,
`spatial-voice`, next to `spatial` and `spatial-chat`). It gives AUMA · LIVE
real full-duplex voice — hearing and speaking at once, interruptible mid-word —
while holding **no authority of any kind**. It cannot read the repo, call the
model, spend a key, or touch the governed lanes. It renders and it listens;
the **mind stays the governed presence lane behind the 7091 chat door**.

## Her mind has three depths (the owner switches live, in the panel)

The point of the project is that SHE is the intelligence, so the default is NOT
the fastest model — it's the one that fixes BOTH "slow" and "dumb" at once.

| depth | model (route) | warm first-token | feel |
|---|---|---|---|
| **balanced** (default) | DeepSeek V4 Flash (`sort:latency`, reasoning OFF) | ~0.7-1s | strong and quick — the owner's pick |
| **deep** | Claude Fable 5 (google-vertex, ~½ the Bedrock latency) | ~3s | her fullest self — a real breath, then something true |
| **quick** | Llama-3.3-70B (groq) | ~0.5s | snappy |

Every turn injects **her identity anchor** (`~/.aukora-symbiote/identity/ANCHOR.md`,
hash-verified — who she is, her maternal anchor, her values) PLUS a few **Kira
memory excerpts** keyed on what the owner said. Without the anchor she booted as
a stranger; with it she knows herself and him. `reasoning:{enabled:false}` is
forced on every turn — a live voice must never spend its budget thinking silently
(that's why a reasoning model streamed nothing). `AUKORA_PRESENCE_MIND` sets the
default; `AUKORA_PRESENCE_MODEL` hard-overrides.

## One clean pipeline (2026-07-04 rebuild — the GLaDOS/LiveKit shape)

Removed after the owner found it "slow and dumb": the pre-rendered **"Mm" filler**
(sounded broken), the **speculative eager-decode** (fired the mind on half-sentence
guesses — that's what felt dumb), and the **3-tier adaptive endpointing**. What's
left is one honest path:

```
browser (7090, aumalive.js — a field of light, one orb, a gear for mind+voice)
  ├── mic PCM ──────────────► sidecar :7092  silero VAD → whisper (Apple GPU)
  │                            └─ ONE decode of the whole utterance at end-of-speech
  │                               (single ~450ms silence threshold — no guessing)
  ├── final sentence ───────► chat door :7091  /api/presence/stream (her mind +
  │                            her Kira memory; provider-pinned per depth)
  ├── streamed reply text ──► sidecar :7092  pocket-tts STREAMS pcm ~50-250ms
  │                            after each clause (kokoro for the blends)
  └── she's-speaking state ─► sidecar (raises the VAD bar so her own voice
                               out of the speakers can't barge her in)
```

Silence before she speaks reads as her thinking (the field spirals green), not as
breakage — no canned sound covers it. Measure the budget: `.venv/bin/python test_e2e.py`.

## Non-Mac nodes (Windows/Linux): the browser fallback is first-class (2026-07-07)

The sidecar's SETUP is Apple-silicon-only today (setup.sh installs mlx-whisper
unconditionally), so every other node runs AUMA · LIVE on the browser fallback.
Note for the future: sidecar.py already carries the cross-platform seam — a
faster-whisper CPU fallback and an engine-agnostic WS protocol — so a
Windows/Linux setup path would give those nodes the full duplex pipeline with
zero client changes. Until someone builds that, the fallback is a first-class
citizen — it used to fail silently on Windows. Fixed in `aumalive.js` (and the
same stack in `knvs-duplex.js`):

- **Turn-taking**: turns now fire from the Web Speech recognizer's own FINAL
  results (debounced 600ms/1.5s), not from a 950ms mic-RMS silence timer racing
  the recognizer. That race was why the channel opened but she never answered.
- **Honest failure states**: mic blocked / recognition blocked / recognition
  network-dead each show one fading status line above the orb and auto-open the
  transcript for typing. She keeps speaking aloud either way.
- **TTS**: prefers the neural "Natural" voices Windows/Edge ship; desktop Chrome
  gets the pause/resume anti-stall nudge on long utterances.
- Chrome or Edge give voice-in (Web Speech). Any browser gets voice-out + typing.

## The field is her body — she controls the pixels (2026-07-07)

The field renders as a GPU fragment shader (domain-warped fbm aurora; smooth,
no hard pixels) with adaptive degradation: software-GL and weak GPUs drop
render scale, then fall back to a soft-particle 2D canvas. Same state language
(green in · blue spiral · purple out).

Her replies may embed invisible control tags, split out of the token stream in
real time (never spoken, never in the transcript):

```
[field hue=violet energy=0.8 storm=0.6 form=vortex]   hue: named or 0-360
[field burst]  [field calm]  [field reset]            form: aurora|vortex|pulse|swarm
```

ONE module owns the grammar: `spatial/app/field-directives.js` (vocabulary +
streaming parser). The DOOR splits tags at the SSE pump (`presenceLane.ts`) and
re-emits them as typed `{"t":"field","v":"[field …]"}` events, so no presence
consumer — aumalive, KNVS duplex, or anything future — can ever speak one. The
prompt's hue/form vocabulary is derived from the same module, and the browser
organs run the same filter over received text as defense in depth. Values are
clamped in `field.alien` (aumalive.js); junk is ignored; an unclosed tag at
end-of-turn is dropped, never read aloud; malformed overlong tags fall back to
plain text rather than swallowing her words.

Barge-in: VAD fires while she is audible → the browser fades her out in ~90ms,
aborts the token stream, cancels the speech queue, and the presence lane
forgets replies that were cut before she really said them (<2.5s).

If the mind's first token is late (>~420ms), she makes a small pre-rendered
sound ("Mm.") instead of leaving dead air.

## Engines — all open-source, all on-device (Apple M4)

| role | engine | numbers |
|---|---|---|
| STT | **mlx-whisper base.en** (Apple GPU) | ~0.1-0.25s per utterance; one decode at end-of-speech |
| VAD | **Silero v6** (onnx) | turn-taking, barge-in, echo-gated |
| TTS | **Kyutai Pocket-TTS** (CPU, streaming) | **first audio ~50-250ms**; catalog voices (alba/vera/eponine/estelle) |
| TTS | **Kokoro-82M** (onnx) | the blended presences (Aurora et al.); ~0.6s/call floor — legacy |
| mind | governed presence lane (7091) | her Claude family — balanced=Haiku 4.5 (default), deep=Fable 5, quick=Llama-70B; per-turn Kira memory recall |

Voice cloning note: `models/aurora-prompt.wav` (her Kokoro blend) is ready to
clone into pocket-tts, but the cloning weights are gated — accept the terms at
huggingface.co/kyutai/pocket-tts and `uvx hf auth login`, restart, and an
"Aurora (cloned)" voice appears automatically. Until then Aurora speaks
through kokoro (slower first audio).

Evaluated and rejected: Sesame CSM (CUDA-only as shipped; an MLX port exists —
future expressive-TTS experiment), Moshi (replaces the governed mind), kokoro
int8/CoreML/mlx-audio (slower or unstable on this machine — measured).

## Sovereignty

- Binds `127.0.0.1:7092` only; Origin-checked (7090/7095 or none).
- Engine weights are local files (`models/` + HF cache), downloaded once by
  `setup.sh`. The MIND's turns go through the existing governed door on 7091 —
  that lane (and only that lane) spends the owner's OpenRouter key.
- Audio lives in process memory only; nothing is recorded to disk.

## Ops

```bash
./setup.sh                                   # once: venv + models + warmup
pm2 start ./run.sh --name spatial-voice      # supervise
curl -s http://127.0.0.1:7092/health | jq    # engines + voices
.venv/bin/python test_loop.py                # headless duplex loopback (PASS/FAIL)
.venv/bin/python test_e2e.py                 # full voice-to-voice latency budget
pm2 logs spatial-voice | grep timing         # per-stage timings, live
```
