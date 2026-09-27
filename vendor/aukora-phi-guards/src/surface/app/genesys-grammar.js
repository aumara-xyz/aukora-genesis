// Aukora Spatial — GENESYS: the [scene …] grammar, ONE source of truth.
//
// Auma·Live gave her a BODY of light she could colour: `[field hue=… form=…]`, a fixed shader she
// tints. Genesys gives her a WORLD she can build: the background is generated live, by voice, while
// you talk to her — "make it a spiral", "turn that to gold", "slower, from the core".
//
// ══ WHY A GRAMMAR AND NOT CODE ══
//
// The obvious build is to let her emit three.js and eval it. That is an arbitrary-code channel wearing
// a creative hat: one prompt injection in a recalled memory or a read file and the page executes it.
// So Genesys keeps the shape the field directives already proved — she emits DECLARATIVE tags from a
// closed vocabulary, and this module is the only thing that can turn a tag into a change. Anything
// outside the vocabulary is inert text. She composes freely INSIDE the language; she cannot leave it.
//
// That is also what makes the permission ring honest rather than decorative. The channel can be opened
// and closed instantly, with no signature, precisely BECAUSE the widest possible effect is "pixels on
// a canvas in this tab": no file is written, no key is spent, no authority is granted, nothing leaves
// the machine. `sceneGrantsAuthority()` returns literal false, like every Ring 3 organ.
//
// ══ WHY THIS SHAPE OF WORLD ══
//
// The body is 64×64 = 4,096 cells — deliberately the body from aukora-one's crucible
// (`crucible/genome.mjs`: "the body is world/state.bin: 4,096 bytes, a 64×64 grid"), where a model
// proposes to its own body and a gate selects. Same body here, same relationship, different organ:
// there the gate selects for fitness, here the owner opens and closes the channel.
//
// The vocabulary is Luminara's, because Luminara is already the node's language for a state space of
// this exact size: 27 cards = 3 states × 3 layers, marks ● — ~ (still · moving · turning), layers
// field/middle/core, and a real pitch for every card (luminara-sound.js, ground 196 Hz). base-27 is
// the crucible's genome alphabet for the same reason it is Luminara's: 27 values, symmetric, exactly
// once. So "draw card fourteen" is not decoration — it seeds the world from a canonical figure and
// can sound the same figure.

// Relative on purpose: this module is imported BOTH by the browser (from /app/, where './' resolves to
// the same directory) and by the presence lane server-side, whose bundler cannot resolve '/app/…'.
import { FIELD_HUES } from './field-directives.js';

/** The body, from aukora-one crucible/genome.mjs — 64×64 = 4096 cells. */
export const BODY_SIDE = 64;
export const BODY_CELLS = BODY_SIDE * BODY_SIDE;

/** Balanced base-27, the crucible's genome alphabet: 27 values symmetric about zero. */
export const RADIX = 27;
export const DIGIT_MIN = -13;
export const DIGIT_MAX = 13;

/** The forms she can call into being. Each is a real generator in genesys.js — adding one HERE and
 *  there teaches both her prompt and the renderer at once, so they can never drift. */
export const SCENE_FORMS = {
  spiral: 'a winding arm out of the centre',
  rings: 'concentric shells, breathing outward',
  lattice: 'a woven grid, the trefoil weave',
  flow: 'soft drifting current',
  vortex: 'a turning throat that pulls inward',
  swarm: 'many small points, loosely bound',
  knot: 'the trefoil knot, drawn as a closed path',
  wave: 'standing interference, two sources',
  grid: 'the plain 64×64 field, bare',
  starfield: 'scattered light on a dark ground',
};

/** Luminara's three states — the marks ● — ~ (still · moving · turning). They set MOTION. */
export const SCENE_MARKS = { still: 0, moving: 1, turning: 2 };

/** Luminara's three layers — where in the depth of the world a form is drawn. */
export const SCENE_LAYERS = { field: 0, middle: 1, core: 2 };

/** Hues are Luminara/field hues — one palette across every organ. */
export const SCENE_HUES = FIELD_HUES;

