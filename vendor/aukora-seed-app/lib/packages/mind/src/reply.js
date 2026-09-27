import { parsePlanSteps } from './plan.js';
/** Hard cap on the carried memo — the mind's only long-term state. */
export const MEMO_MAX_CHARS = 600;
/** Click coordinates live on the 64x64 board. */
export const CLICK_MAX_COORD = 63;
// Balanced-brace scan (string-aware) from one starting '{'; returns the
// parsed object or null.
function tryParseFrom(t, start) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < t.length; i++) {
        const ch = t[i];
        if (esc) {
            esc = false;
            continue;
        }
        if (ch === '\\' && inStr) {
            esc = true;
            continue;
        }
        if (ch === '"') {
            inStr = !inStr;
            continue;
        }
        if (inStr)
            continue;
        if (ch === '{')
            depth++;
        if (ch === '}') {
            depth--;
            if (depth === 0) {
                try {
                    const parsed = JSON.parse(t.slice(start, i + 1));
                    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
                        ? parsed
                        : null;
                }
                catch {
                    return null;
                }
            }
        }
    }
    return null;
}
// Try every '{' candidate in order: leading chatter that contains braces
// (or a brace inside an earlier string) must not doom a valid reply. Prefer
// the first candidate that carries an action (this parser exists to find the
// mind's reply); fall back to the first parseable object otherwise.
function scanForObject(t) {
    let fallback = null;
    for (let start = t.indexOf('{'); start >= 0; start = t.indexOf('{', start + 1)) {
        const obj = tryParseFrom(t, start);
        if (obj) {
            if (obj['action'] != null)
                return obj;
            if (!fallback)
                fallback = obj;
        }
    }
    return fallback;
}
function extractJsonObject(text) {
    if (typeof text !== 'string')
        return null;
    const t = text.trim();
    // A fenced block is only trusted if it actually yields an object —
    // triple backticks can also appear INSIDE string values of a valid reply.
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
        const fromFence = scanForObject(fence[1].trim());
        if (fromFence)
            return fromFence;
    }
    return scanForObject(t);
}
function normalizeActionName(v) {
    if (v == null)
        return null;
    const s = String(v).trim().toUpperCase();
    if (/^ACTION[1-7]$/.test(s))
        return s;
    if (/^[1-7]$/.test(s))
        return `ACTION${s}`;
    const m = s.match(/^A(?:CTION)?\s*([1-7])$/);
    if (m)
        return `ACTION${m[1]}`;
    return null;
}
/**
 * Accept: "ACTION3" | "3" | 3 | {name:"ACTION6",x,y} | {action:6,x,y}; also
 * top-level x/y when action is the bare string/number for a click.
 */
export function normalizeAction(a, top) {
    if (a == null)
        return null;
    if (typeof a === 'object') {
        const rec = a;
        const name = normalizeActionName(rec['name'] ?? rec['action'] ?? rec['id']);
        if (!name)
            return null;
        const out = { name };
        if (rec['x'] != null)
            out.x = Number(rec['x']);
        if (rec['y'] != null)
            out.y = Number(rec['y']);
        return out;
    }
    const name = normalizeActionName(a);
    if (!name)
        return null;
    const out = { name };
    const t = top !== null && typeof top === 'object' ? top : null;
    if (t && t['x'] != null)
        out.x = Number(t['x']);
    if (t && t['y'] != null)
        out.y = Number(t['y']);
    return out;
}
function clickIsLegal(a) {
    return Number.isInteger(a.x) && Number.isInteger(a.y)
        && a.x >= 0 && a.x <= CLICK_MAX_COORD
        && a.y >= 0 && a.y <= CLICK_MAX_COORD;
}
/** Plan steps take the same tolerant action forms; illegal clicks drop the step. */
function normalizePlanAction(candidate, step) {
    const a = normalizeAction(candidate, step);
    if (!a)
        return null;
    if (a.name === 'ACTION6' && !clickIsLegal(a))
        return null;
    return a;
}
/** Parse one mind reply: tolerant extraction, strict single legal action, bounded memo and plan. */
export function parseMindReply(text) {
    const obj = extractJsonObject(text);
    if (!obj)
        return { ok: false, error: 'no parseable JSON object in reply' };
    const action = normalizeAction(obj['action'], obj);
    if (!action)
        return { ok: false, error: `missing or malformed "action" (got ${JSON.stringify(obj['action'])})` };
    if (action.name === 'ACTION6' && !clickIsLegal(action)) {
        return { ok: false, error: `ACTION6 needs integer x,y in 0..${CLICK_MAX_COORD}` };
    }
    // optional plan: up to 8 verified-execution steps
    const plan = parsePlanSteps(obj['plan'], normalizePlanAction);
    return {
        ok: true,
        action,
        plan,
        whatISee: typeof obj['whatISee'] === 'string' ? obj['whatISee'] : '',
        delta: typeof obj['delta'] === 'string' ? obj['delta'] : '',
        hypothesis: typeof obj['hypothesis'] === 'string' ? obj['hypothesis'] : '',
        reason: typeof obj['reason'] === 'string' ? obj['reason'] : '',
        prediction: typeof obj['prediction'] === 'string' ? obj['prediction'] : '',
        memo: typeof obj['memo'] === 'string' ? obj['memo'].slice(0, MEMO_MAX_CHARS) : '',
    };
}
/** A parsed action is only legal if the environment offers it this turn. */
export function validateAction(action, availableActions) {
    const n = Number(action.name.slice(6));
    const avail = (availableActions ?? []).map(Number);
    if (!avail.includes(n)) {
        return { ok: false, error: `ACTION${n} is not available this turn (available: ${avail.join(', ') || 'none'})` };
    }
    return { ok: true };
}
