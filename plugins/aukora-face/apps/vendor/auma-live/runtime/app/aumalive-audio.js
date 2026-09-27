// Aukora Spatial — AUMA · LIVE audio worklets (loaded via audioWorklet.addModule).
//
// Two tiny processors that make the duplex loop real:
//   alv-capture : mic (context rate) → mono 16 kHz int16 chunks → main thread
//                 (which relays them through the same-origin local voice bridge)
//   alv-player  : queued 24 kHz int16 PCM → continuous resampling → speakers,
//                 with a fast
//                 fade-cut for barge-in and rms reports so the field can
//                 ripple with HER voice exactly as it leaves the speakers.
//
// Everything here is dumb signal plumbing — no network, no state beyond
// buffers. The worklet thread never sees text, keys, or the model.

class AlvCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;      // e.g. 48000 → 3.0
    this.buf = new Float32Array(2048);    // reusable raw-input carry
    this.len = 0;
    this.pos = 0;                         // fractional read head into buf
    this.out = new Int16Array(640);       // 40 ms @ 16 kHz per message
    this.n = 0;
    this.rms = 0;
    this.rmsTick = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || ch.length === 0) return true;

    // envelope for the field (smoothed, posted ~every 80 ms)
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    const r = Math.sqrt(sum / ch.length);
    this.rms += (r - this.rms) * 0.25;
    if (++this.rmsTick >= 30) {
      this.rmsTick = 0;
      this.port.postMessage({ t: 'rms', v: this.rms });
    }

    // Append input into a reusable carry buffer. Allocating and concatenating a
    // new Float32Array on every 128-sample render quantum creates periodic GC
    // work on the real-time thread, which can turn into audible capture gaps.
    if (this.len + ch.length > this.buf.length) {
      const grown = new Float32Array(Math.max(this.buf.length * 2, this.len + ch.length));
      grown.set(this.buf.subarray(0, this.len));
      this.buf = grown;
    }
    this.buf.set(ch, this.len);
    this.len += ch.length;
    while (this.pos + 1 < this.len) {
      const i0 = this.pos | 0;
      const fr = this.pos - i0;
      const s = this.buf[i0] * (1 - fr) + this.buf[i0 + 1] * fr;
      this.out[this.n++] = Math.max(-32768, Math.min(32767, s * 32767)) | 0;
      this.pos += this.ratio;
      if (this.n === this.out.length) {
        const packet = this.out;
        this.port.postMessage({ t: 'pcm', pcm: packet.buffer }, [packet.buffer]);
        this.out = new Int16Array(640);
        this.n = 0;
      }
    }
    // The read head may advance just beyond the current block at common device
    // rates (48 kHz reaches position 129 after a 128-sample quantum). Retain
    // that phase for the next block without subtracting more samples than the
    // carry actually owns.
    const drop = Math.min(this.len, this.pos | 0);
    if (drop > 0) {
      this.buf.copyWithin(0, drop, this.len);
      this.len -= drop;
      this.pos -= drop;
    }
    return true;
  }
}

class AlvPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = [];            // Int16 PCM chunks at the sidecar's source rate
    this.qi = 0;            // read offset into q[0]
    this.available = 0;     // unread source samples in q
    this.sourceRate = 24000;
    this.phase = 0;
    this.s0 = 0;
    this.s1 = 0;
    this.have0 = false;
    this.have1 = false;
    this.gain = 1;
    this.target = 1;
    this.cutting = false;
    this.rms = 0;
    this.tick = 0;
    this.wasAudible = false;
    // The first run gets enough source audio to absorb generator/network burst
    // variance. A mid-turn underrun uses a smaller refill target. Stream-end is
    // an explicit release signal, so a short reply cannot remain stuck forever
    // just because it contains less audio than the normal preroll.
    this.PREROLL_MS = 180;
    this.REFILL_MS = 80;
    this.priming = true;
    this.started = false;
    this.streamEnded = false;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.cmd === 'begin') {
        // A new response may arrive before a barge-in fade has completed. Drop
        // that old cut state now so it cannot erase or attenuate the new voice.
        if (this.cutting) this.clear();
        const sr = Number(m.sampleRate);
        if (Number.isFinite(sr) && sr >= 8000 && sr <= 96000) this.sourceRate = sr;
        this.streamEnded = false;
      }
      else if (m.cmd === 'push') {
        const pcm = new Int16Array(m.pcm);
        if (pcm.length) { this.q.push(pcm); this.available += pcm.length; }
      }
      else if (m.cmd === 'end') this.streamEnded = true;
      else if (m.cmd === 'cut') { this.cutting = true; this.target = 0; }
      else if (m.cmd === 'clear') this.clear();
    };
  }

  clear() {
    const reportSilence = this.wasAudible
      || this.rms > 0.004
      || (!this.priming && this.bufferedSource() > 0);
    this.q = [];
    this.qi = 0;
    this.available = 0;
    this.phase = 0;
    this.have0 = false;
    this.have1 = false;
    this.priming = true;
    this.started = false;
    this.streamEnded = false;
    this.gain = 1;
    this.target = 1;
    this.cutting = false;
    this.rms = 0;
    this.tick = 0;
    this.wasAudible = false;
    if (reportSilence) {
      this.port.postMessage({ t: 'lvl', rms: 0, buffered: 0, audible: false });
    }
  }

  take() {
    while (this.q.length) {
      const head = this.q[0];
      if (this.qi < head.length) {
        const sample = head[this.qi++] / 32768;
        this.available--;
        if (this.qi >= head.length) { this.q.shift(); this.qi = 0; }
        return sample;
      }
      this.q.shift(); this.qi = 0;
    }
    return null;
  }

  bufferedSource() {
    return this.available + (this.have0 ? 1 : 0) + (this.have1 ? 1 : 0);
  }

  buffered() {
    return Math.round(this.bufferedSource() * sampleRate / this.sourceRate);
  }

  nextSample() {
    if (!this.have0) {
      const next = this.take();
      if (next === null) return null;
      this.s0 = next; this.have0 = true;
    }
    if (!this.have1) {
      const next = this.take();
      if (next === null) {
        if (!this.streamEnded) return null;
        this.have0 = false;
        return this.s0;
      }
      this.s1 = next; this.have1 = true;
    }
    const sample = this.s0 + (this.s1 - this.s0) * this.phase;
    this.phase += this.sourceRate / sampleRate;
    while (this.phase >= 1 && this.have1) {
      this.phase -= 1;
      this.s0 = this.s1;
      const next = this.take();
      if (next === null) this.have1 = false;
      else this.s1 = next;
    }
    return sample;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const ch0 = out[0];
    if (!ch0) return true;
    const fadeStep = 1 / (sampleRate * 0.09); // ~90 ms fade for barge-in cut

    // While priming, output clean silence until the adaptive cushion fills. An
    // ended short stream starts immediately with what it has.
    if (!this.cutting) {
      const targetMs = this.started ? this.REFILL_MS : this.PREROLL_MS;
      const ready = this.streamEnded
        ? this.bufferedSource() > 0
        : this.bufferedSource() >= Math.ceil(this.sourceRate * targetMs / 1000);
      if (this.priming && !ready) { ch0.fill(0); for (let c = 1; c < out.length; c++) out[c].fill(0); this.pushLvl(0); return true; }
      if (this.priming) { this.priming = false; this.started = true; }
    }

    let sum = 0;
    for (let i = 0; i < ch0.length; i++) {
      let s = 0;
      const next = this.nextSample();
      if (next === null && !this.cutting) this.priming = true;
      else if (next !== null) s = next;
      // gain glide (fade-out on cut, fade-in on resume)
      if (this.gain < this.target) this.gain = Math.min(this.target, this.gain + fadeStep * 2);
      else if (this.gain > this.target) this.gain = Math.max(this.target, this.gain - fadeStep);
      s *= this.gain;
      ch0[i] = s;
      sum += s * s;
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch0);
    if (this.cutting && this.gain <= 0.001) {
      this.clear(); this.cutting = false; this.target = 1;
      this.port.postMessage({ t: 'cut_done' });
    }
    this.pushLvl(Math.sqrt(sum / ch0.length));
    return true;
  }

  // throttled level report to the field (~every ~16ms): smoothed rms + whether
  // she's audible right now (playing OR still buffered), so barge-in gating stays right.
  pushLvl(r) {
    this.rms += (r - this.rms) * 0.3;
    if (++this.tick >= 6) {
      this.tick = 0;
      const audible = this.rms > 0.004 || (!this.priming && this.buffered() > 0);
      if (audible !== this.wasAudible || audible) {
        this.port.postMessage({ t: 'lvl', rms: this.rms, buffered: this.buffered(), audible });
      }
      this.wasAudible = audible;
    }
  }
}

registerProcessor('alv-capture', AlvCapture);
registerProcessor('alv-player', AlvPlayer);
