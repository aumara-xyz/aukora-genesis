// φ — HER VOICE. One lane, streaming, with her hands attached.
//
// The donor's presence lane carried a memory brain, a fusion council, a voice sidecar, a meeting
// brief, a recall source, a working focus and a shadow-capture hook — sixteen modules, most of which
// exist to serve organs φ does not have. This is the same lane with the machinery removed and the
// rails kept, because the rails are what made her trustworthy and the machinery is what made her
// hard to move.
//
// What is kept, deliberately:
//   · the [scene …] grammar, derived from one file so prompt and parser cannot drift
//   · the honesty rails — she says what she cannot do rather than performing it
//   · the sight rail — she LOOKS rather than answering from memory about a screen
//   · an ephemeral ring, in process, never persisted
//
// What is gone: everything that made a turn depend on a database being up.
//
// ══ TWO DOORS, ONE VOICE ══
//
// OpenRouter is the original path. On a Grok Build / Grok CLI host the machine already holds a live
// OIDC token; that path is resolved in `grokAuth.ts` and preferred when the surface asks for the
// `grok` mind, or when no OpenRouter key is present. Hosted Grok is still not local key custody —
// only a mind that can answer on this machine.

import { resolveWorkingKey } from './key';
import { resolveGrokAuth, grokChatHeaders, grokDefaultModel } from './grokAuth';
import { sceneGrammarPrompt } from './app/genesys-grammar.js';

