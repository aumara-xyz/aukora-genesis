import { resolveApiKey, getModelProfile } from './fusionConfig';

export type FailureReason =
  | 'missing_key'
  | 'rate_cap'
  | 'bad_endpoint'
  | 'network_timeout'
  | 'wall_clock_timeout'
  | 'http_4xx'
  | 'http_5xx'
  | 'rate_limited'      // 24Z.11.1: 429 from provider
  | 'empty_response'    // 24Z.11.1: provider responded but content was empty
  | 'invalid_json'      // no JSON object could be extracted even after fence/prose repair
  | 'schema_mismatch'   // JSON extracted but no valid verdict
  | 'adapter_failure';

export interface AdvisoryReview {
  verdict: 'GREEN' | 'YELLOW' | 'RED';
  findings: string;
  risks: string;
  missing_tests: string;
  recommended_next_commit: string;
  confidence: number;
  failureReason?: FailureReason;
  provider_contacted?: boolean;
}

export const FAIL_CLOSED_REVIEW: AdvisoryReview = {
  verdict: 'RED',
  findings: 'External review failed or rejected.',
  risks: 'Review adapter failure/closed state.',
  missing_tests: 'N/A',
  recommended_next_commit: 'none',
  confidence: 0,
  provider_contacted: false
};

// ── 24Z.11.1: robust response repair (the real cause of Opus/GLM/Kimi non-votes) ──
// Models that "responded" but non-voted were returning valid content the strict parser rejected:
// markdown-fenced JSON (```json … ```), prose around the object, or one missing/odd-typed field. These
// helpers extract + coerce so a genuine answer is counted, while a true non-answer still fails typed.

/** Extract a JSON object from model content: strip ```fences```, then take the first balanced {...}. */
export function extractReviewJson(content: unknown): Record<string, unknown> | null {
  if (typeof content !== 'string' || content.trim() === '') return null;
  // strip markdown code fences (```json ... ``` or ``` ... ```)
  let s = content.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  // direct parse first
  try { const d = JSON.parse(s); if (d && typeof d === 'object') return d as Record<string, unknown>; } catch { /* fall through */ }
  // else find the first balanced {...} block (tolerates leading/trailing prose)
  const start = s.indexOf('{');
  if (start === -1) return null;
  // STRING-AWARE brace matching: a '{' or '}' INSIDE a JSON string value (and escaped quotes) must NOT shift
  // depth — otherwise a model's "findings":"use { or }" or /\{.*\}/ turns a real verdict into a FALSE
  // non_vote (the Fusion Council flagged exactly this brace-counting bug in a live self-review).
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { const d = JSON.parse(s.slice(start, i + 1)); return d && typeof d === 'object' ? d as Record<string, unknown> : null; } catch { return null; }
      }
    }
  }
  return null;
}

/** Coerce an extracted object to an AdvisoryReview. Verdict is REQUIRED; other fields are defaulted/coerced
 *  (a missing `missing_tests` or a string confidence must not throw away a real verdict). Null if no verdict. */
export function coerceReview(parsed: Record<string, unknown> | null): AdvisoryReview | null {
  if (!parsed) return null;
  const v = typeof parsed.verdict === 'string' ? parsed.verdict.toUpperCase().trim() : '';
  if (v !== 'GREEN' && v !== 'YELLOW' && v !== 'RED') return null; // no real verdict → schema_mismatch
  const str = (x: unknown, d = ''): string => (typeof x === 'string' ? x : x == null ? d : String(x));
  const num = (x: unknown): number => {
    if (typeof x === 'number' && Number.isFinite(x)) return x;
    const n = typeof x === 'string' ? parseFloat(x) : NaN;
    return Number.isFinite(n) ? n : 5;
  };
  return {
    verdict: v as 'GREEN' | 'YELLOW' | 'RED',
    findings: str(parsed.findings),
    risks: str(parsed.risks),
    missing_tests: str(parsed.missing_tests, 'N/A'),
    recommended_next_commit: str(parsed.recommended_next_commit, 'none'),
    confidence: num(parsed.confidence),
  };
}

