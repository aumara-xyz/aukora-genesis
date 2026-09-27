#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Aumara and Peter Viviani
"""
Aukora voice sidecar — the local voice organ for AUMA · LIVE.

WHAT THIS IS (honest label): a NEW local process. It is not the governed loop,
not the chat door, and holds NO authority. It is a rendering + hearing layer:
  mic PCM in  → Silero VAD (turn-taking / barge-in) → Whisper STT (words out)
  text in     → Pocket-TTS / Kokoro-82M (24 kHz PCM out, streamed as it renders)
The MIND stays the governed model behind the chat door (7091) — the browser
takes finals from here, sends them through the existing presence lane, and
feeds the streamed reply back here to be spoken. This process never calls the
model, never reads the repo, never touches keys.

SOVEREIGNTY POSTURE:
  - binds 127.0.0.1 ONLY (port 7092, env AUKORA_VOICE_PORT)
  - offline by configuration at runtime (HF_HUB_OFFLINE, TRANSFORMERS_OFFLINE, ORT_DISABLE_TELEMETRY; egress not yet measured by a court): every model is a local file under
    the user's state directory, `<state>/auma-live/voice/models` (downloaded once by setup.sh),
      or `$AUMA_LIVE_VOICE_MODELS` when it is set — the SAME expression setup.sh writes with
  - WebSocket upgrades and POSTs are refused unless the Origin is the spatial
    shell (7090) or absent (curl / local test tools)
  - audio is processed in memory only — nothing is written to disk

ENGINES (all open-source, all on-device, picked for this Mac — Apple M4):
  STT  mlx-whisper base.en   (MLX / Apple-GPU, ~0.1-0.3 s per utterance; ONE
       clean decode of the whole utterance at end-of-speech — no speculation)
       fallback: faster-whisper tiny.en (CPU int8) if MLX is unavailable
  VAD  Silero VAD v6         (ONNX, ships inside faster-whisper's assets)
  TTS  Kyutai Pocket-TTS     (CPU, STREAMS first audio in ~50-250 ms) — primary
       Kokoro-82M v1.0       (ONNX; the blended presences) — fallback/legacy

WIRE PROTOCOL (ws://127.0.0.1:7092/ws):
  browser → sidecar
    binary                     mic PCM, int16 mono @ 16 kHz, any chunking
    {"t":"tts","id":n,"text":s,"voice"?:s,"speed"?:f}   queue one spoken chunk
    {"t":"tts_cancel"}         barge-in: drop queued + in-flight speech
    {"t":"her","on":bool}      "she is audible right now" — raises VAD bar
                               so her own voice in the mic can't barge her in
    {"t":"reset"}              clear utterance state (channel open/close)
  sidecar → browser
    {"t":"ready",...}          engines + voice presences (on connect)
    {"t":"vad","speaking":b}   speech started / stopped (browser cuts her
                               playback on speaking:true — that IS barge-in)
    {"t":"final","text":s,"dur":f}  the finished utterance → send to the mind
    {"t":"tts_begin","id":n,"sr":24000} → binary int16 PCM frames → {"t":"tts_end","id":n}
    {"t":"tts_cancelled"}      ack of tts_cancel (queue drained)
"""

import asyncio
import json
import logging
import os
import signal
import subprocess
import sys
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor

import numpy as np

# kokoro's phonemizer logs a "words count mismatch" WARNING on almost every
# short line — hundreds of lines of noise in the pm2 err log that buried the
# one message that mattered (the Errno 48 bind race). Quiet it to ERROR.
logging.getLogger("phonemizer").setLevel(logging.ERROR)

