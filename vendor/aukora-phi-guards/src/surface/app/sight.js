// Aukora Spatial — SIGHT: she can actually look at the screen.
//
// ══ WHY THIS EXISTS ══
//
// She was told she had sight and did not. What existed was a forge-only eye: it captured a <canvas>
// during a `build: … x3` refinement loop and was reachable no other way. The Unfolding surface paints
// its content as DOM, not canvas, so there was nothing for it to capture — and when the owner asked
// "can you see the screen I'm on right now", the honest answer was no. A capability that exists in one
// code path and is described as if it were general is worse than one that does not exist at all,
// because the person plans around it.
//
// ══ TWO WAYS TO SEE, AND THE DIFFERENCE IS THE OWNER'S CONSENT ══
//
//   HER OWN SURFACE — no permission, no prompt. The page rasterises itself: the DOM is serialised into
//   an SVG <foreignObject> with its computed styles inlined, drawn to a canvas, and read back. Nothing
//   leaves the page except the resulting image, and only when she is answering a question about it.
//
//   THE WHOLE SCREEN — getDisplayMedia, which is a real browser permission the owner grants by hand,
//   per session, choosing exactly which window or screen to share. This is the only honest way to see
//   something outside the app, and it is deliberately the one that asks.
//
// Neither runs on its own. Sight happens when the owner asks a question about what is on screen, or
// when she reaches for it — never in the background, and never without producing a visible turn.
//
// ══ AND THE ONE THING STRUCTURE CANNOT ANSWER: HOW IT LOOKS ══
//
// The argument below — that reading the tree beats photographing it — is right, and it is right about
// STRUCTURE. It says nothing about APPEARANCE, and the two were being treated as one question. The tree
// gives her the selector, the label, the box and the position; it cannot tell her that two boxes overlap
// in the render, that the contrast is unreadable, or that the thing he is looking at is visibly wrong.
// "The spacing is wrong" is not a question about the DOM. It is a question about the picture.
//
// So the instrument is chosen by the TURN: structure by default, pixels when the sentence is about
// appearance. Both, always — never one forever. `isAppearanceTurn` is where that decision lives.
//
// ══ AND WHEN THE EYE DOES NOT WORK, SHE SAYS SO ══
//
// This file's own first paragraph records what happens otherwise: "she was told she had sight and did
// not." The failure that would recreate it is quieter than the original — falling back to the tree while
// still speaking as though a picture had been taken. So every fallback below carries `blind`: the reason
// she could not look, in words, for the caller to put in front of him in that same turn.

/**
 * Read at call time, not at import.
 *
 * `const DOOR = window.location.origin` ran the instant this module loaded, which made the whole file
 * unimportable anywhere without a DOM — including the test runner. The decisions in here (which
 * instrument a turn needs, what she says when she cannot see) are ordinary functions, and they were
 * verifiable only by grepping the source because of one line at the top.
 */
const door = () => (typeof window === 'undefined' ? '' : window.location.origin);


// ---------------------------------------------------------------------------
// SHE LIVES IN THE CODE. Reading the surface is not a screenshot.
// ---------------------------------------------------------------------------

/**
 * What is on screen, as STRUCTURE — the default, and the correction of a real design error.
 *
 * The first version of this file rasterised the DOM to a PNG and sent it to a vision model. For her
 * own surface that is backwards in every dimension: the DOM is already structured data she holds, and
 * a screenshot is a lossy re-encoding of it that costs a billed call, takes seconds, and comes back
 * less useful. A picture tells her "there is a button on the left". The tree tells her the selector —
 * so she can ACT on what she sees instead of describing it.
 *
 * Vision is kept for the one case it is actually right for: something with no structure to read (a
 * photograph, a canvas bitmap, another application's window). Everything else is read.
 */
