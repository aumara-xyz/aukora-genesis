# ZETA HARP

**The Riemann–Siegel main sum, drawn as an instrument you can fly.**

KNOWN MATHEMATICS / INTERACTIVE SCIENTIFIC AND ARTISTIC INSTRUMENT / NOT EVIDENCE FOR RH OR GHP

No build, no CDN, no network. Open `index.html` in a browser, or serve the folder statically (e.g. `python3 -m http.server`).

**Also in this repo:** `fold.html` — **THE FOLD**, a four-room interactive explainer of the architecture *around* the instrument (the fold, the golden wind, the 27-cell address, reference compression). It is analogy and architecture, fenced on its own footer: *not evidence for RH or GHP*. The instrument links to it from the masthead; the instrument itself remains quarantined mathematics.

## Layout

- `index.html` — the shell: dark-navy chrome, the cockpit, torus views, the fence
- `fold.html` — THE FOLD: the unlock explainer (analogy, fenced)
- `js/zh-math.js` — the math core: Riemann–Siegel θ, main sum M(t), Truth Audio law. Pure functions, no DOM
- `js/zh-fixtures-1.js` / `js/zh-fixtures-2.js` — embedded high-precision reference windows (W1–W4) + the refined zero list (Odlyzko-derived, mpmath-refined, NOT certified)
- `js/zh-app-1-state.js` — state, term cache, ribbon computation
- `js/zh-app-2-gl.js` — the WebGL2 tunnel renderer
- `js/zh-app-3-panels.js` — chart ribbon, phasor flower, term inspector, zero microscope
- `js/zh-app-4-audio.js` — Truth Audio: the full-sum hum (24 voiced + band-summed, energy-preserving, disclosed live)
- `js/zh-app-5-orchestration.js` — events, the intro tours, the torus room (SHADOW / SLICE / UNFOLD), the fence
- `js/zh-app-6-main.js` — input, cockpit helpers, intro A flight, main loop, boot

## What it is

An interactive observatory for Hardy's Z-function on the critical line:

- the main sum M(t) = Σ 2/√n · cos(θ(t) − t·ln n) rendered as a tunnel of phase trajectories, with the gold resultant drawn in both the 3D tunnel and the chart — the same curve on both surfaces
- a wordless opening flight, then a three-beat controls tour
- the cockpit: PLAY · SPEED · ZOOM · SOUND · VOLUME · DEGREES, each with a one-line plain-words note
- the torus room: the formula's phases on the Clifford torus — SHADOW / SLICE / UNFOLD, with the gold (φ₁, φ₂) phase point tracking you live
- the phasor flower (cross-section), the zero microscope, and the fence (full disclosures)
- Truth Audio: f_n = v_t·(θ′(t) − ln n)/2π — one global v_t, one gain
- the page recomputes M(t) against the embedded fixtures on every load and prints the max deviation in the fence

## The boundary

Nothing in this instrument is evidence for or against the Riemann Hypothesis. Sign changes of the main sum are "computed crossings (finite approximation)" — never certified zeros. Amplitudes are "computed spectral", never "measured". The full boundary text lives in the fence panel inside the instrument.

## Provenance

Math core and fixture lineage: `instruments/zeta_harp_v2/` in [golden-horizon-principle](https://github.com/aumara-xyz/golden-horizon-principle) (validated there against frozen fixtures before the donor shipped; the fixture payload here is byte-identical to the validated excerpts). This repo holds the flight build: same math core, cockpit UI, the torus room restored from the v2 observatory.