// --- Endpoint allowlist ---
// Only these HTTPS endpoints may receive real API keys.
// Test-mode injection uses a separate flag, not the allowlist.
export const ALLOWED_ENDPOINTS = [
  'https://openrouter.ai/api/v1/chat/completions'
];

// --- Cost / rate controls ---
// These caps abort before fetch when exceeded.
export const DEFAULT_CALLS_PER_RUN = 10;
export const HARD_MAX_CALLS_PER_RUN = 50;
export const MAX_PROMPT_BYTES = 100 * 1024; // 100KB
export const MAX_OUTPUT_TOKENS = 4096;

/** @deprecated Use DEFAULT_CALLS_PER_RUN instead */
export const MAX_CALLS_PER_RUN = DEFAULT_CALLS_PER_RUN;

let callCountThisRun = 0;
let effectiveBudget = DEFAULT_CALLS_PER_RUN;

/** Reset the per-run call counter and budget. */
export function resetCallCount(): void {
  callCountThisRun = 0;
  effectiveBudget = DEFAULT_CALLS_PER_RUN;
}

export function setCallBudget(requested: number): { requested: number; effective: number } {
  const clamped = Math.min(Math.max(1, Math.floor(requested)), HARD_MAX_CALLS_PER_RUN);
  effectiveBudget = clamped;
  return { requested, effective: clamped };
}

export function getEffectiveCallBudget(): number {
  return effectiveBudget;
}

export function getCallCount(): number {
  return callCountThisRun;
}

/**
 * Collect all known env-based secrets so they are always scrubbed from
 * outbound payloads, even if the caller forgets to pass them.
 */
export function collectEnvSecrets(): string[] {
  const keys = [
    'OPENROUTER_API_KEY',
    'AUKORA_EDGE_NODE_SEED',
    'NEBIUS_AI_CLOUD_AUTH_TOKEN',
    'NEBIUS_API_KEY',
    'NEBIUS_AI_CLOUD_ENDPOINT_URL'
  ];
  const out: string[] = [];
  for (const k of keys) {
    const v = process.env[k];
    if (v && v.length > 3) out.push(v);
  }
  return out;
}