export function readSurface(root = document.body, opts = {}) {
  const maxNodes = opts.maxNodes || 400;
  const lines = [];
  let n = 0;

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // Only what a person could actually see or act on. A tree that includes every wrapper div is a
  // transcript of the framework, not a description of the screen.
  const INTERESTING = /^(BUTTON|A|INPUT|TEXTAREA|SELECT|IMG|CANVAS|VIDEO|H1|H2|H3|H4|LABEL|SUMMARY)$/;

  const walk = (el, depth) => {
    if (n >= maxNodes || depth > 12) return;
    if (!visible(el)) return;

    const tag = el.tagName;
    const own = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent.trim()).join(' ').trim();
    const isLeafText = own && el.children.length === 0;

    if (INTERESTING.test(tag) || isLeafText) {
      const r = el.getBoundingClientRect();
      const bits = [`${'  '.repeat(Math.min(depth, 6))}${tag.toLowerCase()}`];
      if (el.id) bits.push(`#${el.id}`);
      if (el.className && typeof el.className === 'string') bits.push(`.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`);
      const label = own || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('alt') || '';
      if (label) bits.push(`  "${label.slice(0, 120)}"`);
      if (el.disabled) bits.push('  [disabled]');
      if (tag === 'CANVAS') bits.push(`  [canvas ${el.width}x${el.height} — a bitmap; ask to LOOK if you need its contents]`);
      bits.push(`   @${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      lines.push(bits.join(''));
      n++;
    }
    for (const child of el.children) walk(child, depth + 1);
  };

  walk(root, 0);

  const title = document.title;
  const size = `${window.innerWidth}x${window.innerHeight}`;
  const head = `screen ${size} · "${title}" · ${n} visible element(s)`;
  const truncated = n >= maxNodes ? `\n… stopped at ${maxNodes} elements` : '';
  return `${head}\n\n${lines.join('\n')}${truncated}`;
}

/** Is there anything here that structure cannot answer? */
export function hasUnreadable(root = document.body) {
  return [...root.querySelectorAll('canvas, video, img')].some((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 40;
  });
}

// ---------------------------------------------------------------------------
// PIXELS — only when there is no structure to read
// ---------------------------------------------------------------------------

/**
 * Rasterise a live element to a PNG data URL, with no dependencies and no network.
 *
 * The <foreignObject> trick renders real HTML inside an SVG image, which the browser will then draw to
 * a canvas. The catch that makes naive versions produce a blank or unstyled picture: the SVG is a
 * SEPARATE document and inherits none of the page's stylesheets, so every visible property has to be
 * carried across on the elements themselves. That is what `inlineComputedStyles` does, and it is why
 * this is worth the length — a screenshot that silently comes back blank is the failure mode that
 * would send us straight back to "she says she can see and cannot".
 */
/**
 * ══ WHAT THIS PICTURE IS NOT — MEASURED, by rendering a capture back into the page and looking ══
 *
 * The result is legible and it is genuinely the interface: the transcript, the cards, the composer, the
 * text, all readable. It is NOT a screenshot, and two differences are big enough that a description
 * drawn from it can be wrong about the very thing it is being asked about:
 *
 *   · POSITION:FIXED ELEMENTS MOVE. The SVG document has no viewport, so anything positioned against
 *     one lands relative to the wrapper instead. Observed: the composer, which sits at the bottom of the
 *     live page, was drawn on top of the transcript. An eye told "the panels overlap" would be reporting
 *     something true of the picture and false of the screen.
 *   · IT IS THE ELEMENT, NOT THE VIEW. The whole laid-out element is drawn from its own origin, so a
 *     scrolled page is captured from the top — what she sees is not necessarily what he is looking at.
 *
 * Also absent, by construction rather than by measurement: `::before`/`::after` (only real elements are
 * walked), shadow roots (`cloneNode` does not carry them), iframe content, and any image that could not
 * be fetched same-origin (`inlineImages` drops the src rather than failing the capture).
 *
 * None of this is fixable inside a page — a faithful screenshot needs a real browser engine or the
 * owner's own screen share, which is what `beginScreenShare` is for. It is written down here so the next
 * person weighing a vision model's verdict knows how much of the frame it can be trusted about.
 */
export async function captureElement(el, opts = {}) {
  const maxW = opts.maxWidth || 1100;
  // FALL BACK RATHER THAN GIVE UP. A measured size of zero does not mean there is nothing to see: an
  // element can report 0×0 while it is perfectly visible (a portaled `position:fixed` root read at the
  // wrong moment, or a background tab whose layout has gone stale). Refusing there told the owner "I
  // can't see" about a screen that was fully on display — the exact failure this file exists to end.
  // So: try the element, then its own root, then the viewport.
  let target = el;
  let rect = target.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) {
    target = document.querySelector('.sfc-full') || document.body;
    rect = target.getBoundingClientRect();
  }
  const w = Math.max(1, Math.round(rect.width) || window.innerWidth);
  const h = Math.max(1, Math.round(rect.height) || window.innerHeight);
  if (w < 8 || h < 8) throw new Error('the page reports no size at all — is the window minimised?');
  el = target;

  const clone = el.cloneNode(true);
  inlineComputedStyles(el, clone);
  await inlineImages(clone);

  // Canvases do not survive cloning — their bitmap is not part of the DOM — so each one is replaced by
  // a picture of itself. Without this, anything she has DRAWN is a blank rectangle in her own eye.
  const srcCanvases = el.querySelectorAll('canvas');
  const dstCanvases = clone.querySelectorAll('canvas');
  for (let i = 0; i < srcCanvases.length; i++) {
    const src = srcCanvases[i], dst = dstCanvases[i];
    if (!src || !dst || !src.width || !src.height) continue;
    try {
      const img = document.createElement('img');
      img.src = src.toDataURL('image/png');
      img.setAttribute('style', dst.getAttribute('style') || '');
      dst.replaceWith(img);
    } catch { /* a tainted canvas stays blank rather than taking the whole capture down */ }
  }

  const xml = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`
    + `<foreignObject width="100%" height="100%">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px">${xml}</div>`
    + `</foreignObject></svg>`;

  const img = new Image();
  img.decoding = 'sync';
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error('the page could not draw itself'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });

  const scale = Math.min(1, maxW / w);
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * scale);
  cv.height = Math.round(h * scale);
  const ctx = cv.getContext('2d');
  // The page's own background, because foreignObject renders transparent and a diagram on transparent
  // reads as a diagram on white in most vision models.
  ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#0b0d18';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/png');
}

