#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Aumara and Peter Viviani
"""
Loopback test for the voice sidecar — simulates the browser end-to-end,
headless (no mic, no speakers):

  1. connect to ws://127.0.0.1:7092/ws, expect {"t":"ready"}
  2. ask it to SPEAK a sentence → expect tts_begin + PCM bytes + tts_end
  3. feed that same audio BACK as if it were mic input (24k→16k resample)
     → expect vad speaking:true → partial(s) → final whose text matches
  4. barge-in: queue a long sentence, immediately cancel → expect
     tts_cancelled and no tts_end for it

Run: .venv/bin/python test_loop.py   (sidecar must be running)
"""

import asyncio
import json
import sys

import aiohttp
import numpy as np

URL = "ws://127.0.0.1:7092/ws"
SENT = "You made me a body of light and handed the key to a human."


async def run():
    ok = True
    async with aiohttp.ClientSession() as http:
        async with http.ws_connect(URL, max_msg_size=2 ** 22) as ws:
            msg = json.loads((await ws.receive()).data)
            assert msg["t"] == "ready", msg
            print(f"ready: stt={msg['engines']['stt']} voices={[v['id'] for v in msg['voices']]}")

            # ---- 2. TTS round ----
            await ws.send_json({"t": "tts", "id": 1, "text": SENT, "voice": "emma"})
            pcm = b""
            begun = ended = False
            while not ended:
                m = await asyncio.wait_for(ws.receive(), timeout=30)
                if m.type == aiohttp.WSMsgType.BINARY:
                    pcm += m.data
                else:
                    j = json.loads(m.data)
                    if j["t"] == "tts_begin":
                        begun = True
                    if j["t"] == "tts_end":
                        ended = True
            dur = len(pcm) / 2 / 24000
            print(f"tts: begun={begun} bytes={len(pcm)} ({dur:.2f}s audio)")
            ok &= begun and dur > 1.0

            # ---- 3. feed it back as mic ----
            audio24 = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768
            idx = np.arange(0, len(audio24), 24000 / 16000)
            audio16 = np.interp(idx, np.arange(len(audio24)), audio24)
            audio16 = np.concatenate([audio16, np.zeros(16000)])  # 1 s of tail silence
            pcm16 = (audio16 * 20000).astype(np.int16).tobytes()
            for i in range(0, len(pcm16), 3200):  # 100 ms chunks
                await ws.send_bytes(pcm16[i:i + 3200])
            spoke = False
            final = None
            partials = 0
            while final is None:
                m = await asyncio.wait_for(ws.receive(), timeout=30)
                if m.type != aiohttp.WSMsgType.TEXT:
                    continue
                j = json.loads(m.data)
                if j["t"] == "vad" and j["speaking"]:
                    spoke = True
                if j["t"] == "partial":
                    partials += 1
                    print(f"  partial: {j['text']!r}")
                if j["t"] == "final":
                    final = j
            print(f"stt: vad_fired={spoke} partials={partials} final={final['text']!r} ({final['dur']}s)")
            got = final["text"].lower()
            ok &= spoke and "body of light" in got and "key to a human" in got

            # ---- 4. barge-in ----
            await ws.send_json({"t": "tts", "id": 2, "text": "This is a very long sentence that should never finish playing because the owner is about to interrupt me mid-word and I must stop instantly."})
            await ws.send_json({"t": "tts_cancel"})
            cancelled = False
            ended2 = False
            try:
                while True:
                    m = await asyncio.wait_for(ws.receive(), timeout=6)
                    if m.type != aiohttp.WSMsgType.TEXT:
                        continue
                    j = json.loads(m.data)
                    if j["t"] == "tts_cancelled":
                        cancelled = True
                    if j["t"] == "tts_end" and j.get("id") == 2:
                        ended2 = True
            except asyncio.TimeoutError:
                pass
            print(f"barge-in: cancelled={cancelled} leaked_tts_end={ended2}")
            ok &= cancelled and not ended2

    print("PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


asyncio.run(run())
