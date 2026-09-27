/** Env-backed credential source. Reads `process.env[ref]`; returns null if unset. Never logs the value. */
export const envCredentialSource = {
    get(ref) {
        const v = typeof process !== 'undefined' && process.env ? process.env[ref] : undefined;
        return typeof v === 'string' && v.length > 0 ? v : null;
    },
};
const REDACTED = '[redacted]';
/** Wrap global fetch as an HttpPost. Only used when the caller does not inject one (never in deterministic tests). */
function fetchHttpPost() {
    return async (url, headers, body, signal) => {
        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
        let json = null;
        try {
            json = await res.json();
        }
        catch {
            json = null;
        }
        return { status: res.status, json, ok: res.ok };
    };
}
/** Extract the assistant text + served model + cost from an OpenAI-compatible response, defensively. */
function parseChatResponse(json) {
    if (json === null || typeof json !== 'object')
        return { text: '' };
    const o = json;
    const choices = Array.isArray(o.choices) ? o.choices : [];
    const first = choices[0];
    const message = first && typeof first === 'object' ? first.message : undefined;
    const content = message && typeof message === 'object' ? message.content : undefined;
    const served = typeof o.model === 'string' ? o.model : undefined;
    const usage = o.usage && typeof o.usage === 'object' ? o.usage : undefined;
    const cost = usage && typeof usage.cost === 'number' ? usage.cost : undefined;
    return { text: typeof content === 'string' ? content : '', served, costUsd: cost };
}
/**
 * Build a council `Transport` over an injected HTTP layer + out-of-band credential. Total: any failure is a benign
 * non-vote-shaped response, and the bearer token appears ONLY in the Authorization header (never returned/thrown).
 */
export function makeProviderTransport(config, cred) {
    const httpPost = config.httpPost ?? fetchHttpPost();
    const outputCap = config.maxTokens ?? 700;
    return async (seat, prompt, phase, signal) => {
        const model = config.modelForSeat[seat.slug];
        if (!model)
            return { text: '', served: undefined }; // unconfigured seat → empty → non-vote
        const bearer = cred.get(config.credentialRef);
        if (!bearer)
            return { text: '', served: undefined }; // no credential → no call → non-vote (not an error)
        const headers = { 'content-type': 'application/json', authorization: `Bearer ${bearer}` };
        const body = {
            model,
            max_tokens: outputCap,
            messages: [
                { role: 'system', content: `You are ${seat.name} on the Aukora Fu council (${phase}). Reply with the tagged packet only.` },
                { role: 'user', content: prompt },
            ],
        };
        try {
            const res = await httpPost(config.endpoint, headers, body, signal);
            if (!res.ok)
                return { text: '', served: undefined, finishReason: `http_${res.status}` }; // provider error → non-vote
            const parsed = parseChatResponse(res.json);
            return { text: parsed.text, served: parsed.served, costUsd: parsed.costUsd, finishReason: 'stop' };
        }
        catch {
            return { text: '', served: undefined, finishReason: 'transport_error' }; // abort/timeout/parse → non-vote
        }
    };
}
/** A DIAGNOSTIC descriptor of a transport config that PROVES no secret is present — safe to print or receipt. */
export function redactedTransportInfo(config) {
    return { endpoint: config.endpoint, credentialRef: config.credentialRef, token: REDACTED, seats: Object.keys(config.modelForSeat).length };
}
/** HARD: the transport carries requests; it never mints authority. Constant, by construction. */
export function providerTransportGrantsAuthority() {
    return false;
}