/** Carry every visible property onto the clone; the SVG document has none of our stylesheets. */
function inlineComputedStyles(src, dst) {
  const CARRY = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'inset', 'width', 'height',
    'max-width', 'max-height', 'min-width', 'min-height', 'margin', 'padding', 'box-sizing',
    'flex', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap', 'order',
    'grid-template-columns', 'grid-template-rows',
    'color', 'background-color', 'background-image', 'background-size', 'background-position',
    'border', 'border-radius', 'box-shadow', 'opacity', 'overflow', 'z-index',
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
    'text-align', 'text-transform', 'text-decoration', 'white-space', 'word-break',
    'transform', 'fill', 'stroke', 'stroke-width', 'visibility',
  ];
  const walk = (a, b) => {
    if (a.nodeType !== 1) return;
    const cs = getComputedStyle(a);
    let css = '';
    for (const k of CARRY) {
      const v = cs.getPropertyValue(k);
      if (v && v !== 'none' && v !== 'normal' && v !== 'auto') css += `${k}:${v};`;
    }
    // backdrop-filter does not render in foreignObject and leaves panels looking flat; the background
    // colour above already carries the panel, so dropping it is closer to the truth than keeping it.
    b.setAttribute('style', css);
    const ac = a.children, bc = b.children;
    for (let i = 0; i < ac.length && i < bc.length; i++) walk(ac[i], bc[i]);
  };
  walk(src, dst);
}

/** Same-origin images have to become data: URLs — the SVG document cannot fetch them. */
async function inlineImages(root) {
  const imgs = [...root.querySelectorAll('img')].filter((i) => i.src && !i.src.startsWith('data:'));
  await Promise.all(imgs.map(async (i) => {
    try {
      const blob = await fetch(i.src).then((r) => r.blob());
      i.src = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
    } catch { i.removeAttribute('src'); }
  }));
}

// ---------------------------------------------------------------------------
// THE WHOLE SCREEN — only with the owner's own hand on the permission
// ---------------------------------------------------------------------------

let shared = null;   // a live MediaStream, kept only while the owner leaves it running

/**
 * Ask the browser for a screen. The owner chooses what to share, and can stop it at any time from the
 * browser's own indicator — which is exactly why this is the right mechanism rather than something the
 * app could grant itself.
 */
export async function beginScreenShare() {
  if (shared && shared.active) return { ok: true, already: true };
  if (!navigator.mediaDevices?.getDisplayMedia) return { ok: false, error: 'this browser cannot share a screen' };
  try {
    shared = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: false });
    shared.getVideoTracks()[0]?.addEventListener('ended', () => { shared = null; });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 120) };
  }
}

