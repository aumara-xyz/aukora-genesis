// Aukora Spatial — AUMA · LIVE audio worklets (loaded via audioWorklet.addModule).
//
// Two tiny processors that make the duplex loop real:
//   alv-capture : mic (context rate) → mono 16 kHz int16 chunks → main thread
//                 (which relays them to the LOCAL voice sidecar on 7092)
//   alv-player  : queued PCM (context rate float32) → speakers, with a fast
//                 fade-cut for barge-in and rms reports so the field can
//                 ripple with HER voice exactly as it leaves the speakers.
//
// Everything here is dumb signal plumbing — no network, no state beyond
// buffers. The worklet thread never sees text, keys, or the model.

class AlvCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;      // e.g. 48000 → 3.0
    this.buf = new Float32Array(0);       // raw input carry
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

    // append input, then pull 16 kHz samples out with linear interpolation
    const merged = new Float32Array(this.buf.length + ch.length);
    merged.set(this.buf, 0);
    merged.set(ch, this.buf.length);
    this.buf = merged;
    while (this.pos + 1 < this.buf.length) {
      const i0 = this.pos | 0;
      const fr = this.pos - i0;
      const s = this.buf[i0] * (1 - fr) + this.buf[i0 + 1] * fr;
      this.out[this.n++] = Math.max(-32768, Math.min(32767, s * 32767)) | 0;
      this.pos += this.ratio;
      if (this.n === this.out.length) {
        this.port.postMessage({ t: 'pcm', pcm: this.out.buffer.slice(0) }, []);
        this.n = 0;
      }
    }
    const drop = this.pos | 0;
    if (drop > 0) {
      this.buf = this.buf.slice(drop);
      this.pos -= drop;
    }
    return true;
  }
}

class AlvPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = [];            // Float32Array chunks at context rate
    this.qi = 0;            // read offset into q[0]
    this.gain = 1;
    this.target = 1;
    this.cutting = false;
    this.rms = 0;
    this.tick = 0;
    this.wasAudible = false;
    // JITTER BUFFER: her voice arrives in bursts (pocket streams faster than
    // realtime, but with gaps between clauses/packets). Without a cushion, any
    // gap plays as silence → the "choppy / breaks up" the owner heard. We hold
    // playback until PREROLL is buffered, then play; if the queue fully drains
    // mid-reply we stop (not sputter) and re-prime, so it's smooth, never torn.
    this.PREROLL = Math.floor(sampleRate * 0.32);   // ~320 ms cushion before we start a run
                                                    // (bigger buffer = smoother under load; ~100ms extra latency)
    this.priming = true;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.cmd === 'push') this.q.push(new Float32Array(m.pcm));
      else if (m.cmd === 'cut') { this.cutting = true; this.target = 0; }
      else if (m.cmd === 'clear') { this.q = []; this.qi = 0; this.priming = true; }
    };
  }

  buffered() {
    let n = -this.qi;
    for (const c of this.q) n += c.length;
    return Math.max(0, n);
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const ch0 = out[0];
    if (!ch0) return true;
    const fadeStep = 1 / (sampleRate * 0.09); // ~90 ms fade for barge-in cut

    // While priming (or drained), output clean silence until the cushion fills.
    // Barge-in cut bypasses priming so it always drains instantly.
    if (!this.cutting) {
      if (this.priming && this.buffered() < this.PREROLL) { ch0.fill(0); for (let c = 1; c < out.length; c++) out[c].fill(0); this.pushLvl(0); return true; }
      this.priming = false;
      if (this.buffered() === 0) { this.priming = true; ch0.fill(0); for (let c = 1; c < out.length; c++) out[c].fill(0); this.pushLvl(0); return true; }
    }

    let sum = 0;
    for (let i = 0; i < ch0.length; i++) {
      let s = 0;
      if (this.q.length) {
        const head = this.q[0];
        s = head[this.qi++];
        if (this.qi >= head.length) { this.q.shift(); this.qi = 0; }
      }
      // gain glide (fade-out on cut, fade-in on resume)
      if (this.gain < this.target) this.gain = Math.min(this.target, this.gain + fadeStep * 2);
      else if (this.gain > this.target) this.gain = Math.max(this.target, this.gain - fadeStep);
      s *= this.gain;
      ch0[i] = s;
      sum += s * s;
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch0);
    if (this.cutting && this.gain <= 0.001) {
      this.q = []; this.qi = 0; this.cutting = false; this.target = 1; this.priming = true;
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
      const audible = this.rms > 0.004 || this.buffered() > 0;
      if (audible !== this.wasAudible || audible) {
        this.port.postMessage({ t: 'lvl', rms: this.rms, buffered: this.buffered(), audible });
      }
      this.wasAudible = audible;
    }
  }
}

registerProcessor('alv-capture', AlvCapture);
registerProcessor('alv-player', AlvPlayer);