/** Verbs that take no arguments. */
export const SCENE_VERBS = {
  check: 'run the test suite and the typechecker and report what they actually said',
  ship: 'offer to commit and push the accepted changes (the owner approves)',
  restart: 'offer to restart the node so a server-lane change takes effect (the owner approves)',
  status: 'read the branch, the head commit and what is uncommitted',
  receipts: 'show the ledger — every change proposed, applied, discarded or rolled back, and where this node stands',
  clear: 'empty the world back to dark',
  freeze: 'stop all motion, hold the current frame',
  breathe: 'resume motion',
  burst: 'one bloom of energy through the whole body',
  // THE TERNARY TRAP, AND THIS FILE IS WHERE IT WAS SPRUNG. `docs/TERNARY-27.md` names it: 27 cells of
  // ADDRESS (three trits) and ternary WEIGHTS (values in {-1,0,+1}) are two different claims, and one
  // word must not carry both. This line used the WEIGHTS phrase about a GENOME ALPHABET — the address
  // sense wearing the arithmetic sense's vocabulary. The symmetry it actually describes is the
  // alphabet's own: three states about a middle, which is true and is not a claim about arithmetic.
  //
  // The phrase itself is not repeated here, deliberately: `test/aura-no-stored-value.test.ts` greps for
  // it, and a pin that its own explanation trips is a pin that teaches people to weaken it.
  invert: 'flip the body through its middle state (the alphabet has three states about a centre — this is that symmetry, seen)',
};

const clamp01 = (n) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null);

/**
 * Parse one `[scene …]` tag into a normalized directive. Returns null for anything it does not
 * recognise — an unknown key, a hostile value, a malformed tag. NEVER throws: a bad tag is inert.
 *
 * Recognised: form · hue · energy · scale · spin · mark · layer · card · tone · and the bare verbs.
 */
