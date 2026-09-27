#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Aumara and Peter Viviani
"""
End-to-end voice-to-voice latency measurement — plays the browser's role
through the Aukora UI host and prints the stage budget:

  speech-end → mind's first token    (presence lane over OpenRouter)
  speech-end → committed final       (adaptive endpointing)
  speech-end → HER FIRST AUDIO BYTE  (the number that decides how she feels)

Spends ONE presence turn per run (fast roster model — fractions of a cent).
Run with the Aukora UI host and a live target session:
  AUKORA_SESSION_ID=... .venv/bin/python test_e2e.py
"""

import asyncio
import json
import os
import time

import aiohttp
import numpy as np

WEB = os.environ.get("AUKORA_WEB_URL", "http://127.0.0.1:5173").rstrip("/")
WS = WEB.replace("https://", "wss://").replace("http://", "ws://") + "/stock-apps/auma-live/voice"
OWNER = f"{int(time.time() * 1000):013d}:voice-e2e-client:000001"
SESSION_ID = os.environ.get("AUKORA_SESSION_ID", "")
QUESTION = "Hey, what do you think about the stars tonight?"


async def run():
    if not SESSION_ID:
        raise SystemExit("AUKORA_SESSION_ID must name a live Aukora UI session")
    async with aiohttp.ClientSession() as http:
        async with http.ws_connect(WS, params={"owner": OWNER}, max_msg_size=2 ** 22) as ws:
            await ws.receive()  # ready

            # -- make the "owner utterance" with her own TTS (emma) --
            await ws.send_json({"t": "tts", "id": 1, "text": QUESTION, "voice": "emma"})
            pcm = b""
            while True:
                m = await asyncio.wait_for(ws.receive(), timeout=30)
                if m.type == aiohttp.WSMsgType.BINARY:
                    pcm += m.data
                elif m.type == aiohttp.WSMsgType.TEXT and json.loads(m.data).get("t") == "tts_end":
                    break
            a24 = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768
            idx = np.arange(0, len(a24), 1.5)
            a16 = np.interp(idx, np.arange(len(a24)), a24)
            speech = (a16 * 20000).astype(np.int16).tobytes()
            silence = b"\x00" * 3200  # 100ms

            state = {"t_end": None, "t_eager": None, "t_final": None,
                     "t_ttft": None, "t_first_audio": None, "final": None,
                     "spec": None, "tokens": ""}

            async def presence_call(text):
                t0 = time.monotonic()
                first_clause_sent = False
                try:
                    async with http.post(WEB + "/api/auma-live/presence/stream",
                                         json={"sessionId": SESSION_ID, "text": text, "mind": "balanced"}) as res:
                        async for raw in res.content:
                            line = raw.decode(errors="ignore").strip()
                            if not line.startswith("data:"):
                                continue
                            try:
                                ev = json.loads(line[5:].strip())
                            except Exception:
                                continue
                            if ev.get("t") == "tok":
                                if state["t_ttft"] is None:
                                    state["t_ttft"] = time.monotonic()
                                state["tokens"] += ev["v"]
                                # speak on first clause edge, like the client
                                if not first_clause_sent and state["t_final"] is not None:
                                    txt = state["tokens"]
                                    for i, ch in enumerate(txt):
                                        if ch in ".!?…," and i >= 8:
                                            await ws.send_json({"t": "tts", "id": 9, "text": txt[:i + 1], "first": True})
                                            first_clause_sent = True
                                            break
                            elif ev.get("t") == "done":
                                break
                        if not first_clause_sent and state["tokens"]:
                            await ws.send_json({"t": "tts", "id": 9, "text": state["tokens"], "first": True})
                except Exception as e:
                    print("presence error:", e)

            async def feeder():
                # real-time pacing; mark the moment the last speech chunk goes out
                for i in range(0, len(speech), 3200):
                    await ws.send_bytes(speech[i:i + 3200])
                    await asyncio.sleep(0.1)
                state["t_end"] = time.monotonic()
                for _ in range(40):  # 4s of trailing silence
                    await ws.send_bytes(silence)
                    await asyncio.sleep(0.1)

            feed = asyncio.create_task(feeder())
            spec_task = None
            # ONE clean path: the sidecar sends a single `final` once you've
            # finished a sentence; the mind starts on that complete utterance.
            while state["t_first_audio"] is None:
                m = await asyncio.wait_for(ws.receive(), timeout=60)
                if m.type == aiohttp.WSMsgType.BINARY:
                    if state["t_final"] is not None:
                        state["t_first_audio"] = time.monotonic()
                    continue
                j = json.loads(m.data)
                if j.get("t") == "final":
                    state["t_final"] = time.monotonic()
                    state["final"] = j["text"]
                    spec_task = asyncio.create_task(presence_call(j["text"]))
            feed.cancel()

            e = state["t_end"]
            def ms(x): return "—" if x is None else f"{int((x - e) * 1000)}ms"
            print(f"heard      : {state['final']!r}")
            print(f"reply      : {state['tokens'][:90]!r}")
            print(f"speech-end → committed final  : {ms(state['t_final'])}")
            print(f"speech-end → mind first token : {ms(state['t_ttft'])}   (varies by mind: balanced ~1s warm, deep ~3s)")
            print(f"speech-end → HER FIRST AUDIO  : {ms(state['t_first_audio'])}   ← voice-to-voice")


asyncio.run(run())