HERE = os.path.dirname(os.path.abspath(__file__))
# ── aura-83 (gap 5): THE READER NOW RESOLVES THE SAME PATH THE WRITER WRITES. ─────────────────────────
# **`MODELS = os.path.join(HERE, "models")` LOOKED BESIDE THIS FILE, WHILE `setup.sh` WROTE UNDER THE
# USER'S STATE DIR.** *Two absolute paths, neither derived from the other* -- **so a sidecar started from a
# release looked in `<sidecar dir>/models`, which is the directory `setup.sh` stopped writing to** when it
# was fixed. *The egress audit asked that the two "agree on ONE voice path under the user's state dir"; the
# writer half was already done and this was the half still resolving elsewhere.*
#
# **THE EXPRESSION BELOW IS THE ONE `setup.sh` *SHOULD* WRITE WITH -- AND IT DOES NOT (CORRECTED, aura-83).**
# *** THIS COMMENT USED TO SAY THE TWO AGREED "BYTE FOR BYTE" AND "BY CONSTRUCTION". THAT WAS FALSE, AND I WROTE
# IT WITHOUT OPENING `setup.sh`. *** *Measured afterwards*: `setup.sh` does `mkdir -p models` and
# `curl -L -o models/kokoro-v1.0.onnx`, *a path RELATIVE TO ITSELF*, **and it names neither
# `AUMA_LIVE_VOICE_MODELS` nor `AUKORA_STATE_DIR` anywhere.** *So the reader below resolves under the user's state
# directory while the writer fills a directory beside the script* -- **which is the same "two absolute paths,
# neither derived from the other" failure this comment claimed to have closed.** *The other copy,
# `vendor/auma-live/voice/setup.sh`, is worse: it writes `models` AND `$PWD/models/huggingface` as `HF_HOME`.*
#
# **AND THE VARIABLE NAME WAS MINE TO GET WRONG, WHICH R129 FOUND.** *This expression used to read
# `AUMA_LIVE_VOICE_MODELS` FIRST* -- *a name **NOTHING ELSE IN THIS TREE SETS*** -- **while three callers speak
# `AUKORA_VOICE_MODELS_DIR`:** *`scripts/aukora/voice-footprint.sh:42`, which then REFUSES at `:43` when the
# directory is missing; `plugins/aukora-spatial/ui-stock-apps/tests/voice-supervisor.host.spec.ts:88`; and the
# other copy of this file.* *** So the objective asked for ONE voice path and this lane's fix created a SECOND
# NAME *** -- *the opposite of the clause it was written to satisfy.* **`AUKORA_VOICE_MODELS_DIR` is now FIRST,
# and `AUMA_LIVE_VOICE_MODELS` is kept as a second choice so nothing that already exports it breaks.**
#
# **THE READER HALF IS FIXED AND THE WRITER HALF IS NOT -- and the writer is AUMA's to move** (the egress audit's
# gap 5 says "coordinate with AUMA, who is moving the wav out"). **An operator who sets the env var today moves
# ONE end, not both.** *Until `setup.sh` writes with this expression, the honest claim is that the READER is
# correct -- not that the two agree.*
#
# *`HERE` is kept: it is still used elsewhere in this file, and removing it would be a second change in a
# fix whose whole point is that it changes one thing.*
MODELS = (os.environ.get("AUKORA_VOICE_MODELS_DIR")
          or os.environ.get("AUMA_LIVE_VOICE_MODELS")
          or os.path.join(
              os.environ.get("AUKORA_STATE_DIR")
              or os.path.expanduser("~/Library/Application Support/AUKORA/state"),
              "auma-live", "voice", "models"))

PORT = int(os.environ.get("AUKORA_VOICE_PORT", "7092"))
HOST = "127.0.0.1"  # loopback only — never configurable outward
ALLOWED_ORIGINS = {
    "http://127.0.0.1:7090", "http://localhost:7090",
    "http://127.0.0.1:7095", "http://localhost:7095",  # spatial-verify (headless checks)
}

SR_IN = 16000          # mic sample rate (browser downsamples to this)
SR_OUT = 24000         # kokoro output rate
FRAME = 512            # VAD frame @ 16 kHz = 32 ms
VAD_CTX = 64           # silero v6 wants 64 samples of left-context per frame

# --- turn-taking tuning (frames are 32 ms) ---
# ONE clean endpointing path (the GLaDOS/LiveKit rule: prove the flat baseline
# before adding semantics). Speculative eager-decode and the 3-tier adaptive
# commit were removed 2026-07-04 — they fired the mind on half-sentence guesses,
# which is what made her feel dumb (answering before the owner finished).
START_PROB = 0.55      # speech starts above this…
START_PROB_HER = 0.82  # …but while SHE is audible the bar is much higher
END_PROB = 0.35        # below this counts toward end-of-utterance
MIN_START_FRAMES = 4       # 128 ms of speech to open an utterance
MIN_START_FRAMES_HER = 9   # 288 ms sustained to count as a real interruption
PREROLL_FRAMES = 10        # 320 ms kept from before speech started
MAX_UTTER_SEC = 25         # force-close runaway utterances
END_SILENCE_FRAMES = 12    # ~384 ms of quiet ends the turn (single threshold;
                           #   >600 ms is where "talking to a machine" creeps in,
                           #   <300 ms clips people who pause mid-thought)

TTS_MAX_TEXT = 400
TTS_QUEUE_MAX = 64
TTS_CHUNK = 7200           # samples per binary frame (0.3 s @ 24 kHz)

STT_POOL = ThreadPoolExecutor(1, thread_name_prefix="stt")
TTS_POOL = ThreadPoolExecutor(1, thread_name_prefix="tts")        # kokoro (ONNX session is shared + unlocked → keep size 1)
POCKET_POOL = ThreadPoolExecutor(1, thread_name_prefix="pocket")  # pocket streaming — its OWN pool so a slow kokoro
                                                                  # synth can't head-of-line-block a fast pocket turn

# How long, after the last audio frame we actually pushed to a client, we keep
# the VAD start-bar raised so her own voice can't barge her. A BOUNDED lease
# (never inf): if the client's "she stopped" signal is ever lost, the bar
# self-heals this many seconds later instead of latching the mic half-deaf.
HER_LEASE_SEC = 1.5


# ---------------------------------------------------------------------------
# engines
# ---------------------------------------------------------------------------

