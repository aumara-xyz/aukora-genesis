#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Aumara and Peter Viviani
"""
Regression tests for duplex lifecycle fixes. The deterministic worker tests run
without loaded engines. The WebSocket tests require the sidecar:
  .venv/bin/python test_fixes.py --deterministic
  .venv/bin/python test_fixes.py
"""

import asyncio
import json
import os
import sys
import threading
import time

import aiohttp
import numpy as np

from sidecar import FRAME, Session

WS = f"ws://127.0.0.1:{os.environ.get('AUKORA_VOICE_PORT', '7512')}/ws"


class BlockingStt:
    def __init__(self):
        self.started = threading.Event()
        self.release = threading.Event()

    def decode(self, _audio):
        self.started.set()
        if not self.release.wait(timeout=2):
            raise TimeoutError("test did not release the blocked STT decode")
        return "stale transcript"


class RecoveringStt:
    def __init__(self):
        self.calls = 0

    def decode(self, _audio):
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("private engine path must stay out of the wire message")
        return "recognition recovered"


class HangingStt:
    def __init__(self):
        self.started = threading.Event()
        self.release = threading.Event()
        self.finished = threading.Event()

    def decode(self, _audio):
        self.started.set()
        try:
            self.release.wait()
            return "late transcript"
        finally:
            self.finished.set()


class FakeVad:
    def fresh_state(self):
        return {}


class RecordingSocket:
    def __init__(self):
        self.messages = []
        self.binary = []

    async def send_json(self, message):
        self.messages.append(message)

    async def send_bytes(self, pcm):
        self.binary.append(pcm)


class RecoveringPocket:
    VOICES = {"test": ("test", "Test", "deterministic test voice")}

    def __init__(self):
        self.calls = 0

    def stream(self, _voice, _text, _alive):
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("private model path must stay out of the wire message")
        yield np.zeros(240, dtype=np.int16)


class FakeTts:
    presences = {}


async def wait_for_json(socket, predicate, timeout=2):
    async def poll():
        while True:
            for message in socket.messages:
                if predicate(message):
                    return message
            await asyncio.sleep(0)

    return await asyncio.wait_for(poll(), timeout=timeout)


async def test_reset_discards_inflight_decode():
    decoder = BlockingStt()
    socket = RecordingSocket()
    loop = asyncio.get_running_loop()
    session = Session(socket, (decoder, FakeVad(), None, None, "auma"), loop)
    session.utter = [np.zeros(FRAME, dtype=np.float32) for _ in range(10)]
    decode_task = session._end_utterance()
    assert decode_task is not None
    try:
        started = await asyncio.wait_for(asyncio.to_thread(decoder.started.wait), timeout=2)
        assert started, "STT decode did not start"
        session.reset()
        decoder.release.set()
        await asyncio.wait_for(decode_task, timeout=2)
        await asyncio.sleep(0)
        assert not any(message.get("t") == "final" for message in socket.messages), socket.messages
    finally:
        decoder.release.set()
        session.close()
        await asyncio.gather(session.tts_task, return_exceptions=True)


async def test_stt_error_is_structured_and_next_decode_survives():
    decoder = RecoveringStt()
    socket = RecordingSocket()
    loop = asyncio.get_running_loop()
    session = Session(socket, (decoder, FakeVad(), None, None, "test"), loop)
    audio = np.zeros(FRAME * 10, dtype=np.float32)
    try:
        await session._decode_final(audio, 0.32, 384, session.listen_epoch)
        assert socket.messages == [{
            "t": "err",
            "where": "stt",
            "msg": "speech recognition failed (RuntimeError)",
        }], socket.messages
        assert "private engine path" not in socket.messages[0]["msg"]
        assert len(socket.messages[0]["msg"]) <= 160

        await session._decode_final(audio, 0.32, 384, session.listen_epoch)
        await wait_for_json(socket, lambda message: message.get("t") == "final")
        assert socket.messages[-1] == {
            "t": "final",
            "text": "recognition recovered",
            "dur": 0.32,
        }, socket.messages
    finally:
        session.close()
        await asyncio.gather(session.tts_task, return_exceptions=True)