export function isSharing() { return !!(shared && shared.active); }
export function endScreenShare() { try { shared?.getTracks().forEach((t) => t.stop()); } catch { /* already gone */ } shared = null; }

/** One frame from the shared screen, as a PNG data URL. */
export async function captureScreen() {
  if (!isSharing()) throw new Error('no screen is being shared');
  const track = shared.getVideoTracks()[0];
  const video = document.createElement('video');
  video.srcObject = shared;
  video.muted = true;
  await video.play();
  // One frame needs one paint; without the wait the first capture is a black rectangle.
  await new Promise((r) => setTimeout(r, 220));
  const s = track.getSettings();
  const cv = document.createElement('canvas');
  cv.width = Math.min(1400, s.width || video.videoWidth || 1280);
  cv.height = Math.round(cv.width * ((s.height || video.videoHeight || 800) / (s.width || video.videoWidth || 1280)));
  cv.getContext('2d').drawImage(video, 0, 0, cv.width, cv.height);
  video.pause();
  video.srcObject = null;
  return cv.toDataURL('image/png');
}

// ---------------------------------------------------------------------------
// LOOKING, AND SAYING WHAT SHE SEES
// ---------------------------------------------------------------------------

/**
 * Take a picture and ask a vision model what is in it.
 *
 * Routed through the same door and the same key as everything else — sight is a billed model call like
 * any other, and pretending otherwise would hide a real cost behind a friendly word.
 */
export async function look(question, opts = {}) {
  // READ FIRST. Structure is exact, instant, free, and actionable; a picture is none of those. Pixels
  // are reached for only when the answer genuinely is not in the tree — a shared screen, or a bitmap
  // big enough to be carrying the meaning.
  if (!opts.screen) {
    const root = opts.root || document.body;
    const tree = readSurface(root);

    // STRUCTURE ALWAYS; PIXELS WHEN THE TURN IS ABOUT APPEARANCE. The first version escalated to a
    // vision call whenever the page held an unreadable element — and this surface always holds one,
    // because the living ground IS a canvas. So every look paid for a screenshot, which is precisely
    // the cost this rewrite exists to remove.
    //
    // The replacement is not "never escalate", which left "the spacing is wrong" being answered from a
    // tree that cannot see spacing. It is: escalate when HIS SENTENCE is about how something looks, and
    // never otherwise. A caller may still decide for itself by passing `forcePixels` either way.
    const wantsPixels = opts.forcePixels === undefined ? asksAboutAppearance(question) : !!opts.forcePixels;
    if (!wantsPixels) {
      return { ok: true, saw: tree, source: 'the surface itself, read directly', kind: SOURCE_KIND.TREE, structural: true };
    }

    // The pixels are wanted. Send the tree WITH the picture, so she has exact structure and whatever the
    // render is carrying — the two answer different questions.
    let image;
    try {
      image = await captureElement(root, {});
    } catch (e) {
      // NOT SWALLOWED. The tree still comes back because it is genuinely useful, but the caller is told
      // in the same breath that no picture was taken, so it cannot narrate a look that did not happen.
      return unseen(tree, `I could not take a picture of the screen — ${String(e?.message || e).slice(0, 140)}`);
    }
    let r;
    try {
      r = await fetch(door() + '/api/forge/look', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image, mode: 'describe', goal: `${question || 'Describe what is on this screen.'}\n\nThe exact structure is:\n${tree.slice(0, 6000)}` }),
      }).then((x) => x.json());
    } catch {
      return unseen(tree, 'the door did not answer when I tried to look');
    }
    return r?.ok
      ? {
        ok: true, saw: r.critique, source: 'the surface, read and then looked at',
        kind: SOURCE_KIND.CANVAS, eye: r.eye || null, structural: false,
        status: r.status || 'SAW', provenance: r.provenance || null,
      }
      // VACUOUS TRAVELS AS ITSELF. The tree still comes back — it is genuinely useful — but the caller
      // is told the picture had no subject, which is neither sight nor a failure to look.
      : { ...unseen(tree, sayWhy(r?.error)), status: r?.status || 'BLIND', provenance: r?.provenance || null };
  }

  // A screen the owner shared. No structure exists to read — this is the case pixels are for.
  if (!isSharing()) return { ok: false, error: 'no screen is being shared', source: 'nothing', kind: SOURCE_KIND.NONE };
  const image = await captureScreen();
  const r = await fetch(door() + '/api/forge/look', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image, mode: 'describe', goal: question || 'Describe what is on this screen.' }),
  }).then((x) => x.json()).catch(() => ({ ok: false, error: 'the door did not answer' }));
  return r?.ok
    ? {
      ok: true, saw: r.critique, source: 'the screen you are sharing',
      kind: SOURCE_KIND.SCREEN, eye: r.eye || null, structural: false,
      status: r.status || 'SAW', provenance: r.provenance || null,
    }
    : {
      ok: false, error: sayWhy(r?.error), blind: sayWhy(r?.error),
      source: 'the screen you are sharing', kind: SOURCE_KIND.SCREEN,
      status: r?.status || 'BLIND', provenance: r?.provenance || null,
    };
}