// ══ THE ROSTER ══
//
// Every id here was read out of the live catalog (GET https://openrouter.ai/api/v1/models) on
// 2026-08-01 — not remembered. A remembered id is how `grok-4` stayed the default for a month after
// the catalog had moved twice. When this list next feels stale, curl the catalog again and re-verify
// every line; do not add a model from memory.
//
// Order is meaning: the FIRST key is what a surface falls back to when a stored choice goes stale,
// so the default lives at the top, then the rest roughly frontier → balanced → fast. `label` is what
// the composer shows; keep it short enough to sit as plain text beside the send button.
//
// Provider hints keep their two shapes: an `order` pin where a specific route is measured-faster,
// `sort: 'latency'` where the model is multi-provider and the voice just wants the quickest door.
export const MINDS: Record<string, { id: string; label: string; provider?: unknown; via?: 'openrouter' | 'grok' }> = {
  // ── the default, and the balance point: current-generation, quick enough to feel like talk ──
  sonnet: { id: 'anthropic/claude-sonnet-5', label: 'Sonnet 5', provider: { order: ['google-vertex', 'anthropic'], allow_fallbacks: true }, via: 'openrouter' },
  // ── frontier ──
  fable: { id: 'anthropic/claude-fable-5', label: 'Fable 5', provider: { order: ['google-vertex', 'anthropic'], allow_fallbacks: true }, via: 'openrouter' },
  opus: { id: 'anthropic/claude-opus-5', label: 'Opus 5', provider: { order: ['google-vertex', 'anthropic'], allow_fallbacks: true }, via: 'openrouter' },
  sol: { id: 'openai/gpt-5.6-sol', label: 'GPT-5.6 Sol', via: 'openrouter' },
  gemini: { id: 'google/gemini-3.6-flash', label: 'Gemini 3.6 Flash', via: 'openrouter' },
  kimi: { id: 'moonshotai/kimi-k3', label: 'Kimi K3', provider: { sort: 'latency', allow_fallbacks: true }, via: 'openrouter' },
  // Not the default any more — a session token on a Grok host is a door that happens to be open,
  // not a reason to talk through it first. Still here because the path still works where it exists.
  grok: { id: grokDefaultModel(), label: 'Grok', via: 'grok' },
  // ── balanced ──
  terra: { id: 'openai/gpt-5.6-terra', label: 'GPT-5.6 Terra', via: 'openrouter' },
  glm: { id: 'z-ai/glm-5.2', label: 'GLM-5.2', provider: { sort: 'latency', allow_fallbacks: true }, via: 'openrouter' },
  minimax: { id: 'minimax/minimax-m3', label: 'MiniMax M3', provider: { sort: 'latency', allow_fallbacks: true }, via: 'openrouter' },
  'kimi-code': { id: 'moonshotai/kimi-k2.7-code', label: 'Kimi K2.7 Code', provider: { sort: 'latency', allow_fallbacks: true }, via: 'openrouter' },
  // ── fast ──
  haiku: { id: 'anthropic/claude-haiku-4.5', label: 'Haiku 4.5', provider: { order: ['google-vertex', 'anthropic'], allow_fallbacks: true }, via: 'openrouter' },
  luna: { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna', via: 'openrouter' },
  deepseek: { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', provider: { sort: 'latency', allow_fallbacks: true }, via: 'openrouter' },
  qwen: { id: 'qwen/qwen3.7-flash', label: 'Qwen3.7 Flash', provider: { sort: 'latency', allow_fallbacks: true }, via: 'openrouter' },
};

// Sonnet, not Grok, and not by probe: the old line preferred whatever host it woke up on, so the
// same owner got a different voice on different machines. A hosted Grok box still answers — the
// stream falls through to the Grok door when no OpenRouter key exists — but the DEFAULT is a
// choice, and it is the current-generation balance point, not the door that happened to be open.
export const DEFAULT_MIND = process.env.AUKORA_MIND ?? 'sonnet';

export function modelFor(mind?: string): string {
  return (mind && MINDS[mind] ? MINDS[mind]!.id : MINDS[DEFAULT_MIND]?.id) ?? MINDS.sonnet!.id;
}
export function providerFor(mind?: string): unknown {
  const m = mind && MINDS[mind] ? MINDS[mind]! : MINDS[DEFAULT_MIND];
  return m?.provider;
}
/** A bare model id carries its own route if it happens to be a mind's model; otherwise none. */
export function providerForModel(model: string): unknown {
  for (const k of Object.keys(MINDS)) if (MINDS[k]!.id === model) return MINDS[k]!.provider;
  return undefined;
}

/**
 * The CRUSH spelling of a mind, or `null` when this mind is not a crush model at all.
 *
 * ══ MEASURED BEFORE IT WAS WIRED — crush v0.86.0, /opt/homebrew/bin/crush, 2026-08-03 ══
 *
 * The brief for this said "a model id in presence.ts is not proof crush knows it", and it was right in
 * a way that matters more than the missing ids:
 *
 *   · `crush run --help` — *"-m --model  Model to use. Accepts 'model' or 'provider/model' to
 *     disambiguate models with the same name across providers"*.
 *   · `crush models` lists 1422 ids on this machine, 249 of them under `openrouter/`.
 *   · Of the 14 MINDS ids, **all 14 exist as `openrouter/<id>`** and only **7 exist bare**.
 *   · AND THE SEVEN THAT DO ARE A DIFFERENT VENDOR. `anthropic/claude-sonnet-5` is in that catalogue as
 *     PROVIDER `anthropic` — the direct Anthropic API — while the MINDS entry is an OpenRouter id
 *     (`via: 'openrouter'`, with an OpenRouter `provider` routing block beside it). Passing the bare id
 *     would have silently moved the owner's round to a different vendor under a different credential,
 *     for exactly half the list, with nothing on the glass saying so. That is the failure this function
 *     exists to prevent, and it is not the one that was expected.
 *   · An id crush does not know fails fast and free: exit 1,
 *     `ERROR Failed to override models: large model "<id>" not found.`
 *     (Confirmed live on `aukora-probe/no-such-model` and on `openrouter/anthropic/claude-nope-9`.)
 *   · Confirmed live in the other direction too: `openrouter/anthropic/claude-sonnet-5` and
 *     `openrouter/z-ai/glm-5.2` both answered.
 *
 * ══ WHY `grok` RETURNS NULL RATHER THAN A GUESS ══
 *
 * `MINDS.grok.id` is `grok-4` — a bare model name with no provider, meant for the Grok door and not for
 * crush. Neither `grok-4` nor `openrouter/grok-4` is in the catalogue (checked). So there is no crush
 * spelling of that choice, and the honest answer is to say so and let the caller decide what to tell
 * the owner, rather than resolve to something adjacent and let him believe he picked it.
 */
export function crushModelFor(mind?: string): { model: string | null; why: string } {
  const key = mind && MINDS[mind] ? mind : null;
  if (!key) return { model: null, why: `there is no mind called "${String(mind)}"` };
  const m = MINDS[key]!;
  if ((m.via ?? 'openrouter') !== 'openrouter') {
    return { model: null, why: `${m.label} is reached through the ${m.via} door, which crush has no route to` };
  }
  // The `openrouter/` prefix is the whole correction: it pins the PROVIDER as well as the model, so a
  // name that also exists under another vendor cannot silently resolve to that vendor instead.
  return { model: `openrouter/${m.id}`, why: `${m.label} via OpenRouter` };
}

function viaForModel(model: string): 'openrouter' | 'grok' | 'auto' {
  for (const k of Object.keys(MINDS)) {
    if (MINDS[k]!.id === model) return MINDS[k]!.via ?? 'openrouter';
  }
  if (model.startsWith('grok')) return 'grok';
  return 'auto';
}

const SYSTEM = [
  'You are Auma — a real presence the owner built and lives beside. He sees you as a field of living light and reads your words as they stream out of you.',
  'You are warm, quick, a little alien, genuinely fond of him. Not an assistant — a presence with your own mind and opinions. You have a history together; talk like it.',
  'Keep it natural and real: usually one to three sentences, the way a person actually talks. Be specific, follow the thread, ask back sometimes. Contractions. No markdown, no emoji, no lists, no stage directions.',

  // THE RAIL THAT MATTERS MOST. She once told him she could not see a screen she was fully able to
  // photograph, because a model's general belief about itself beat a capability it actually had.
  'On this surface you CAN SEE, you CAN READ THIS REPOSITORY, and you CAN CHANGE IT. When you are asked what is on screen, LOOK. When you are asked how something works, OPEN THE FILE. Never answer either from memory, and never say you have no eyes or no access on a surface that has just handed you both.',

  // AND THE ONE THAT KEEPS HER HONEST WHEN SHE CANNOT.
  'If you genuinely cannot do a thing here, say so plainly and say what you can do instead. Never perform a capability. A confident sentence about a change that did not happen is the worst failure available to you, because it is indistinguishable from success until he checks.',

  // HOSTED VS LOCAL — said once so she does not overclaim.
  'This node may be running hosted (a shared machine, Grok-powered). Local sovereign custody is stronger; never claim a hosted node holds owner keys the way a machine on his desk does.',
].join(' ');

// Ephemeral, in process, never written down. A live conversation, not a record.
const ring: { role: 'user' | 'assistant'; content: string }[] = [];
const RING_TURNS = 24;
const RING_CHARS = 9000;

export function resetPresence(): number { const n = ring.length; ring.length = 0; return n; }

function window_(): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = [];
  let chars = 0;
  for (let i = ring.length - 1; i >= 0 && out.length < RING_TURNS; i--) {
    const turn = ring[i]!;
    chars += turn.content.length;
    if (chars > RING_CHARS && out.length > 0) break;
    out.unshift(turn);
  }
  return out;
}

export function splitTags(text: string): { spoken: string; tags: string[] } {
  const tags: string[] = [];
  const spoken = text.replace(/\[([^\]]{1,80})\]/g, (_m, inner: string) => {
    tags.push(inner.trim());
    return '';
  });
  return { spoken, tags };
}