async def test_stt_hang_reports_and_restarts_process():
    decoder = HangingStt()
    socket = RecordingSocket()
    restart_calls = []
    loop = asyncio.get_running_loop()
    session = Session(
        socket,
        (decoder, FakeVad(), None, None, "test"),
        loop,
        stt_decode_timeout=0.02,
        restart_process=lambda: restart_calls.append("restart"),
    )
    audio = np.zeros(FRAME * 10, dtype=np.float32)
    try:
        task = loop.create_task(
            session._decode_final(audio, 0.32, 384, session.listen_epoch))
        started = await asyncio.wait_for(
            asyncio.to_thread(decoder.started.wait), timeout=2)
        assert started, "STT decode did not start"
        await asyncio.wait_for(task, timeout=1)
        assert socket.messages == [{
            "t": "err",
            "where": "stt",
            "msg": "speech recognition timed out; local listener restarting",
        }], socket.messages
        assert restart_calls == ["restart"], restart_calls
    finally:
        decoder.release.set()
        finished = await asyncio.wait_for(
            asyncio.to_thread(decoder.finished.wait), timeout=2)
        assert finished, "blocked STT test worker did not release"
        await asyncio.sleep(0)
        assert not any(message.get("t") == "final" for message in socket.messages), socket.messages
        session.close()
        await asyncio.gather(session.tts_task, return_exceptions=True)


async def test_end_utterance_owns_decode_until_timeout():
    decoder = HangingStt()
    socket = RecordingSocket()
    restart_calls = []
    loop = asyncio.get_running_loop()
    session = Session(
        socket,
        (decoder, FakeVad(), None, None, "test"),
        loop,
        stt_decode_timeout=0.02,
        restart_process=lambda: restart_calls.append("restart"),
    )
    session.utter = [np.zeros(FRAME, dtype=np.float32) for _ in range(10)]
    task = session._end_utterance()
    assert task in session.decode_tasks, "the Session must own each production decode task"
    try:
        started = await asyncio.wait_for(
            asyncio.to_thread(decoder.started.wait), timeout=2)
        assert started, "STT decode did not start"
        await wait_for_json(
            socket,
            lambda message: message.get("where") == "stt",
        )
        await asyncio.sleep(0)
        assert socket.messages[-1] == {
            "t": "err",
            "where": "stt",
            "msg": "speech recognition timed out; local listener restarting",
        }, socket.messages
        async def wait_for_restart():
            while not restart_calls:
                await asyncio.sleep(0)
        await asyncio.wait_for(wait_for_restart(), timeout=1)
        assert restart_calls == ["restart"], restart_calls
        await asyncio.wait_for(task, timeout=1)
        await asyncio.sleep(0)
        assert task not in session.decode_tasks, "completed decode tasks must be reaped"
    finally:
        decoder.release.set()
        await asyncio.wait_for(
            asyncio.to_thread(decoder.finished.wait), timeout=2)
        session.close()
        await asyncio.gather(session.tts_task, return_exceptions=True)


async def test_tts_error_precedes_end_and_worker_survives():
    socket = RecordingSocket()
    pocket = RecoveringPocket()
    loop = asyncio.get_running_loop()
    session = Session(socket, (None, FakeVad(), FakeTts(), pocket, "test"), loop)
    try:
        await session.say({"t": "tts", "id": 41, "text": "fail once", "voice": "test"})
        await wait_for_json(socket, lambda message: message == {"t": "tts_end", "id": 41})
        assert socket.messages[:2] == [
            {
                "t": "err",
                "where": "tts",
                "id": 41,
                "msg": "voice synthesis failed (RuntimeError)",
            },
            {"t": "tts_end", "id": 41},
        ], socket.messages
        assert "private model path" not in socket.messages[0]["msg"]
        assert len(socket.messages[0]["msg"]) <= 160

        await session.say({"t": "tts", "id": 42, "text": "work next", "voice": "test"})
        await wait_for_json(socket, lambda message: message == {"t": "tts_end", "id": 42})
        assert socket.messages[-2:] == [
            {"t": "tts_begin", "id": 42, "sr": 24000},
            {"t": "tts_end", "id": 42},
        ], socket.messages
        assert socket.binary, "the recovered TTS item produced no PCM"
        assert not session.tts_task.done(), "the TTS worker stopped after one failed item"
    finally:
        session.close()
        await asyncio.gather(session.tts_task, return_exceptions=True)


async def test_queue_full_error_identifies_the_dropped_item():
    socket = RecordingSocket()
    loop = asyncio.get_running_loop()
    session = Session(socket, (None, FakeVad(), FakeTts(), RecoveringPocket(), "test"), loop)
    session.close()
    await asyncio.gather(session.tts_task, return_exceptions=True)
    session.tts_q = asyncio.Queue(maxsize=1)
    session.tts_q.put_nowait(object())

    await session.say({"t": "tts", "id": 43, "text": "dropped", "voice": "test"})
    assert socket.messages == [
        {"t": "err", "where": "tts", "id": 43, "msg": "queue full"},
        {"t": "tts_end", "id": 43},
    ], socket.messages


async def run_deterministic_tests():
    await test_reset_discards_inflight_decode()
    await test_stt_error_is_structured_and_next_decode_survives()
    await test_stt_hang_reports_and_restarts_process()
    await test_end_utterance_owns_decode_until_timeout()
    await test_tts_error_precedes_end_and_worker_survives()
    await test_queue_full_error_identifies_the_dropped_item()
    test_barge_in_survives_consonant_dips_while_her_audio_plays()