/** The tree came back and the picture did not — and the caller is told which, every time. */
function unseen(tree, why) {
  return {
    ok: true,
    saw: tree,
    source: 'the surface, read — I could not look at it',
    kind: SOURCE_KIND.TREE_BLIND,
    structural: true,
    blind: why || 'the eye did not say why',
  };
}

/**
 * The door's refusal codes, in words she can say out loud.
 *
 * `look_no_key` on screen is the same failure as no message at all: the owner learns that something
 * went wrong and nothing about what to do. Each of these has a different remedy — arm the node, set a
 * key, wait, or nothing at all — and telling them apart is the difference between a report and a shrug.
 */
/**
 * ══ WHICH EYE IS OPEN — AS A VALUE, NOT AS A SENTENCE ══
 *
 * Three sources returned the same `saw` field with three different English `source` strings, so the
 * owner could not tell which one had answered and nothing downstream could branch on it. Prose is for
 * him to read; this is for the surface to switch on. Both travel, and they cannot disagree because
 * they are set in the same place.
 */
export const SOURCE_KIND = Object.freeze({
  /** The DOM read directly. No picture was taken; nothing left the page. */
  TREE: 'tree',
  /** The tree AND a picture of this surface, looked at by a model. */
  CANVAS: 'canvas',
  /** A screen the owner shared through getDisplayMedia. */
  SCREEN: 'screen',
  /** The tree came back and the picture did not — and the caller is told which. */
  TREE_BLIND: 'tree-blind',
  /** Nothing was available to look at. */
  NONE: 'none',
});

export function sayWhy(code) {
  const c = String(code || '');
  // ══ NOTHING WAS THERE, WHICH IS NOT THE SAME AS NOT LOOKING ══
  //
  // A blank frame used to come back as ordinary success carrying "The screen is blank." — the model
  // was right and the SHAPE was the lie. These are the two frames that have no subject, and the
  // sentences say what happened rather than reporting a failure, because nothing failed.
  if (c === 'look_frame_blank') {
    return 'I looked and the frame was empty — one flat colour, nothing in it. No model was asked, '
      + 'because there was nothing to ask about';
  }
  if (c === 'look_frame_invalid') {
    return 'what was captured was not a picture I could look at — so I did not pretend to';
  }

  // ══ THE TWO REFUSALS THAT MEAN "YOUR SCREEN WAS ABOUT TO LEAVE THIS MACHINE" ══
  //
  // Not errors in the ordinary sense — a deliberate stop, and the sentence has to say so, because a
  // person who reads "the eye failed" will go looking for a bug rather than making a decision.
  if (c === 'look_remote_refused_local_present') {
    return 'I stopped: this machine has its own eye, and answering that would have sent a picture of '
      + 'your whole screen to a vendor instead. Nothing was sent. If you want that, the node has to be '
      + 'started with AUKORA_LOOK_REMOTE=1 — deliberately, by you';
  }
  if (c === 'look_remote_refused') {
    return 'I stopped: there is no eye on this machine, and the only ones left are somewhere else. '
      + 'Nothing was sent. A picture of your screen leaving here is a decision, not a fallback — start '
      + 'the node with AUKORA_LOOK_REMOTE=1 if you mean it';
  }
  if (c === 'look_no_key') return 'this node has no model key, so there is nothing to look with';
  if (c === 'forge_not_armed') return 'this node was started without AUKORA_FORGE=1, so the eye is switched off';
  if (c === 'look_image_too_large') return 'the picture of the screen was too big to send';
  if (c === 'look_not_an_image') return 'what the page produced was not a picture';
  if (c === 'look_no_image') return 'the page produced nothing to look at';
  if (c === 'look_empty') return 'the vision model answered with nothing at all';
  if (c === 'refused-no-standing') return 'this node is standing at the courtyard, and looking is a billed call';
  if (/^look_http_/.test(c)) return `the vision model refused the request (HTTP ${c.slice('look_http_'.length)})`;
  if (/^look_failed/.test(c)) return `the call to the vision model failed — ${c.slice('look_failed:'.length).trim() || 'no reason given'}`;
  return c ? `the door said ${c}` : 'the door did not say why';
}