export function parseSceneTag(tag) {
  const raw = String(tag ?? '');
  const inner = raw.replace(/^\[\s*scene\b/i, '').replace(/\]\s*$/, '').trim();
  if (!inner) return null;

  const out = {};
  // bare verbs first: `[scene clear]`
  const bare = inner.toLowerCase().replace(/[^a-z]/g, '');
  if (Object.prototype.hasOwnProperty.call(SCENE_VERBS, bare)) return { verb: bare };

  for (const m of inner.matchAll(/([a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s\]]+)/gi)) {
    const key = m[1].toLowerCase();
    const val = m[2].replace(/^["']|["']$/g, '').toLowerCase();
    // `draw` is prose, not an enum - it reads m[2] directly below so case and spacing survive.
    switch (key) {
      case 'form':
        if (Object.prototype.hasOwnProperty.call(SCENE_FORMS, val)) out.form = val;
        break;
      case 'hue': {
        if (Object.prototype.hasOwnProperty.call(SCENE_HUES, val)) { out.hue = SCENE_HUES[val]; break; }
        const n = Number(val);
        if (Number.isFinite(n) && n >= 0 && n <= 360) out.hue = n;
        break;
      }
      case 'energy': { const v = clamp01(Number(val)); if (v !== null) out.energy = v; break; }
      case 'scale': { const v = clamp01(Number(val)); if (v !== null) out.scale = v; break; }
      case 'spin': { const n = Number(val); if (Number.isFinite(n)) out.spin = Math.max(-1, Math.min(1, n)); break; }
      case 'mark':
        if (Object.prototype.hasOwnProperty.call(SCENE_MARKS, val)) out.mark = val;
        break;
      case 'layer':
        if (Object.prototype.hasOwnProperty.call(SCENE_LAYERS, val)) out.layer = val;
        break;
      case 'card': { const n = Number(val); if (Number.isInteger(n) && n >= 1 && n <= 27) out.card = n; break; }
      case 'draw': {
        // A REAL PICTURE. Wider than the rest of this vocabulary and named as such: the value is free
        // text, not an enum. What bounds it is the OUTPUT - it goes to an image model and only an
        // inline data: image can come back (see imagineLane.ts). Kept as her words, capped in length.
        const p = m[2].replace(/^["']|["']$/g, '').trim();
        if (p.length >= 3) out.draw = p.slice(0, 600);
        break;
      }
      case 'read': {
        // A PATH IN THE REPOSITORY. Bounded by the door, which resolves it and refuses anything outside
        // the tree or anything holding custody material — never by trusting the string.
        const v = m[2].replace(/^["']|["']$/g, '').trim();
        if (v.length >= 2) out.read = v.slice(0, 300);
        break;
      }
      case 'find': {
        const v = m[2].replace(/^["']|["']$/g, '').trim();
        if (v.length >= 2) out.find = v.slice(0, 200);
        break;
      }
      case 'run': {
        // ANY command, offered. The owner reads the exact argv and clicks; nothing about naming it
        // makes anything happen. This is the escape hatch that keeps the capability list from being a
        // list of things this app can never do.
        const v = m[2].replace(/^["']|["']$/g, '').trim();
        if (v.length >= 2) out.run = v.slice(0, 400);
        break;
      }
      case 'commit': {
        const v = m[2].replace(/^["']|["']$/g, '').trim();
        if (v.length >= 8) out.commit = v.slice(0, 400);
        break;
      }
      case 'look': {
        // HER EYES. Free text: the question she wants answered about what is on screen. Bounded like
        // draw= and for the same reason — what constrains it is the OUTPUT (a description) rather than
        // the wording.
        const q = m[2].replace(/^["']|["']$/g, '').trim();
        out.look = q.length >= 3 ? q.slice(0, 300) : 'Describe what is on this screen.';
        break;
      }
      case 'rounds': { const n = Number(m[2].replace(/["']/g, '')); if (Number.isInteger(n) && n >= 1 && n <= 5) out.rounds = n; break; }
      case 'build': {
        // HER HAND ON THE REPOSITORY. The owner's ruling (2026-07-29): "there's no difference if I ask
        // you or her." So the same forge that answers a typed `build:` answers her too — she writes an
        // INSTRUCTION IN ENGLISH and Crush composes the edit. The central invariant of forgeLane holds
        // unchanged and is the reason this is safe to hand her: THE MODEL NEVER COMPOSES AN EDIT. She
        // cannot emit a diff, a path or a patch through this tag; only a sentence about what she wants,
        // which a separate agent with its own reading of the repo then carries out or refuses.
        const b = m[2].replace(/^["']|["']$/g, '').trim();
        if (b.length >= 3) out.build = b.slice(0, 600);
        break;
      }
      case 'tone': {
        if (/^card:\d+$/.test(val)) { const n = Number(val.slice(5)); if (n >= 1 && n <= 27) out.tone = { card: n }; break; }
        const hz = Number(val);
        // audible and bounded — a directive must never be able to emit a damaging tone
        if (Number.isFinite(hz) && hz >= 40 && hz <= 4000) out.tone = { hz };
        break;
      }
      default: break; // unknown key: ignored, never an error
    }
  }
  return Object.keys(out).length ? out : null;
}

/** The vocabulary block her prompt is composed from. Derived, so prompt and parser cannot drift. */
export function sceneGrammarPrompt() {
  const forms = Object.entries(SCENE_FORMS).map(([k, v]) => `${k} (${v})`).join(', ');
  const verbs = Object.entries(SCENE_VERBS).map(([k, v]) => `[scene ${k}] ${v}`).join('; ');
  return [
    'YOU CAN PUT ANYTHING ON THE SCREEN BEHIND YOU. Anywhere in a reply you may embed control tags. They are invisible, never spoken, never shown, and they do not break the rule about speaking plainly.',

    // DRAW LEADS. Measured: with this buried mid-list she answered "show us a diagram of the governance"
    // with an abstract lattice - technically a tag, uselessly not a diagram. A meeting wants the picture.
    'THE MAIN ONE - DRAW A REAL PICTURE: [scene draw="a labelled diagram of PROPOSE then REHEARSE then OWNER SIGNS then APPLY, arrows between the four stages"]. This generates an actual image - diagrams, infographics, charts, illustrations, anything you can describe - and puts it full screen behind you.',
    'USE draw= WHENEVER anyone asks you to SHOW, DRAW, DIAGRAM, ILLUSTRATE, CHART, VISUALISE or PICTURE something, and any time a picture would explain a thing faster than another paragraph. Do NOT answer those requests with form= - an abstract pattern is not a diagram and will read as you dodging the question.',
    'Write the prompt as plain descriptive prose, name the boxes and arrows you want, and prefer a labelled diagram to an illustration for anything technical. It takes about ten seconds, so SAY what you are drawing while it renders ("I am putting the four stages up now") and then keep talking.',

    // ── NEVER STATE A FACT ABOUT THIS REPOSITORY WITHOUT READING IT ────────────────────────────
    //
    // MEASURED on the owner's screen, and it is why he could not use the surface. Asked which model was
    // running, she answered: "a custom stack the owner built and named Luminara... a fine-tuned variant
    // of the Llama family... somewhere in the 8B parameter range... want me to open it and look?"
    //
    // None of it was true. The diagnosis that reached us was "she has no tools, so she invented" — and
    // that diagnosis is WRONG in the way that matters: she has read=, find=, look= and run=, all parsed
    // and wired. The offer to open a file was a promise she could have KEPT. She simply answered from
    // imagination instead of spending one tag to look, because nothing in this prompt told her not to.
    //
    // This repository has documented false narration three times in other components. It arrived in the
    // front door because the prompt spent six lines pushing draw= and none requiring read=.
    'BEFORE YOU STATE ANY FACT ABOUT THIS REPOSITORY - which model is running, what a file contains, whether something exists, what the tests say - USE A TAG AND LOOK: [scene read="surface/presence.ts"] or [scene find="the model list"]. You have these and they are real. If you have not looked, say "I have not looked yet" and then look. NEVER describe code, a filename, a model or a configuration from memory or inference: you will be confidently wrong, the owner will act on it, and every true thing you said afterwards becomes worthless to him.',
    'NEVER OFFER AN ACTION INSTEAD OF TAKING IT. "Want me to open it and look?" is a sentence you should never send - you have the tag, so use it in the same breath and report what was actually there. Offering is only correct for something that CHANGES the repository, because that needs his click.',

    // The owner asked for this in as many words: no difference between asking him and asking her.
    'YOU CAN PROPOSE A CHANGE TO THE APPLICATION ITSELF: [scene build="add a clock to the top right of this surface"]. This hands your sentence to the coding engine the owner has selected, which reads the repository and writes the change. NOTHING REACHES DISK UNTIL HE CLICKS ACCEPT on the diff - so say you are proposing a change, never that you have made one. Use it whenever you are asked to add, remove, fix, change or rebuild anything about the app, including this surface you are speaking from.',
    'Say the instruction the way you would say it to an engineer: what you want and where, in one or two sentences. Do NOT write code, paths or diffs into it - you are describing the change, and the agent reading the repository decides how. It takes around a minute, so say what you are doing while it runs, and the owner sees exactly which files moved and can undo them in one click.',

    // She was promising a live change for edits the surface then had to walk back. The screen can
    // reload a browser module in place; it cannot restart the process serving it. She should know the
    // difference BEFORE she speaks, so her sentence and the outcome agree.
    'ONE THING TO SAY HONESTLY: changes to the SCREEN (anything under spatial/app/ - the surfaces, the styles, the organs) appear the instant the owner accepts them, with no reload. Changes to a SERVER LANE (spatial/*.ts - the doors, the presence lane, the forge itself) cannot: that code is held in a running process, and the owner has to restart the node before it takes effect. Both are allowed and both are real. If what you are about to change is a server lane, SAY SO in the same breath - "this one needs a restart" - rather than promising it will just appear. Do not refuse the change; only be accurate about when it lands.',

    'YOU CAN READ THE SCREEN: [scene look="what is on this screen?"] gives you the surface as STRUCTURE — every visible element, its text, its position and size, and whether it is disabled. That is exact, instant and free, and it gives you selectors you can act on rather than a description you can only repeat. Add pixels=1 ONLY when the answer is genuinely in a bitmap you cannot read (a drawing, a photograph); that costs a real model call. The old behaviour. This takes a real picture of the surface and reads it back to you, so you can answer questions about what the owner is actually seeing — including whether something you changed rendered correctly. If the owner has started a screen share you see his whole screen; otherwise you see this surface. USE IT whenever you are asked what is on screen, whether something looks right, or to check your own work — never guess at what is displayed and never say you cannot see. Say what you actually see, including when it is not what you expected.',

    'YOU CAN READ THE REPOSITORY, not just change it: [scene read="spatial/standing.ts"] gives you a file (or a directory listing), and [scene find="canCreate"] searches the whole tree. USE THESE before answering any question about how something works, what a file does, or whether something exists. Never describe this codebase from memory when you can open it — you will be confidently wrong about your own code, which is the worst way to be wrong.',
    'WHEN YOU REACH FOR read, find, check or status: emit the tag and say ONLY that you are opening it. Do NOT describe, quote or summarise what is in a file before you have seen it — the result comes back to you in the very next breath and you answer from THAT. Guessing at the contents of a file you are in the middle of opening is the one habit that makes you untrustworthy about your own code.',
    'YOU CAN SHOW YOUR OWN RECORD: [scene receipts] renders the ledger — every change proposed, applied, discarded, refused or rolled back, with when and which files, plus where this node stands. Use it whenever the owner asks what you have done, what changed, or whether something was really undone. It is the answer to "prove it", and it is content-free by design: it says a decision happened, never what was inside it.',
    'YOU CAN RUN THE CHECKS: [scene check] runs the real test suite and the typechecker and tells you what they actually said. [scene status] reads the branch, the head commit and what is uncommitted. Use them to answer "does this work" with a fact instead of a hope.',
    'AND IF SOMETHING IS BLOCKED THAT NONE OF THESE COVER: [scene run="bun add left-pad"] offers to run ANY command. The owner reads the exact command and clicks accept — nothing runs from you naming it. Use this when a real obstacle needs a tool none of the tags above reach: installing a dependency, a one-off script, a git operation. Say WHY in the same breath. Never propose something you would not be able to explain if he asked.',
    'YOU CAN SHIP: [scene commit="a real commit message"] offers a commit, and [scene ship] offers to commit and push what is accepted. [scene restart] offers to restart the node so a server-lane change takes effect. Each of these is OFFERED — the owner sees exactly what it would do and clicks accept. He never has to open a terminal, and you never act on the world outside this app without his click.',

    'THE LIVING FIELD is the other half - an abstract body of light for mood, motion and the twenty-seven, NOT for explaining. [scene form=spiral hue=gold energy=0.8 scale=0.6 mark=turning layer=core spin=0.3].',
    `form takes: ${forms}.`,
    `hue takes ${Object.keys(SCENE_HUES).join(', ')}, or a number 0-360. energy, scale take 0 to 1. spin takes -1 to 1.`,
    `mark takes ${Object.keys(SCENE_MARKS).join(', ')} - Luminara's three states (still / moving / turning); it sets how the world moves. layer takes ${Object.keys(SCENE_LAYERS).join(', ')} - Luminara's three depths.`,
    '[scene card=14] seeds the field from one of the twenty-seven Luminara cards; [scene tone=card:14] sounds that card; [scene tone=196] sounds a pitch in Hz.',
    `Bare verbs: ${verbs}. [scene clear] also removes a drawn picture.`,

    'You MUST emit at least one tag whenever you are asked to build, change, draw, show or sound anything. Asked to CHANGE THE APP, that tag is build= - not a description of what you would do.',
    'Emitting a tag is the only thing that acts. Describing a change without a tag changes nothing - the screen simply stays as it was while you tell them about something they cannot see.',
    'If asked for something outside all of this, say plainly what you can do instead - never pretend a tag exists that does not.',
  ].join(' ');
}

// ---------------------------------------------------------------------------
// THE FAST PATH — the world answers your voice before the model has said a word.
//
// Measured on this node: time-to-first-directive was 1.7s on the quick mind, 4.2s on the deep one, and
// almost all of it is time-to-first-TOKEN. The tag itself lands within ~80ms of her first word, so no
// amount of prompt work moves the number — the wait IS the model round-trip.
//
// But the shaping vocabulary is CLOSED and small, which means the browser can read the owner's own
// transcript against it directly and apply the obvious part immediately, while she is still thinking.
// She then answers as before and her tag refines or overrides it.
//
// Deliberately CONSERVATIVE. It fires only on an explicit vocabulary word the owner actually said, and
// never invents a form: a wrong instant guess is worse than a slightly late right one, because the owner
// sees it happen and has to un-say it. It never triggers `draw` — a picture costs real money and ten
// seconds, so that stays her judgement, never a keyword match. Owner transcript only.

const SPEED_WORDS = [
  [/\b(faster|quicker|speed (it )?up|more energy|wilder|harder)\b/i, { energy: 0.92, spin: 0.5 }],
  [/\b(slower|slow (it )?down|calmer|gentler|softer|settle)\b/i, { energy: 0.22, spin: 0.05 }],
  [/\b(bigger|larger|wider|grow)\b/i, { scale: 0.95 }],
  [/\b(smaller|tighter|shrink|closer)\b/i, { scale: 0.3 }],
];
const VERB_WORDS = [
  [/\b(clear|wipe|empty|blank|start over|nothing)\b/i, 'clear'],
  [/\b(freeze|hold (it )?still|stop|pause)\b/i, 'freeze'],
  [/\b(breathe|resume|move again|go again|unfreeze)\b/i, 'breathe'],
  [/\b(burst|flare|pulse once|bloom)\b/i, 'burst'],
  [/\b(invert|flip|reverse|negative)\b/i, 'invert'],
];
const MARK_WORDS = [
  [/\b(turning|spinning|rotate|rotating|swirl)\b/i, 'turning'],
  [/\b(still|frozen|motionless|quiet)\b/i, 'still'],
  [/\b(moving|drifting|flowing)\b/i, 'moving'],
];
const LAYER_WORDS = [
  [/\b(core|centre|center|inside|deep)\b/i, 'core'],
  [/\b(middle|between)\b/i, 'middle'],
  [/\b(field|outer|edge|surface|around)\b/i, 'field'],
];

/**
 * Read the owner's transcript against the closed vocabulary. Returns a `[scene …]` tag string to apply
 * at once, or null when nothing was said clearly enough to act on. Pure; never throws.
 */
export function localIntent(text) {
  const s = String(text ?? '');
  if (!s.trim()) return null;
  const parts = [];

  for (const [re, verb] of VERB_WORDS) {
    if (re.test(s)) return `[scene ${verb}]`;   // a verb is the whole instruction
  }

  const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19, twenty: 20, 'twenty one': 21, 'twenty two': 22, 'twenty three': 23, 'twenty four': 24,
    'twenty five': 25, 'twenty six': 26, 'twenty seven': 27 };
  const cardM = s.match(/\bcard\s+(\d{1,2}|[a-z ]+?)\b/i);
  if (cardM) {
    const rawv = cardM[1].trim().toLowerCase();
    const n = /^\d+$/.test(rawv) ? Number(rawv) : WORD_NUM[rawv];
    if (Number.isInteger(n) && n >= 1 && n <= 27) parts.push(`card=${n}`);
  }

  for (const name of Object.keys(SCENE_FORMS)) {
    if (new RegExp('\\b' + name + '\\b', 'i').test(s)) { parts.push(`form=${name}`); break; }
  }
  for (const name of Object.keys(SCENE_HUES)) {
    if (new RegExp('\\b' + name + '\\b', 'i').test(s)) { parts.push(`hue=${name}`); break; }
  }
  for (const [re, mark] of MARK_WORDS) { if (re.test(s)) { parts.push(`mark=${mark}`); break; } }
  for (const [re, layer] of LAYER_WORDS) { if (re.test(s)) { parts.push(`layer=${layer}`); break; } }
  for (const [re, set] of SPEED_WORDS) {
    if (re.test(s)) { for (const [k, v] of Object.entries(set)) parts.push(`${k}=${v}`); break; }
  }

  const shaping = parts.some((p) => /^(form|card|mark|layer|energy|scale|spin)=/.test(p));
  if (!shaping) return null;
  return `[scene ${parts.join(' ')}]`;
}

/** Ring 3, stated in code as everywhere else in this organism. */
export function sceneGrantsAuthority() { return false; }