def _vad_session(probs, her):
    """A Session driven by scripted VAD probabilities instead of audio."""
    from collections import deque
    from sidecar import PREROLL_FRAMES

    class ScriptedVad:
        def __init__(self, sequence):
            self.sequence = list(sequence)

        def step(self, state, frame):
            return self.sequence.pop(0) if self.sequence else 0.0

    session = Session.__new__(Session)
    session.vad = ScriptedVad(probs)
    session.vst = {}
    session.preroll = deque(maxlen=PREROLL_FRAMES)
    session.utter = []
    session.speaking = False
    session.speech_run = 0
    session.silence_run = 0
    session.her_until = time.monotonic() + (60 if her else -1)
    session.sent = []
    session.send = session.sent.append
    return session


def test_barge_in_survives_consonant_dips_while_her_audio_plays():
    """While her audio raises the bar, a sub-bar frame decays the start run by
    one instead of zeroing it: real interjections dip at unvoiced consonants,
    and the hard reset made them mathematically unable to interrupt her. Her
    own residual echo stays below the bar and must still never accumulate."""
    frame = np.zeros(FRAME, dtype=np.float32)

    interjection = [0.9, 0.9, 0.9, 0.6, 0.9, 0.9, 0.9, 0.5, 0.9, 0.9, 0.9, 0.9, 0.6, 0.9, 0.9, 0.9]
    session = _vad_session(interjection, her=True)
    for _ in interjection:
        session._frame(frame)
        if session.speaking:
            break
    assert any(m.get("t") == "vad" and m.get("speaking") for m in session.sent), \
        "a dipping interjection must still interrupt her"

    echo = [0.7, 0.75, 0.3, 0.72, 0.68, 0.2, 0.74, 0.7, 0.71, 0.3, 0.7, 0.75, 0.72, 0.6, 0.7, 0.71, 0.74, 0.7, 0.72, 0.7]
    session = _vad_session(echo, her=True)
    for _ in echo:
        session._frame(frame)
    assert not session.speaking, "sub-bar echo must never open an utterance while her audio plays"

    session = _vad_session([0.6, 0.6, 0.6, 0.6], her=False)
    for _ in range(4):
        session._frame(frame)
    assert session.speaking, "the ordinary 4-frame open must be unchanged when she is silent"
    print("barge-in decay test passed")


async def drain_to_end(ws, cid, timeout=30):
    """Collect events for one tts id until its tts_end. Returns (begun, pcm_bytes)."""
    begun = False
    pcm = 0
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        m = await asyncio.wait_for(ws.receive(), timeout=timeout)
        if m.type == aiohttp.WSMsgType.BINARY:
            pcm += len(m.data)
        elif m.type == aiohttp.WSMsgType.TEXT:
            d = json.loads(m.data)
            if d.get("t") == "tts_begin" and d.get("id") == cid:
                begun = True
            elif d.get("t") == "tts_end" and d.get("id") == cid:
                return begun, pcm
    raise AssertionError(f"no tts_end for id={cid} within {timeout}s")


async def synth_speech(ws, text, voice="emma", gain=0.5):
    """Use the sidecar's own kokoro TTS to make realistic 'owner speech' PCM @24k,
    downsampled to 16k int16 (what the mic path would send). Attenuated to `gain`
    so it clears the normal 0.55 VAD bar but NOT the raised 0.82 her-bar — that
    gap is what lets us prove the her-latch actually suppresses, then self-heals."""
    await ws.send_json({"t": "tts", "id": 900, "text": text, "voice": voice})
    raw = b""
    while True:
        m = await asyncio.wait_for(ws.receive(), timeout=30)
        if m.type == aiohttp.WSMsgType.BINARY:
            raw += m.data
        elif m.type == aiohttp.WSMsgType.TEXT and json.loads(m.data).get("t") == "tts_end":
            break
    a = np.frombuffer(raw, dtype=np.int16).astype(np.float32) * gain
    # 24k -> 16k
    n = int(len(a) * 16000 / 24000)
    idx = (np.arange(n) * (len(a) / n)).astype(int)
    return (a[idx]).astype(np.int16).tobytes()


SILENCE = (np.zeros(16000, dtype=np.int16)).tobytes()  # 0.5s of quiet @16k


async def feed(ws, pcm16, chunk=3200, trail_silence=True):
    for i in range(0, len(pcm16), chunk):
        await ws.send_bytes(pcm16[i:i + chunk])
        await asyncio.sleep(0.02)
    if trail_silence:
        # endpointing needs ~384ms of quiet AFTER speech to close the turn and
        # emit `final` — feed a full second of silence so the turn actually ends.
        for _ in range(2):
            await ws.send_bytes(SILENCE)
            await asyncio.sleep(0.05)