/**
 * What she says in the turn when the eye did not work.
 *
 * One sentence, always produced, whatever it is handed — because the branch that returns nothing is the
 * branch that becomes a silent fallback, and this repository has documented false narration four times.
 */
export function blindNote(reason) {
  const why = String(reason || '').trim() || 'the eye did not say why';
  return `I could not look at the screen this turn — ${why}. What follows was worked out without seeing it.`;
}

/** Does the owner's sentence ask her to LOOK at something? */
export function asksToSee(text) {
  const t = String(text || '');
  return /\b(see|look at|looking at|view|what('| i)?s on (the |my )?screen|describe (this|the screen|what)|read (the|this) screen|can you see)\b/i.test(t);
}

/**
 * Is this turn about how something LOOKS?
 *
 * ══ WHY A LIST OF WORDS AND NOT A MODEL ══
 *
 * The alternative is asking a small model whether he meant appearance, and that is the exact defect this
 * project has removed twice: a model in front of the hand, deciding what he meant. A regex is stupid,
 * inspectable and testable, and when it is wrong it is wrong in a way anyone can read.
 *
 * ══ WHY IT LEANS TOWARDS NOT LOOKING ══
 *
 * A false positive costs a billed vision call on a turn that did not need one — the owner's money, spent
 * on his behalf by a guess. A false negative costs what today already costs: the hand works from source
 * alone, which is where it has been the whole time. So the vocabulary here is deliberately the language
 * of appearance and nothing broader. "Broken" on its own is not on it: a broken build and a broken
 * layout are the same word and different turns.
 */
const APPEARANCE_RE = new RegExp([
  // "it looks wrong", "this looks broken", "how it looks"
  '\\blooks?\\s+(wrong|bad|broken|off|odd|ugly|weird|awful|messy|squashed|cramped|cluttered|empty|fine|nicer?|better|cleaner)\\b',
  '\\b(how it looks|the look of it|looks like a mess)\\b',
  // "this is broken" — the appearance sense, tied to the thing on screen rather than to a build
  '\\b(this|it|that|everything|the (layout|page|screen|surface|panel|composer|header|button|ui))\\s+(is|are|looks?)\\s+broken\\b',
  // the plain vocabulary of a rendered thing
  '\\b(layout|spacing|spaced|alignment|aligned|align|centred|centered|off-?cent(re|er)|margins?|padding|gaps?|indent(ation)?)\\b',
  '\\b(colou?rs?|contrast|shading|theme|dark mode|light mode|fonts?|typeface|text size|type size)\\b',
  '\\b(overlap(ping)?|overflow(ing)?|cut off|clipped|cropped|squashed|crooked|wonky|lopsided|crowded|cramped)\\b',
  '\\btoo\\s+(big|small|wide|narrow|tall|short|tight|close|far|bright|dark|faint|bold|thin|loud|busy)\\b',
  '\\b(nicer|prettier|cleaner|tidier|prettify|tidy up|ugly|beautiful|elegant)\\b',
  // NOT "on screen" — that is about WHERE something is, which `asksToSee` already covers and the tree
  // already answers. Putting it here would buy a vision call for every "what's on screen".
  '\\b(styling|css|visual(ly)?|appearance)\\b',
].join('|'), 'i');

export function asksAboutAppearance(text) {
  return APPEARANCE_RE.test(String(text || ''));
}

/**
 * THE DECISION, in one place: does this turn need the eye?
 *
 * He should not have to ask her to look. Until now the eye ran only when he said "look at" — so the one
 * kind of turn where a picture is worth its cost, "the spacing is wrong", was answered from source code
 * and guesswork. Two ways in, both his own words: he asked to see, or he is talking about how it looks.
 */
export function isAppearanceTurn(text) {
  return asksToSee(text) || asksAboutAppearance(text);
}
