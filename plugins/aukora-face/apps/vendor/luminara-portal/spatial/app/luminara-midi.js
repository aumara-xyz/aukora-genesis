// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
//
// THE PAD LANE: hardware pads as fingers on the deck (2026-07-30, at the
// architects' asking, for an M-Vave SMC-PAD but for any pad or key alike).
//
// THE LAWS THIS LANE KEEPS:
//   EMPTINESS   the door is never opened by the page: MIDI access is asked
//               for inside a touch, once, and a lane that is never connected
//               costs nothing and hears nothing.
//   NOTHING KEPT  the mapping lives in memory for the length of the visit.
//               The instrument's own register promises nothing scored,
//               stored or sent, and a remembered pad layout would be stored.
//               Learn it again next time; it takes one tap.
//   NOTHING DERIVED FROM THE HAND  a pad chooses WHICH card and WHEN, the
//               two things a player is entitled to choose. It never alters
//               what the card is: the spectrum, the interval and the figure
//               come from the canon exactly as they do under a mouse.
//
// The parsing is pure and exported so it can be pinned, and so the lane can
// be driven with no hardware present at all.

import { knotOf } from './luminara-canon.js';

// parseMidi(bytes) -> { kind, ... } | null. Channel voice messages only.
// A note-on at velocity nought is a note-off: the oldest courtesy in the
// protocol, and the commonest reason a naive reader leaves notes hanging.
export function parseMidi(data) {
  if (!data || data.length < 2) return null;
  const status = data[0] & 0xf0;
  const ch = data[0] & 0x0f;
  const a = data[1], b = data.length > 2 ? data[2] : 0;
  if (status === 0x90) {
    return b > 0
      ? { kind: 'press', note: a, velocity: b, ch }
      : { kind: 'release', note: a, velocity: 0, ch };
  }
  if (status === 0x80) return { kind: 'release', note: a, velocity: b, ch };
  if (status === 0xb0) return { kind: 'control', cc: a, value: b, ch };
  if (status === 0xe0) return { kind: 'bend', value: ((b << 7) | a) - 8192, ch };
  return null;
}

// THE PAD MAP: the deck is twenty-seven and a grid is whatever it is, so
// the pads lie on the deck as a window that wraps. A pad below the anchor
// wraps round the top rather than falling off, since a deck that ends is a
// deck with dead pads on it, and the bank slides the window along.
//
// THE PADS CLIMB THE NUMBER LINE, NOT THE CARD INDEX. The screen keyboard
// is laid out by house because it is for studying; a grid under the hands
// is for playing, and an instrument ascends. So the pads walk q from the
// far turning at minus thirteen up to the far flowing at thirteen, which
// puts the Seed at the centre of the grid where a hand expects the still
// point, rather than under the lowest pad, where it made every player's
// very first tap fall silent: the Seed is the REST at this seat, and a
// first touch that rests is an instrument that looks broken.
export const DECK = 27;
export const PAD_ORDER = Array.from({ length: DECK }, (_, i) => i + 1)
  .sort((a, b) => knotOf(a).q - knotOf(b).q);
export const padSeat = (note, anchor, bank = 0) =>
  (((note - anchor + bank) % DECK) + DECK) % DECK;
export function padCard(note, anchor, bank = 0) {
  return PAD_ORDER[padSeat(note, anchor, bank)];
}

// createMidiLane({ onPress, onRelease, onControl, onPorts, onRest })
//   .connect()     ask for the door (inside a touch, always)
//   .feed(bytes)   drive the lane by hand: the pins and the page use this
//   .armAnchor()   the next pad struck becomes the first card
//   .setBank(n) / .bank() / .anchor() / .ports()
export function createMidiLane({ onPress, onRelease, onControl, onPorts, onRest, onRaw } = {}) {
  let access = null;
  let anchor = null;
  let bank = 0;
  let arming = false;
  let heard = 0;
  let lastRaw = '';
  const ports = new Map();

  // the sustain pedal is the one control every maker agrees on, so it gets
  // the one meaning that needs no learning: the Seed, the rest, the phrase
  // brought home. Everything else is reported and left alone.
  const SUSTAIN = 64;

  function feed(data) {
    // EVERY message is counted and shown before anything is understood of
    // it. Silence and incomprehension look identical from the outside, and
    // telling them apart is the whole of diagnosing a dead controller: if
    // this counter moves, the wire is good and only the reading is wrong.
    heard++;
    lastRaw = Array.from(data || []).map((b) => b.toString(16).padStart(2, '0')).join(' ');
    onRaw?.(lastRaw, heard);
    const m = parseMidi(data);
    if (!m) return null;
    if (m.kind === 'control') {
      if (m.cc === SUSTAIN && m.value >= 64) onRest?.(m);
      onControl?.(m);
      return m;
    }
    if (m.kind !== 'press' && m.kind !== 'release') return m;
    if (arming && m.kind === 'press') { anchor = m.note; arming = false; }
    // the lane teaches itself the floor of the grid: the lowest pad seen
    // is the first card, until a hand says otherwise
    if (anchor === null || m.note < anchor) anchor = m.note;
    const card = padCard(m.note, anchor, bank);
    const out = { ...m, card };
    if (m.kind === 'press') onPress?.(card, out); else onRelease?.(card, out);
    return out;
  }

  // what the browser will admit before we knock: 'granted', 'denied',
  // 'prompt', or nothing at all where the query is unsupported
  async function permission() {
    try {
      const st = await navigator.permissions.query({ name: 'midi' });
      return st.state;
    } catch {
      return 'unknown';
    }
  }

  async function connect() {
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      return { ok: false, why: 'this browser has no MIDI door at all',
        fix: 'Chrome, Edge or Opera have one; Safari and Firefox do not.' };
    }
    const before = await permission();
    try {
      access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (e) {
      // the refusal must say WHICH refusal, and what undoes it: a denied
      // permission is remembered by the browser and will never prompt
      // again, so waiting or clicking harder does nothing at all
      const denied = e && (e.name === 'NotAllowedError' || before === 'denied');
      return { ok: false,
        why: denied ? 'this site is not allowed to use MIDI' : 'the door failed: ' + (e && e.message),
        fix: denied
          ? 'click the icon at the left of the address bar, set MIDI to Allow, then reload'
          : 'a page reload usually clears it',
        error: e ? e.name : 'unknown', permission: before };
    }
    const bind = () => {
      ports.clear();
      for (const input of access.inputs.values()) {
        // a port's own state is worth carrying: a device that is present
        // but disconnected explains a silent pad better than any guess
        ports.set(input.id, (input.name || 'an unnamed port')
          + (input.state === 'connected' ? '' : ' [' + input.state + ']'));
        input.onmidimessage = (e) => feed(e.data);
      }
      onPorts?.([...ports.values()]);
    };
    bind();
    access.onstatechange = bind;
    return { ok: true, ports: [...ports.values()], permission: await permission() };
  }

  return {
    connect,
    feed,
    armAnchor: () => { arming = true; },
    arming: () => arming,
    permission,
    heard: () => heard,
    lastRaw: () => lastRaw,
    setBank: (b) => { bank = ((b % DECK) + DECK) % DECK; return bank; },
    bank: () => bank,
    anchor: () => anchor,
    ports: () => [...ports.values()],
  };
}