async def wait_for_final(ws, timeout):
    """Return the final text if a turn opens+finishes within timeout, else None."""
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        try:
            m = await asyncio.wait_for(ws.receive(), timeout=timeout - (time.monotonic() - t0))
        except asyncio.TimeoutError:
            return None
        if m.type == aiohttp.WSMsgType.TEXT:
            d = json.loads(m.data)
            if d.get("t") == "final":
                return d.get("text", "")
    return None


async def main():
    async with aiohttp.ClientSession() as http:
        # -------- TEST 1: TTS worker survives every item + always terminalizes --------
        async with http.ws_connect(WS, max_msg_size=2 ** 22) as ws:
            await ws.receive()  # ready
            print("TEST 1 — worker resilience + terminal guarantee (F4/H5)")

            # (a) normal pocket voice
            await ws.send_json({"t": "tts", "id": 1, "text": "Hello there, this is a test.", "voice": "alba"})
            begun, pcm = await drain_to_end(ws, 1)
            assert begun and pcm > 0, "1a pocket produced no audio"
            print(f"  1a pocket 'alba'        begun={begun} pcm={pcm}B  -> tts_end OK")

            # (b) EMPTY text — must still get a terminal tts_end (never strand ttsPending)
            await ws.send_json({"t": "tts", "id": 2, "text": "   "})
            begun, pcm = await drain_to_end(ws, 2)
            assert not begun and pcm == 0, "2 empty should make no audio"
            print(f"  1b empty text           begun={begun} pcm={pcm}B  -> tts_end OK (no strand)")

            # (c) UNKNOWN voice — must be coerced to default and still speak + terminate
            await ws.send_json({"t": "tts", "id": 3, "text": "Coerce me to the default voice.", "voice": "zzz-nope"})
            begun, pcm = await drain_to_end(ws, 3)
            assert begun and pcm > 0, "3 unknown voice produced no audio (coercion failed)"
            print(f"  1c unknown voice        begun={begun} pcm={pcm}B  -> coerced + tts_end OK")

            # (d) kokoro voice AFTER the above — proves the worker is still alive
            await ws.send_json({"t": "tts", "id": 4, "text": "And the worker is still alive.", "voice": "emma"})
            begun, pcm = await drain_to_end(ws, 4)
            assert begun and pcm > 0, "4 kokoro produced no audio (worker died?)"
            print(f"  1d kokoro 'emma' (last)  begun={begun} pcm={pcm}B  -> worker SURVIVED all 4 items")
            print("  TEST 1 PASS\n")

        # -------- TEST 2: her-latch self-heals (F1 reset + F2 bounded lease) --------
        async with http.ws_connect(WS, max_msg_size=2 ** 22) as ws:
            await ws.receive()  # ready
            print("TEST 2 — her-latch self-heal (F1/F2)")
            speech = await synth_speech(ws, "What time should we meet tomorrow evening?")
            await ws.send_json({"t": "reset"})

            # 2a BASELINE — attenuated speech opens a turn when the bar is DOWN.
            await feed(ws, speech)
            base = await wait_for_final(ws, timeout=8)
            assert base is not None, "baseline: attenuated speech didn't open a turn (raise gain)"
            print(f"  2a baseline (bar down)         -> final={base!r}")

            # 2b SELF-HEAL — latch her(on) and NEVER send off (a lost her(false)).
            # Pre-fix this latched to +inf forever; post-fix it's a 1.5s lease.
            await ws.send_json({"t": "reset"})
            await ws.send_json({"t": "her", "on": True})
            await asyncio.sleep(2.0)                 # lease (1.5s) lapses — no audio refreshed it
            await feed(ws, speech)                   # now speak
            healed = await wait_for_final(ws, timeout=8)
            assert healed is not None, "SELF-HEAL FAIL: her-bar still latched after 2s (pre-fix behavior)"
            print(f"  2b her(on), no off, +2s        -> final={healed!r}  (SELF-HEALED, no reconnect)")

            # 2c RESET CLEARS IT — latch her(on), then reset, then speak immediately.
            await ws.send_json({"t": "her", "on": True})
            await ws.send_json({"t": "reset"})       # F1: reset must zero her_until
            await feed(ws, speech)
            cleared = await wait_for_final(ws, timeout=8)
            assert cleared is not None, "RESET FAIL: reset() did not clear the her-bar"
            print(f"  2c her(on) then reset          -> final={cleared!r}  (reset cleared the bar)")
            print("  TEST 2 PASS\n")

    print("ALL TESTS PASSED")


if __name__ == "__main__":
    if sys.argv[1:] == ["--deterministic"]:
        asyncio.run(run_deterministic_tests())
        print("DETERMINISTIC TESTS PASSED")
    else:
        asyncio.run(main())