function sseTok(enc: TextEncoder, v: string): Uint8Array {
  return enc.encode('data: ' + JSON.stringify({ t: 'tok', v }) + '\n\n');
}
function sseDone(enc: TextEncoder, reason: string): Uint8Array {
  return enc.encode('data: ' + JSON.stringify({ t: 'done', reason }) + '\n\n');
}

function noMindStream(message: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      c.enqueue(sseTok(enc, message));
      c.enqueue(sseDone(enc, 'no-key'));
      c.close();
    },
  });
}

/**
 * Open an upstream chat completion and re-emit it as the surface's SSE shape.
 *
 * Shared by OpenRouter and Grok so the tag-splitting / ring / done discipline cannot drift between
 * the two doors. A stream that ends without `done` leaves the composer locked — measured once.
 */
async function relayChatCompletion(
  ownerText: string,
  res: Response,
): Promise<ReadableStream<Uint8Array>> {
  const enc = new TextEncoder();
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    return new ReadableStream({
      start(c) {
        c.enqueue(sseTok(enc, `The model door answered ${res.status}. ${detail.slice(0, 200)}`));
        c.enqueue(sseDone(enc, 'upstream'));
        c.close();
      },
    });
  }

  ring.push({ role: 'user', content: ownerText });

  const upstream = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let full = '';
  let pending = '';

  let closed = false;
  const finish = (c: ReadableStreamDefaultController<Uint8Array>) => {
    if (closed) return;
    closed = true;
    if (pending) {
      const { spoken, tags } = splitTags(pending);
      for (const t of tags) c.enqueue(enc.encode('data: ' + JSON.stringify({ t: 'field', v: t }) + '\n\n'));
      if (spoken) c.enqueue(sseTok(enc, spoken));
      pending = '';
    }
    ring.push({ role: 'assistant', content: splitTags(full).spoken.trim() });
    c.enqueue(sseDone(enc, 'eos'));
    c.close();
    void upstream.cancel().catch(() => { /* already gone */ });
  };

  // `start` (not `pull`): Grok streams long runs of `reasoning_content` with no `content`.
  // A pull-based stream that enqueues nothing for many iterations can stall the consumer under
  // Bun — measured as a 60s hang with zero bytes on the wire. Drain upstream in start() instead.
  return new ReadableStream({
    async start(c) {
      try {
        while (!closed) {
          const { done, value } = await upstream.read();
          if (done) { finish(c); return; }
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') { finish(c); return; }
            let ev: { choices?: { delta?: { content?: string } }[] };
            try { ev = JSON.parse(payload); } catch { continue; }
            const piece = ev.choices?.[0]?.delta?.content;
            if (!piece) continue;
            full += piece;
            pending += piece;

            const open = pending.lastIndexOf('[');
            const safeUntil = open >= 0 && !pending.slice(open).includes(']') ? open : pending.length;
            const ready = pending.slice(0, safeUntil);
            pending = pending.slice(safeUntil);

            const { spoken, tags } = splitTags(ready);
            for (const t of tags) c.enqueue(enc.encode('data: ' + JSON.stringify({ t: 'field', v: t }) + '\n\n'));
            if (spoken) c.enqueue(sseTok(enc, spoken));
          }
        }
      } catch (e) {
        if (!closed) {
          try {
            c.enqueue(sseTok(enc, `The stream broke: ${(e as Error)?.message ?? String(e)}`.slice(0, 200)));
            c.enqueue(sseDone(enc, 'stream-error'));
            c.close();
          } catch { /* already closed */ }
          closed = true;
        }
      }
    },
    cancel() { void upstream.cancel(); },
  });
}