export function scrubSecrets(input: string, secrets: string[] = []): string {
  let output = input;

  // 1. Scrub explicit secrets list (includes auto-collected env secrets)
  for (const secret of secrets) {
    if (secret && secret.length > 3) {
      output = output.split(secret).join('[REDACTED_SECRET]');
    }
  }

  // 2. Regex rules for common secret formats
  // OpenRouter key sk-or-...
  output = output.replace(/sk-or-[a-zA-Z0-9_\-]{16,}/g, '[REDACTED_OPENROUTER_KEY]');

  // Labeled patterns first (before generic hex catches the values)

  // Merkle roots (common label patterns)
  output = output.replace(/merkleRoot["']?\s*[:=]\s*["']?[a-fA-F0-9]{32,}["']?/gi, 'merkleRoot:[REDACTED_MERKLE_ROOT]');

  // Signed heads
  output = output.replace(/signedHead["']?\s*[:=]\s*["'][^"']{16,}["']/gi, 'signedHead:[REDACTED_SIGNED_HEAD]');

  // Generic hex patterns (after labeled patterns have had first pass)

  // Post-quantum signatures or long hex signature structures (>96 hex characters)
  output = output.replace(/\b[a-fA-F0-9]{96,}\b/g, '[REDACTED_PQ_SIGNATURE]');

  // Hex keys / Private Seeds (64 hex characters)
  output = output.replace(/\b[a-fA-F0-9]{64}\b/g, '[REDACTED_HEX_KEY_OR_SEED]');

  // Nonces (nonce_...) or replayed nonces
  output = output.replace(/\bnonce_[a-zA-Z0-9_\.]+/g, '[REDACTED_NONCE]');
  output = output.replace(/\breplayed_[a-zA-Z0-9_\.]+/g, '[REDACTED_NONCE]');

  // Bearer tokens in headers
  output = output.replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/ig, 'Bearer [REDACTED_TOKEN]');

  // Receipt IDs (receipt_ or rcpt_ prefixed)
  output = output.replace(/\b(?:receipt|rcpt)_[a-zA-Z0-9_\-]{8,}/gi, '[REDACTED_RECEIPT_ID]');

  // VK payload internals (vk_ prefixed identifiers)
  output = output.replace(/\bvk_[a-zA-Z0-9_\-]{8,}/gi, '[REDACTED_VK_PAYLOAD]');

  // JWT-like tokens (three base64url segments separated by dots)
  output = output.replace(/\beyJ[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}/g, '[REDACTED_JWT]');

  // PEM private key blocks
  output = output.replace(/-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g, '[REDACTED_PEM_PRIVATE_KEY]');

  // Base64-encoded secrets (40+ chars of base64 that look like encoded keys)
  output = output.replace(/\b[A-Za-z0-9+\/]{40,}={0,3}\b/g, (match) => {
    // Only redact if it looks like a real base64 secret (has mixed case + digits)
    if (/[a-z]/.test(match) && /[A-Z]/.test(match) && /[0-9]/.test(match)) {
      return '[REDACTED_BASE64_SECRET]';
    }
    return match;
  });

  // Database connection strings
  output = output.replace(/(?:mongodb|postgres|mysql|redis|amqp):\/\/[^\s"']+/gi, '[REDACTED_CONNECTION_STRING]');

  return output;
}

export async function performExternalReview(
  evidencePack: string,
  secrets: string[] = [],
  options?: {
    endpointOverride?: string;
    testMode?: boolean;
    modelSlug?: string;
  }
): Promise<AdvisoryReview> {
  const keyResult = resolveApiKey();
  if (!keyResult) {
    return { ...FAIL_CLOSED_REVIEW, failureReason: 'missing_key' };
  }
  const apiKey = keyResult.key;

  if (callCountThisRun >= effectiveBudget) {
    return {
      ...FAIL_CLOSED_REVIEW,
      failureReason: 'rate_cap',
      findings: `Rate cap exceeded: ${callCountThisRun}/${effectiveBudget} calls per run.`
    };
  }

  const modelSlug = options?.modelSlug ?? process.env.OPENROUTER_MODEL ?? 'z-ai/glm-5.2';
  const profile = getModelProfile(modelSlug);

  const testMode = options?.testMode ?? false;
  const url = (testMode && options?.endpointOverride)
    ? options.endpointOverride
    : 'https://openrouter.ai/api/v1/chat/completions';

  if (!url.startsWith('https://')) {
    return { ...FAIL_CLOSED_REVIEW, failureReason: 'bad_endpoint' };
  }

  if (!testMode && !ALLOWED_ENDPOINTS.includes(url)) {
    return {
      ...FAIL_CLOSED_REVIEW,
      failureReason: 'bad_endpoint',
      findings: `Endpoint not in allowlist: ${url}`
    };
  }

  const allSecrets = [...secrets, ...collectEnvSecrets(), apiKey];
  const scrubbedPack = scrubSecrets(evidencePack, allSecrets);
  const truncatedPack = scrubbedPack.substring(0, MAX_PROMPT_BYTES);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };
  if (process.env.OPENROUTER_SEND_ATTRIBUTION === 'true') {
    headers['HTTP-Referer'] = 'https://aukora.ai';
    headers['X-Title'] = 'Aukora Edge Node';
  }

  const requestBodyObj: any = {
    model: modelSlug,
    messages: [
      {
        role: 'system',
        content: 'You are a read-only external security reviewer. Audit the provided evidence pack. Return ONLY a raw JSON object — no markdown code fences, no prose before or after — matching exactly: { "verdict": "GREEN"|"YELLOW"|"RED", "findings": string, "risks": string, "missing_tests": string, "recommended_next_commit": string, "confidence": number }'
      },
      {
        role: 'user',
        content: truncatedPack
      }
    ],
    max_tokens: profile.maxOutputTokens,
    // Reasoning-model fix (verified live 2026-07-04 on kimi-k2.7 + deepseek-v4): these models spend most of
    // their output budget on HIDDEN reasoning (kimi used 975 reasoning tokens on a trivial prompt), so a
    // small max_tokens returns empty_response / truncated invalid_json. Capping reasoning effort low leaves
    // room for the JSON verdict AND cuts latency (fewer network_timeouts). OpenRouter ignores this field for
    // models that don't support it, so it's safe across the roster. Advisory-only; changes no authority.
    reasoning: { effort: 'low' }
  };
  if (profile.supportsJsonMode) {
    requestBodyObj.response_format = { type: 'json_object' };
  }
  const requestBody = JSON.stringify(requestBodyObj);

  const startMs = Date.now();
  let retries = profile.maxRetries;
  let delay = 500;
  let lastFailureReason: FailureReason = 'network_timeout';
  let providerContacted = false;

  while (retries > 0) {
    const elapsed = Date.now() - startMs;
    if (elapsed >= profile.wallClockTimeoutMs) {
      return { ...FAIL_CLOSED_REVIEW, failureReason: 'wall_clock_timeout', provider_contacted: providerContacted };
    }

    const remainingMs = profile.wallClockTimeoutMs - elapsed;
    const fetchTimeoutMs = Math.min(profile.fetchTimeoutMs, remainingMs);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), fetchTimeoutMs);

    try {
      callCountThisRun++;
      providerContacted = true;

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: requestBody,
        signal: controller.signal
      });

      // 429 rate limit → retry with backoff, typed as rate_limited.
      if (response.status === 429) {
        lastFailureReason = 'rate_limited';
        retries--;
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2;
        }
        continue;
      }

      if (response.status >= 400 && response.status < 500) {
        return { ...FAIL_CLOSED_REVIEW, failureReason: 'http_4xx', provider_contacted: providerContacted };
      }

      if (response.status >= 500) {
        lastFailureReason = 'http_5xx';
        retries--;
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2;
        }
        continue;
      }

      if (response.ok) {
        let data: any;
        try {
          data = await response.json();
        } catch {
          if (controller.signal.aborted) {
            const reason: FailureReason = Date.now() - startMs >= profile.wallClockTimeoutMs
              ? 'wall_clock_timeout'
              : 'network_timeout';
            return { ...FAIL_CLOSED_REVIEW, failureReason: reason, provider_contacted: providerContacted };
          }
          return { ...FAIL_CLOSED_REVIEW, failureReason: 'invalid_json', provider_contacted: providerContacted };
        }

        // 24Z.11.1: the model DID respond — repair the content before judging it a non-vote.
        const content = data.choices?.[0]?.message?.content;
        if (content == null || (typeof content === 'string' && content.trim() === '')) {
          return { ...FAIL_CLOSED_REVIEW, failureReason: 'empty_response', provider_contacted: providerContacted };
        }
        const extracted = extractReviewJson(content); // strips ```fences```, tolerates prose
        if (!extracted) {
          return { ...FAIL_CLOSED_REVIEW, failureReason: 'invalid_json', provider_contacted: providerContacted };
        }
        const review = coerceReview(extracted); // verdict required; other fields defaulted/coerced
        if (review) {
          return { ...review, provider_contacted: providerContacted };
        }

        return { ...FAIL_CLOSED_REVIEW, failureReason: 'schema_mismatch', provider_contacted: providerContacted };
      }
    } catch (e) {
      if (Date.now() - startMs >= profile.wallClockTimeoutMs) {
        return { ...FAIL_CLOSED_REVIEW, failureReason: 'wall_clock_timeout', provider_contacted: providerContacted };
      }
      lastFailureReason = 'network_timeout';
    } finally {
      clearTimeout(timeoutId);
    }

    retries--;
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }

  return { ...FAIL_CLOSED_REVIEW, failureReason: lastFailureReason, provider_contacted: providerContacted };
}
