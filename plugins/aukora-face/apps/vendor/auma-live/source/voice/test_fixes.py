#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Aumara and Peter Viviani
"""
Regression test for the 2026-07-06 duplex fixes (her-latch + TTS worker survival).
Plays the browser's role over the real ws://127.0.0.1:7092/ws. Run with the
sidecar up:  .venv/bin/python test_fixes.py
"""

import asyncio
import json
import time

import aiohttp
import numpy as np

WS = "ws://127.0.0.1:7092/ws"


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
        # endpointing needs ~450ms of quiet AFTER speech to close the turn and
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
    asyncio.run(main())