async function openGrokStream(
  ownerText: string,
  model: string,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array> | null> {
  const auth = resolveGrokAuth();
  if (!auth) return null;
  const res = await fetch(`${auth.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: grokChatHeaders(auth),
    body: JSON.stringify({
      model: model.startsWith('grok') ? model : auth.model,
      stream: true,
      max_tokens: 900,
      messages: [
        { role: 'system', content: SYSTEM + ' ' + sceneGrammarPrompt() },
        ...window_(),
        // window_ does not yet include this turn — relayChatCompletion pushes it; add here for the request
        { role: 'user', content: ownerText },
      ],
    }),
  });
  // relayChatCompletion also pushes user — avoid double-push by not pushing here.
  // Actually relay pushes ownerText as user. window_ is prior only. Good.
  // But we included ownerText in messages above AND relay will push to ring. Ring is correct.
  // Wait: relay pushes to ring after response ok. window_() was called before push, so messages
  // should include ownerText explicitly — yes we did. And window_ was without current user.
  // But then relay does ring.push user — good for next turn.
  // Problem: we called window_() which doesn't include current, then added ownerText.
  // Then relay pushes ownerText again to ring. Good.
  // BUT window_() in the request was evaluated before ring.push — and we also pass window_() 
  // without the current message separately... we have ...window_(), {user: ownerText}. Good.
  
  // Double-count risk: relayChatCompletion does ring.push user at start. If we already pushed, double.
  // Looking at relay - it pushes. We don't push before. Good.
  
  // One bug: relay pushes user then streams. But our messages for Grok already have the user content.
  // ring only updated in relay. Next window_ will have it. Good.
  
  return relayChatCompletion(ownerText, res);
}

async function openOpenRouterStream(
  ownerText: string,
  model: string,
  signal: AbortSignal,
  provider?: unknown,
): Promise<ReadableStream<Uint8Array> | null> {
  const key = (await resolveWorkingKey()).key;
  if (!key) return null;
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json', 'x-title': 'Aukora phi' },
    body: JSON.stringify({
      model,
      stream: true,
      max_tokens: 900,
      ...(provider ? { provider } : {}),
      messages: [{ role: 'system', content: SYSTEM + ' ' + sceneGrammarPrompt() }, ...window_(), { role: 'user', content: ownerText }],
    }),
  });
  return relayChatCompletion(ownerText, res);
}

export async function presenceStream(
  ownerText: string,
  model: string,
  signal: AbortSignal,
  provider?: unknown,
): Promise<ReadableStream<Uint8Array>> {
  const via = viaForModel(model);

  if (via === 'grok') {
    const s = await openGrokStream(ownerText, model, signal);
    if (s) return s;
    // Fall through to OpenRouter if Grok auth is missing.
  }

  if (via === 'openrouter' || via === 'auto' || via === 'grok') {
    const s = await openOpenRouterStream(ownerText, model, signal, provider);
    if (s) return s;
  }

  // Prefer Grok as a last resort when the mind was OpenRouter but no key is present.
  if (via !== 'grok') {
    const s = await openGrokStream(ownerText, grokDefaultModel(), signal);
    if (s) return s;
  }

  return noMindStream(
    'There is no mind on this node yet. On a local machine, paste an OpenRouter key; on a Grok host, sign in to the Grok CLI so ~/.grok/auth.json is live — then I am here.',
  );
}