class Stt:
    """Whisper, preferring MLX (Apple GPU); faster-whisper tiny.en as fallback."""

    def __init__(self):
        self.kind = ""
        self._mlx_path = os.path.join(MODELS, "whisper-base.en-mlx")
        try:
            import mlx_whisper  # noqa: F401
            if not os.path.isdir(self._mlx_path):
                raise FileNotFoundError(self._mlx_path)
            self._mlx = mlx_whisper
            # warm the graph so the first real utterance isn't slow
            self._mlx.transcribe(np.zeros(SR_IN // 2, dtype=np.float32),
                                 path_or_hf_repo=self._mlx_path)
            self.kind = "mlx-whisper base.en"
        except Exception as e:  # pragma: no cover - depends on host
            print(f"[stt] mlx unavailable ({e}); falling back to faster-whisper tiny.en", flush=True)
            from faster_whisper import WhisperModel
            self._fw = WhisperModel("tiny.en", device="cpu", compute_type="int8",
                                    download_root=os.path.join(MODELS, "whisper"))
            self._mlx = None
            self.kind = "faster-whisper tiny.en"

    def decode(self, audio: np.ndarray) -> str:
        """Blocking — call on STT_POOL. audio: float32 mono @ 16 kHz."""
        if self._mlx is not None:
            r = self._mlx.transcribe(audio, path_or_hf_repo=self._mlx_path,
                                     language="en", temperature=0.0,
                                     condition_on_previous_text=False, verbose=None)
            return clean_text(r.get("text", ""))
        segs, _ = self._fw.transcribe(audio, language="en", beam_size=1,
                                      without_timestamps=True)
        return clean_text(" ".join(s.text for s in segs))


def clean_text(s: str) -> str:
    """Strip whisper's cut-off-audio artifacts (junk tokens on partials)."""
    s = s.strip()
    for junk in ("//", "♪", "[BLANK_AUDIO]", "[ Silence ]", "(silence)", "[Music]", "(music)"):
        s = s.replace(junk, " ")
    s = " ".join(s.split())
    # a bare run of dots/punctuation is not speech
    if not any(ch.isalnum() for ch in s):
        return ""
    return s


class Vad:
    """Silero VAD v6 (ONNX) — one shared session, per-connection state."""

    def __init__(self):
        import faster_whisper
        import onnxruntime as ort
        path = os.path.join(os.path.dirname(faster_whisper.__file__),
                            "assets", "silero_vad_v6.onnx")
        opts = ort.SessionOptions()
        opts.log_severity_level = 3
        self.sess = ort.InferenceSession(path, opts, providers=["CPUExecutionProvider"])

    def fresh_state(self):
        return {
            "h": np.zeros((1, 1, 128), dtype=np.float32),
            "c": np.zeros((1, 1, 128), dtype=np.float32),
            "ctx": np.zeros(VAD_CTX, dtype=np.float32),
        }

    def step(self, st, frame: np.ndarray) -> float:
        """frame: float32[512] @ 16 kHz → speech probability."""
        inp = np.concatenate([st["ctx"], frame]).reshape(1, VAD_CTX + FRAME)
        out, st["h"], st["c"] = self.sess.run(None, {"input": inp, "h": st["h"], "c": st["c"]})
        st["ctx"] = frame[-VAD_CTX:]
        return float(np.asarray(out).reshape(-1)[0])


class PocketTts:
    """Kyutai Pocket TTS — the low-latency engine. Streams audio ~50ms after
    the text arrives (vs kokoro's ~650ms fixed floor), CPU-only, 24 kHz.
    Catalog voices ship as precomputed embeddings; true voice cloning (the
    Aurora blend) unlocks only after the owner accepts the HF terms for
    kyutai/pocket-tts — we try, and quietly skip if not entitled."""

    # voice id → (catalog name, label, hint). "auma" is her everyday voice: a
    # warm, soft-English catalog voice that STREAMS (fast, smooth). Her exact
    # "aurora" blend lives on kokoro (richer but non-streaming, so slower); the
    # true streamed clone of it needs the gated pocket-tts cloning weights.
    VOICES = {
        "auma":    ("vera", "Auma", "her everyday voice — warm, fast, streaming"),
        "alba":    ("alba", "Alba", "Scottish, casual"),
        "eponine": ("eponine", "Eponine", "bright English"),
        "estelle": ("estelle", "Estelle", "French-accented"),
    }

    def __init__(self):
        from pocket_tts import TTSModel
        self.model = TTSModel.load_model()
        self.states = {}
        # default voice ("auma") ready before we serve; the rest warm lazily
        self.states["auma"] = self.model.get_state_for_audio_prompt(self.VOICES["auma"][0])
        # opportunistic Aurora clone — her true streamed voice. Needs the GATED
        # pocket-tts cloning weights (repo kyutai/pocket-tts): the owner must
        # accept the terms at https://huggingface.co/kyutai/pocket-tts while
        # logged in (`hf auth login`). Once granted, this loads and becomes the
        # default automatically. We log WHY it's off so the owner gets feedback.
        try:
            prompt = os.path.join(MODELS, "aurora-prompt.wav")
            if os.path.exists(prompt):
                self.states["aurora-live"] = self.model.get_state_for_audio_prompt(prompt)
                self.VOICES = {"aurora-live": ("aurora-live", "Aurora", "her own blend — cloned, streaming"), **self.VOICES}
                print("[voice] aurora voice-clone ACTIVE — her real streamed voice is live", flush=True)
            else:
                print(f"[voice] aurora clone off: no prompt wav at {prompt}", flush=True)
        except Exception as e:
            reason = str(e)
            if "gated" in reason.lower() or "restricted" in reason.lower() or "403" in reason:
                print("[voice] aurora clone off: GATED — accept terms at "
                      "https://huggingface.co/kyutai/pocket-tts (logged in), then restart", flush=True)
            else:
                print(f"[voice] aurora clone off: {reason[:160]}", flush=True)

    def state_for(self, vid: str):
        if vid not in self.states:
            self.states[vid] = self.model.get_state_for_audio_prompt(self.VOICES[vid][0])
        return self.states[vid]

    def warm_all(self):
        for vid in list(self.VOICES):
            self.state_for(vid)

    def stream(self, vid: str, text: str, alive):
        """Blocking generator (run on TTS_POOL): yields int16 PCM chunks.
        `alive()` is checked between chunks so barge-in stops generation."""
        state = self.state_for(vid)
        cap = max(40, min(300, int(len(text) * 1.2)))
        for ch in self.model.generate_audio_stream(state, text, max_tokens=cap, copy_state=True):
            if not alive():
                break
            a = ch.reshape(-1).clamp(-1, 1).numpy()
            yield (a * 32767).astype(np.int16)

    def synth(self, vid: str, text: str) -> np.ndarray:
        """Blocking full synth (one-shot, non-streaming)."""
        return np.concatenate(list(self.stream(vid, text, lambda: True)))


class Tts:
    """Kokoro-82M with named 'presences' (pure voices + blends)."""

    def __init__(self):
        from kokoro_onnx import Kokoro
        self.k = Kokoro(os.path.join(MODELS, "kokoro-v1.0.onnx"),
                        os.path.join(MODELS, "voices-v1.0.bin"))
        style = self.k.get_voice_style
        blend = lambda pairs: sum(style(n) * w for n, w in pairs).astype(np.float32)
        # name → (style, lang, base_speed, label, hint)
        self.presences = {
            "aurora":      (blend([("bf_emma", 0.65), ("af_nicole", 0.35)]), "en-gb", 1.04,
                            "Aurora", "her own blend — British warmth with a breath of static"),
            "emma":        (style("bf_emma"), "en-gb", 1.0, "Emma", "British, warm"),
            "isabella":    (style("bf_isabella"), "en-gb", 1.0, "Isabella", "British, lower"),
            "alice":       (style("bf_alice"), "en-gb", 1.0, "Alice", "British, bright"),
            "continental": (blend([("bf_emma", 0.55), ("ff_siwis", 0.45)]), "en-gb", 1.0,
                            "Continental", "European blend (experimental)"),
            "nicole":      (style("af_nicole"), "en-us", 1.0, "Nicole", "a whisper"),
        }
        self.default = "aurora"

    def voice_list(self):
        # engine tag: kokoro voices are the richer blends but DON'T stream — they
        # synthesize the whole chunk before any audio plays (0.6s floor, seconds
        # under load), so the client can steer live voice to the fast pocket path.
        return [{"id": k, "label": v[3], "hint": v[4], "engine": "kokoro"} for k, v in self.presences.items()]

    def synth(self, text: str, voice: str, speed: float) -> np.ndarray:
        """Blocking — call on TTS_POOL. Returns int16 mono @ 24 kHz."""
        style, lang, base, _, _ = self.presences.get(voice) or self.presences[self.default]
        samples, sr = self.k.create(text, voice=style, speed=base * speed, lang=lang)
        assert sr == SR_OUT
        return (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16)


# ---------------------------------------------------------------------------
# per-connection duplex session
# ---------------------------------------------------------------------------

class _SocketGone(Exception):
    """Raised inside TTS synthesis when a ws write fails — the connection is gone,
    so the worker should stop (not spin) and let s.close() reap it."""


class Session:
    def __init__(self, ws, engines, loop):
        self.ws = ws
        self.stt, self.vad, self.tts, self.pocket, self.default_voice = engines
        self.loop = loop
        self.vst = self.vad.fresh_state()
        self.leftover = np.zeros(0, dtype=np.float32)
        self.preroll = deque(maxlen=PREROLL_FRAMES)
        self.utter: list = []
        self.speaking = False
        self.speech_run = 0
        self.silence_run = 0
        self.gen = 0                      # utterance generation
        self.her_until = 0.0              # while now < her_until, VAD bar is raised
        self.tts_q: asyncio.Queue = asyncio.Queue(TTS_QUEUE_MAX)
        self.tts_cancel = 0               # cancellation generation
        self.tts_task = loop.create_task(self._tts_worker())

    # ---- mic / VAD / STT ----
    # ONE clean path: accumulate speech, and when END_SILENCE_FRAMES of quiet
    # have passed, decode the WHOLE utterance once and send it. No speculation,
    # no partials — the mind only ever sees a complete, real sentence.

    def feed(self, pcm16: bytes):
        audio = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768.0
        self.leftover = np.concatenate([self.leftover, audio])
        while len(self.leftover) >= FRAME:
            frame, self.leftover = self.leftover[:FRAME], self.leftover[FRAME:]
            self._frame(frame)

    def _frame(self, frame: np.ndarray):
        prob = self.vad.step(self.vst, frame)
        now = time.monotonic()
        her = now < self.her_until
        if not self.speaking:
            self.preroll.append(frame)
            if prob >= (START_PROB_HER if her else START_PROB):
                self.speech_run += 1
                if self.speech_run >= (MIN_START_FRAMES_HER if her else MIN_START_FRAMES):
                    self.speaking = True
                    self.silence_run = 0
                    self.utter = list(self.preroll)
                    self.send({"t": "vad", "speaking": True})
            else:
                self.speech_run = 0
            return
        # in an utterance
        self.utter.append(frame)
        self.silence_run = self.silence_run + 1 if prob < END_PROB else 0
        too_long = len(self.utter) * FRAME / SR_IN > MAX_UTTER_SEC
        if self.silence_run >= END_SILENCE_FRAMES or too_long:
            self._end_utterance()

    def _end_utterance(self):
        audio = np.concatenate(self.utter) if self.utter else np.zeros(0, dtype=np.float32)
        gap_ms = int(self.silence_run * FRAME / SR_IN * 1000)
        self.speaking = False
        self.speech_run = 0
        self.silence_run = 0
        self.utter = []
        self.gen += 1
        self.send({"t": "vad", "speaking": False})
        dur = len(audio) / SR_IN
        if dur < 0.25:
            return
        self.loop.create_task(self._decode_final(audio, dur, gap_ms))

    async def _decode_final(self, audio, dur, gap_ms=0):
        t0 = time.monotonic()
        text = await self.loop.run_in_executor(STT_POOL, self.stt.decode, audio)
        print(f"[timing] endpoint={gap_ms}ms stt={int((time.monotonic()-t0)*1000)}ms dur={dur:.2f}s", flush=True)
        self.send({"t": "final", "text": text, "dur": round(dur, 2)})

    def reset(self):
        self.vst = self.vad.fresh_state()
        self.leftover = np.zeros(0, dtype=np.float32)
        self.preroll.clear()
        self.utter = []
        self.speaking = False
        self.speech_run = 0
        self.silence_run = 0
        self.gen += 1
        # F1: drop any raised her-bar on reset. The client sends {"t":"reset"} on
        # every channel (re)open, so this makes close→reopen a real recovery from
        # a stuck bar — previously ONLY a full socket reconnect cleared it.
        self.her_until = 0.0

    # ---- TTS ----

    async def say(self, msg):
        # The client increments its own ttsPending for THIS id before sending, and
        # only settles it on a matching tts_end. So every id we accept MUST get a
        # terminal tts_end — even on the drop paths below — or the client's "she is
        # audible" flag (and the sidecar her-bar it drives) never comes back down.
        cid = int(msg.get("id", 0))
        text = str(msg.get("text", ""))[:TTS_MAX_TEXT].strip()
        if not text:
            self.send({"t": "tts_end", "id": cid})
            return
        voice = str(msg.get("voice", "")) or self.default_voice
        # H5: coerce an unknown voice (a stale client pick, a name that no longer
        # exists) to the default rather than KeyError-ing deep in the worker.
        if voice not in self.pocket.VOICES and voice not in self.tts.presences:
            voice = self.default_voice
        # KOKORO ONLY: the first chunk of a turn is split at a word boundary
        # (~30 chars) so the head clears kokoro's ~0.6s per-call floor sooner.
        # Pocket streams from the first frame, so splitting would only hurt it.
        parts = [text]
        if msg.get("first") and voice not in self.pocket.VOICES and len(text) > 45:
            cut = text.rfind(" ", 12, 34)
            if cut < 0:
                cut = text.find(" ", 34)
            if 0 < cut < len(text) - 8:
                parts = [text[:cut], text[cut + 1:]]
        item = (self.tts_cancel, cid, parts, voice, float(msg.get("speed", 1.0)))
        try:
            self.tts_q.put_nowait(item)
        except asyncio.QueueFull:
            self.send({"t": "err", "where": "tts", "msg": "queue full"})
            self.send({"t": "tts_end", "id": cid})  # F4: settle the client's ttsPending even when dropped

    def cancel_tts(self):
        self.tts_cancel += 1
        while not self.tts_q.empty():
            try:
                self.tts_q.get_nowait()
            except asyncio.QueueEmpty:
                break
        self.send({"t": "tts_cancelled"})

    def _bump_her(self):
        # F2 pairing: while audio is actually flowing to the client, keep the
        # her-bar raised so her own voice can't self-barge. It lapses
        # HER_LEASE_SEC after the LAST frame we send — so a long (>8s) kokoro
        # reply never self-barges mid-sentence, and a lost client "off" self-heals.
        self.her_until = max(self.her_until, time.monotonic() + HER_LEASE_SEC)

    async def _tts_worker(self):
        # Bulletproof consumer: NO single item may kill this loop. A dead worker
        # means the queue fills and she goes permanently mute until reconnect —
        # that was a real hard-mute path. Every item that reaches processing emits
        # exactly ONE terminal tts_end (in `finally`) so the client's ttsPending —
        # and the her-bar it drives — always settles back down.
        while True:
            gen, cid, parts, voice, speed = await self.tts_q.get()
            if gen != self.tts_cancel:
                continue  # cancelled before we dequeued it; client already zeroed via tts_cancelled
            try:
                await self._say_one(gen, cid, parts, voice, speed)
            except _SocketGone:
                self.send({"t": "tts_end", "id": cid})
                return  # socket is gone; the connection's finally:s.close() cancels us
            except Exception as e:
                print(f"[voice] tts item error: {str(e)[:160]}", flush=True)
            self.send({"t": "tts_end", "id": cid})

    async def _say_one(self, gen, cid, parts, voice, speed):
        begun = False
        t0 = time.monotonic()

        if voice in self.pocket.VOICES:
            # STREAMING path: pocket yields ~80ms frames as it generates;
            # first audio leaves the socket ~50-250ms after the text lands.
            q: asyncio.Queue = asyncio.Queue()
            text = " ".join(parts)

            def produce():
                try:
                    for pcm in self.pocket.stream(voice, text, lambda: gen == self.tts_cancel):
                        self.loop.call_soon_threadsafe(q.put_nowait, pcm)
                except Exception as e:
                    print(f"[voice] pocket error: {str(e)[:160]}", flush=True)
                self.loop.call_soon_threadsafe(q.put_nowait, None)

            self.loop.run_in_executor(POCKET_POOL, produce)
            while True:
                pcm = await q.get()
                if pcm is None:
                    break
                if gen != self.tts_cancel:
                    continue  # cancelled — drain the queue silently
                if not begun:
                    print(f"[timing] tts first-audio={int((time.monotonic()-t0)*1000)}ms "
                          f"(pocket:{voice}, {len(text)}ch)", flush=True)
                    self.send({"t": "tts_begin", "id": cid, "sr": SR_OUT})
                    begun = True
                self._bump_her()
                try:
                    await self.ws.send_bytes(pcm.tobytes())
                except Exception:
                    raise _SocketGone()
            return

        # kokoro path (blends / legacy presences)
        for text in parts:
            pcm = await self.loop.run_in_executor(
                TTS_POOL, self.tts.synth, text, voice, max(0.6, min(1.6, speed)))
            if gen != self.tts_cancel:
                break  # cancelled while synthesizing — drop silently
            if not begun:
                print(f"[timing] tts first-audio={int((time.monotonic()-t0)*1000)}ms "
                      f"(kokoro, {len(parts)} part(s), head={len(text)}ch)", flush=True)
                self.send({"t": "tts_begin", "id": cid, "sr": SR_OUT})
                begun = True
            for i in range(0, len(pcm), TTS_CHUNK):
                if gen != self.tts_cancel:
                    break
                self._bump_her()
                try:
                    await self.ws.send_bytes(pcm[i:i + TTS_CHUNK].tobytes())
                except Exception:
                    raise _SocketGone()

    # ---- plumbing ----

    def send(self, obj):
        self.loop.create_task(self._send(obj))

    async def _send(self, obj):
        try:
            await self.ws.send_json(obj)
        except Exception:
            pass

    def close(self):
        self.tts_task.cancel()


# ---------------------------------------------------------------------------
# server
# ---------------------------------------------------------------------------

def origin_ok(request) -> bool:
    origin = request.headers.get("Origin", "")
    return (not origin) or origin in ALLOWED_ORIGINS


MODEL_FLOOR = int(os.environ.get("AUMA_VOICE_MEMORY_FLOOR") or 50)
# The SAME floor, read the SAME way, as `scripts/lib/heavy-run-cli.mjs:60` — one policy, two readers.


def memory_level():
    """`kern.memorystatus_level`, or None when it cannot be read. None IS NOT A PASS."""
    try:
        done = subprocess.run(["/usr/sbin/sysctl", "-n", "kern.memorystatus_level"],
                              capture_output=True, text=True, timeout=5)
        return int(done.stdout.strip())
    except Exception:
        return None


def live_kokoro_catalogue(live_names, presences):
    """The kokoro catalogue IF that engine is already resident, else None — a health probe is not a use."""
    return presences if "tts" in live_names else None


def voice_catalogue(pocket_voices, kokoro_presences=None):
    """The voice menu, from the CATALOGUES and never from an engine."""
    pv = [{"id": k, "label": v[1], "hint": v[2], "engine": "pocket"} for k, v in pocket_voices.items()]
    kv = [] if kokoro_presences is None else [
        {"id": k, "label": v[3], "hint": v[4], "engine": "kokoro"} for k, v in kokoro_presences.items()
    ]
    return pv + kv


async def main():
    from aiohttp import WSMsgType, web

# ---------------------------------------------------------------------------
# lazy engines — LOADED ON FIRST USE, DROPPED AFTER IDLE
# ---------------------------------------------------------------------------
#
# **CONSTRUCTION IS THE LOAD, AND THIS USED TO HAPPEN AT STARTUP.** `Stt.__init__` imports mlx_whisper and resolves
# the model directory; `Tts` and `PocketTts` pull their weights; `Vad` loads the ONNX session. All four ran before
# the sidecar served anything, and the old code then WARMED both TTS engines with a synthetic utterance — so the
# whole set sat in RAM all day whether or not Peter ever opened Auma Live.
#
# The engines are now held HERE and reached through a proxy, so every existing call site keeps working unchanged:
# `stt.transcribe(...)` resolves the engine on the way in. The proxy deliberately holds NO reference to the engine
# — it asks the owner each time — which is what lets the sweeper drop one and have the next call reload it.

VOICE_IDLE_SECONDS = float(os.environ.get("AUMA_VOICE_IDLE_SECONDS") or 600.0)
# How often the sweeper looks. Bounded below so a tiny idle value cannot spin, and above so an idle engine is not
# held far past its deadline.
VOICE_SWEEP_SECONDS = max(1.0, min(30.0, VOICE_IDLE_SECONDS / 4.0))


class LazyEngines:
    """Holds engines that are built on first use and dropped once idle.

    Every load and unload prints a NAMED line, because the point of the exercise is that Peter can watch the RAM
    come back — and a limit that does not print did not happen.
    """

    def __init__(self, idle_seconds=VOICE_IDLE_SECONDS, clock=time.monotonic, log=print,
                 level=memory_level, floor=MODEL_FLOOR):
        self.idle_seconds = idle_seconds
        self._clock = clock
        self._log = log
        self._level = level
        self._floor = floor
        self.refusals = 0
        self._live = {}          # name -> (engine, last_used_monotonic)
        self.loads = 0
        self.unloads = 0

    def get(self, name, factory):
        """The engine, loading it if it is not live. Every call counts as a use."""
        entry = self._live.get(name)
        if entry is None:
            # THE FLOOR IS CHECKED AT THE MOMENT OF LOAD, and FAILS CLOSED on an unreadable level.
            level = self._level()
            if level is None:
                self.refusals += 1
                raise MemoryError(f"memory-level-unreadable: kern.memorystatus_level could not be read, so loading "
                                  f"'{name}' cannot be shown to be safe — nothing was loaded")
            if level < self._floor:
                self.refusals += 1
                raise MemoryError(f"memory-below-model-floor: kern.memorystatus_level is {level} and loading "
                                  f"'{name}' needs {self._floor} — nothing was loaded")
            t0 = time.time()
            engine = factory()
            self._live[name] = [engine, self._clock()]
            self.loads += 1
            self._log(f"[voice-engine] LOAD {name} in {time.time() - t0:.1f}s "
                      f"(idle-unload in {self.idle_seconds:.0f}s)")
            return engine
        entry[1] = self._clock()
        return entry[0]

    def sweep(self):
        """Drop every engine idle past the deadline — and ALL of them while the floor is not met."""
        now = self._clock()
        dropped = []
        level = self._level()
        if level is not None and level < self._floor:
            for name in list(self._live):
                del self._live[name]
                self.unloads += 1
                dropped.append(name)
            if dropped:
                self._log(f"[voice-engine] WATCHDOG level {level} < {self._floor}: dropped {', '.join(sorted(dropped))}")
            return dropped
        for name, entry in list(self._live.items()):
            idle = now - entry[1]
            if idle >= self.idle_seconds:
                del self._live[name]
                self.unloads += 1
                dropped.append(name)
                self._log(f"[voice-engine] UNLOAD {name} after {idle:.0f}s idle")
        return dropped

    def live(self):
        """The names currently resident."""
        return sorted(self._live)

    async def sweeper(self, interval=None):
        """Drop idle engines forever. Cancelled when the sidecar stops."""
        every = VOICE_SWEEP_SECONDS if interval is None else interval
        while True:
            await asyncio.sleep(every)
            try:
                self.sweep()
            except Exception as error:            # a sweeper that dies stops reclaiming memory silently
                self._log(f"[voice-engine] sweep failed: {error!r}")


class _EngineProxy:
    """Forwards to a live engine, loading it on the way in. Holds no reference of its own."""

    __slots__ = ("_owner", "_name", "_factory")

    def __init__(self, owner, name, factory):
        self._owner = owner
        self._name = name
        self._factory = factory

    def __getattr__(self, attribute):
        return getattr(self._owner.get(self._name, self._factory), attribute)

    def __repr__(self):
        return f"<engine {self._name} live={self._name in self._owner.live()}>"


async def main():
    from aiohttp import WSMsgType, web

    t0 = time.time()
    # **NOTHING IS LOADED HERE.** These four are proxies; the engines appear on first use and leave when idle.
    print("[voice] engines are lazy — nothing loads until the first open or voice use", flush=True)
    engines = LazyEngines()
    stt = _EngineProxy(engines, "stt", Stt)
    vad = _EngineProxy(engines, "vad", Vad)
    tts = _EngineProxy(engines, "tts", Tts)
    pocket = _EngineProxy(engines, "pocket", PocketTts)
    asyncio.create_task(engines.sweeper())
    # **`PocketTts.VOICES` IS READ OFF THE CLASS, NOT THE PROXY.** Touching the proxy here would construct the
    # engine during startup — reinstating exactly the load this change removes, and doing it invisibly.
    default_voice = "aurora-live" if "aurora-live" in PocketTts.VOICES else "auma"
    loop = asyncio.get_running_loop()
    # **THE WARM-UP AND THE BACKGROUND CATALOG WARM ARE BOTH GONE.** Two synthetic utterances pulled BOTH TTS
    # engines in before the sidecar served anything, and `pocket.warm_all` then pulled the whole catalog in the
    # background — every one of those voices resident whether or not Peter ever spoke. The first real turn pays
    # for the engine it needs, once, and the idle sweeper gives the memory back afterwards.
    print(f"[voice] ready in {time.time() - t0:.1f}s — engines load on first use, "
          f"idle-unload {VOICE_IDLE_SECONDS:.0f}s, default={default_voice}", flush=True)

    def voice_list():
        # **THE KOKORO ENTRY APPEARS ONLY IF ITS ENGINE IS ALREADY LIVE** — a health probe or a new connection must
        # not construct it, and `getattr(tts, …)` (which WOULD) is reached only after that gate.
        live = engines.live()
        kokoro = live_kokoro_catalogue(live, getattr(tts, "presences", None) if "tts" in live else None)
        return voice_catalogue(pocket.VOICES, kokoro)

    started = time.time()

    async def health(request):
        if not origin_ok(request):
            return web.json_response({"error": "origin"}, status=403)
        return web.json_response({
            "ok": True,
            "organ": "voice-sidecar",
            "authority": "none — rendering and hearing only; the mind is the governed door on 7091",
            "engines": {"stt": stt.kind, "tts": "pocket-tts (streaming) + kokoro-82M (onnx)", "vad": "silero-vad v6 (onnx)"},
            "voices": voice_list(),
            "default_voice": default_voice,
            "uptimeSec": round(time.time() - started, 1),
            "egress": "offline by configuration, not measured — 127.0.0.1 only, all models local files",
        })

    async def ws_handler(request):
        if not origin_ok(request):
            return web.Response(status=403, text="origin not allowed")
        ws = web.WebSocketResponse(max_msg_size=2 ** 22, heartbeat=30)
        await ws.prepare(request)
        loop = asyncio.get_running_loop()
        s = Session(ws, (stt, vad, tts, pocket, default_voice), loop)
        await ws.send_json({
            "t": "ready",
            "engines": {"stt": stt.kind, "tts": "pocket-tts + kokoro-82M", "vad": "silero-v6"},
            "voices": voice_list(),
            "default_voice": default_voice,
            "sr_in": SR_IN, "sr_out": SR_OUT,
        })
        try:
            async for msg in ws:
                if msg.type == WSMsgType.BINARY:
                    s.feed(msg.data)
                elif msg.type == WSMsgType.TEXT:
                    try:
                        m = json.loads(msg.data)
                    except Exception:
                        continue
                    t = m.get("t")
                    if t == "tts":
                        await s.say(m)
                    elif t == "tts_cancel":
                        s.cancel_tts()
                    elif t == "her":
                        # F2: NEVER latch to inf. "on" grants a bounded lease that the
                        # TTS worker refreshes per audio frame while she's actually
                        # speaking; if the client's "off" is ever lost (tab backgrounded
                        # mid-playback, socket hiccup), the bar self-heals in ~HER_LEASE_SEC.
                        s.her_until = (time.monotonic() + HER_LEASE_SEC) if m.get("on") else time.monotonic() + 0.3
                    elif t == "reset":
                        s.reset()
                elif msg.type == WSMsgType.ERROR:
                    break
        finally:
            s.close()
        return ws

    app = web.Application()
    app.router.add_get("/health", health)
    app.router.add_get("/ws", ws_handler)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, HOST, PORT)
    # H1: the restart-flap fix. On a pm2 restart the previous process may still
    # hold the listen socket for a beat — bind used to raise Errno 48 and pm2
    # crash-looped. Retry with backoff instead of dying, so a restart is clean.
    for attempt in range(20):
        try:
            await site.start()
            break
        except OSError as e:
            if getattr(e, "errno", None) == 48 and attempt < 19:
                print(f"[voice] port {PORT} busy, waiting for the old process to release "
                      f"({attempt + 1}/20)…", flush=True)
                await asyncio.sleep(0.5)
                continue
            raise
    print(f"aukora voice sidecar — local duplex organ at http://{HOST}:{PORT} "
          f"(no authority; egress is OFFLINE BY CONFIGURATION, NOT MEASURED, and the mind stays behind the 7091 door)", flush=True)

    # H1: graceful shutdown. Catch SIGTERM/SIGINT (pm2 sends SIGINT then SIGKILL),
    # cleanly tear down the aiohttp runner so the socket is RELEASED before the
    # replacement process binds, and stop the thread pools. No more Errno 48.
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # pragma: no cover - non-posix
            pass
    try:
        await stop.wait()
    finally:
        print("[voice] shutting down — releasing socket + pools", flush=True)
        await runner.cleanup()
        STT_POOL.shutdown(wait=False)
        TTS_POOL.shutdown(wait=False)
        POCKET_POOL.shutdown(wait=False)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
