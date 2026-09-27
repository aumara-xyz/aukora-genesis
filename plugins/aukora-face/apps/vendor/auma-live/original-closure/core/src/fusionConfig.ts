import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface ModelProfile {
  slug: string;
  fetchTimeoutMs: number;
  wallClockTimeoutMs: number;
  maxRetries: number;
  maxOutputTokens: number;
  supportsJsonMode?: boolean;
}

export const MODEL_PROFILES: Record<string, ModelProfile> = {
  'anthropic/claude-opus-4.8': {
    slug: 'anthropic/claude-opus-4.8',
    fetchTimeoutMs: 60_000,
    wallClockTimeoutMs: 120_000,
    maxRetries: 2,
    maxOutputTokens: 4000,
    supportsJsonMode: true,
  },
  'openai/gpt-5.5': {
    // Was MISSING → fell back to DEFAULT_PROFILE (10s timeout, 1400 tok) → 5x network_timeout in the
    // 2026-07-04 live run. gpt-5.5 is a reasoning model; give it a real timeout + output budget.
    slug: 'openai/gpt-5.5',
    fetchTimeoutMs: 90_000,
    wallClockTimeoutMs: 180_000,
    maxRetries: 3,
    maxOutputTokens: 4000,
    supportsJsonMode: true,
  },
  'z-ai/glm-5.2': {
    slug: 'z-ai/glm-5.2',
    fetchTimeoutMs: 45_000,
    wallClockTimeoutMs: 90_000,
    maxRetries: 3,
    maxOutputTokens: 4000,
    supportsJsonMode: true,
  },
  'moonshotai/kimi-k2.7-code': {
    slug: 'moonshotai/kimi-k2.7-code',
    fetchTimeoutMs: 75_000,
    wallClockTimeoutMs: 150_000,
    maxRetries: 3,
    maxOutputTokens: 4000,
    supportsJsonMode: false,
  },
  'deepseek/deepseek-v4-pro': {
    slug: 'deepseek/deepseek-v4-pro',
    fetchTimeoutMs: 45_000,
    wallClockTimeoutMs: 90_000,
    maxRetries: 3,
    maxOutputTokens: 4000,
    supportsJsonMode: true,
  },
  'qwen/qwen3.7-max': {
    slug: 'qwen/qwen3.7-max',
    fetchTimeoutMs: 45_000,
    wallClockTimeoutMs: 90_000,
    maxRetries: 3,
    maxOutputTokens: 4000,
    supportsJsonMode: true,
  },
  'mistralai/mistral-large-2512': {
    slug: 'mistralai/mistral-large-2512',
    fetchTimeoutMs: 45_000,
    wallClockTimeoutMs: 90_000,
    maxRetries: 3,
    maxOutputTokens: 4000,
    supportsJsonMode: true,
  },
  'x-ai/grok-4.3': {
    slug: 'x-ai/grok-4.3',
    fetchTimeoutMs: 45_000,
    wallClockTimeoutMs: 90_000,
    maxRetries: 3,
    maxOutputTokens: 4000,
    supportsJsonMode: true,
  },
  'openai/gpt-4o': {
    slug: 'openai/gpt-4o',
    fetchTimeoutMs: 45_000,
    wallClockTimeoutMs: 90_000,
    maxRetries: 3,
    maxOutputTokens: 4000,
    supportsJsonMode: true,
  },
  'google/gemini-3.1-pro-preview': {
    slug: 'google/gemini-3.1-pro-preview',
    fetchTimeoutMs: 45_000,
    wallClockTimeoutMs: 90_000,
    maxRetries: 3,
    maxOutputTokens: 4000,
    supportsJsonMode: true,
  },
};

export const DEFAULT_PROFILE: ModelProfile = {
  slug: 'unknown',
  fetchTimeoutMs: 45_000,
  wallClockTimeoutMs: 90_000,
  maxRetries: 3,
  maxOutputTokens: 1400,
  supportsJsonMode: false,
};

export function getModelProfile(slug: string): ModelProfile {
  return MODEL_PROFILES[slug] ?? { ...DEFAULT_PROFILE, slug };
}

export type AuditLens = 'security' | 'architecture' | 'falsifiability' | 'cohesion' | 'cost_ops';

export const AUDIT_LENS_PROMPTS: Record<AuditLens, string> = {
  security: 'Focus on: secret leakage, authority escalation, key exposure, gate bypass, injection attacks.',
  architecture: 'Focus on: separation of concerns, advisory-vs-authority boundaries, module coupling, single-responsibility.',
  falsifiability: 'Focus on: which claims are untested, which tests are vacuous, what would disprove our confidence fastest.',
  cohesion: 'Focus on: does the whole organism cohere, are there dangling wires, is the loop actually closed.',
  cost_ops: 'Focus on: operational cost, rate limits, retry budgets, key rotation, monitoring gaps.',
};

export interface SwarmInstance {
  model: string;
  lens: AuditLens;
  label: string;
}

export function buildSwarmPlan(
  models: string[],
  instancesPerModel: number,
  lenses: AuditLens[] = ['security', 'architecture', 'falsifiability', 'cohesion', 'cost_ops']
): SwarmInstance[] {
  const plan: SwarmInstance[] = [];
  for (const model of models) {
    const shortName = model.split('/').pop() || model;
    for (let i = 0; i < instancesPerModel; i++) {
      const lens = lenses[i % lenses.length];
      plan.push({ model, lens, label: `${shortName}:${lens}` });
    }
  }
  return plan;
}

export const PRIME_MODELS = [
  'openai/gpt-4o',
  'anthropic/claude-opus-4.8',
  'z-ai/glm-5.2',
  'moonshotai/kimi-k2.7-code',
  'deepseek/deepseek-v4-pro',
  'qwen/qwen3.7-max',
] as const;

/**
 * 24Z.8 — the FULL-FORCE council. Every top configured model. Runners MUST import this rather than
 * hardcoding a list (the drift that silently dropped Kimi + Opus from the expanded runs). All slugs are
 * exact and recorded here. Adapter failures / unreachable models become non_vote (see classifyVote) —
 * never RED, never silently dropped.
 */
export const FULL_FORCE_COUNCIL = [
  'openai/gpt-4o',
  'anthropic/claude-opus-4.8',
  'z-ai/glm-5.2',
  'moonshotai/kimi-k2.7-code',
  'deepseek/deepseek-v4-pro',
  'qwen/qwen3.7-max',
  'mistralai/mistral-large-2512',
  'x-ai/grok-4.3',
] as const;

/**
 * Optional council members attempted in full-force runs. NOT assumed configured — the live OpenRouter
 * adapter reports the truth; if the key can't reach them they resolve to non_vote/unavailable (we do NOT
 * hallucinate availability). Gemini sits here until a real configured slug is confirmed by a live run.
 */
export const OPTIONAL_COUNCIL = [
  'google/gemini-3.1-pro-preview',
] as const;

export const FULL_FORCE_COUNCIL_WITH_OPTIONAL = [...FULL_FORCE_COUNCIL, ...OPTIONAL_COUNCIL] as const;

const COMPROMISED_KEY_HASHES = new Set([
  'd1dd240cc944e4f6fa3c005620a55ff5fa734310a253070544b345b1a98e0237',
]);

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// Round 4 (issue #24): the model that drives the native tool-calling agent
// (nativeToolCallingEngine.ts) used to be a hardcoded constant there, unreachable via opts from the
// real workbench call site. Moved here so it's resolved the same way every other Fusion-adjacent
// config value is, with a real env override. moonshotai/kimi-k2.7-code is the default on real
// evidence (issue #22): the previous default (z-ai/glm-5.2) reliably hallucinated that read_file's
// output was truncated even when it wasn't and never once reached propose_patch across 3 real
// attempts; this one completed the same task correctly on its first real run.
const DEFAULT_AGENT_MODEL = 'moonshotai/kimi-k2.7-code';

export function resolveAgentModel(): string {
  return process.env.AUKORA_AGENT_MODEL || DEFAULT_AGENT_MODEL;
}

// Issue #34/Round 6 — council roster configuration. Checked before building this: FUSION_ENV_FILE (an
// API-key FILE PATH) and FUSION_TARGET (dashboard/fu's own review-TARGET PATH, an entirely separate,
// out-of-scope tool) both already exist, but neither selects WHICH models sit on the Fusion Council;
// AUKORA_AGENT_MODEL selects the native agent's single model, a different concern. AUKORA_FUSION_MODELS is a
// comma-separated slug list, filtered against the KNOWN selectable roster (defaultCouncil + optional members
// such as Fable, #34). Two rosters are distinguished on purpose: `defaultRoster` runs when there is no env
// override (default behavior unchanged); `knownRoster` is the wider set the env may SELECT from.
//
// #34 spend-footgun fix: the previous version returned the FULL default council on an all-unknown env value
// (a typo like AUKORA_FUSION_MODELS=claude-fabel-5 would quietly fire the WHOLE roster — the opposite of the
// lean intent). It now FAILS CLOSED: an all-unknown override returns { ok:false }, and a well-formed result
// never carries an empty council. An unknown slug mixed with a known one is still dropped (kept lean).
export type CouncilResolution<T> =
  | { ok: true; council: T[]; source: 'default' | 'env-selected' }
  | { ok: false; reason: string; requested: string[]; known: string[] };

export function resolveFusionCouncil<T extends { slug: string }>(
  defaultRoster: readonly T[],
  knownRoster: readonly T[] = defaultRoster,
): CouncilResolution<T> {
  const defaults = [...defaultRoster];
  const knownSlugs = knownRoster.map((m) => m.slug);
  const useDefault = (): CouncilResolution<T> =>
    defaults.length === 0
      ? { ok: false, reason: 'default council roster is empty', requested: [], known: knownSlugs }
      : { ok: true, council: defaults, source: 'default' };

  const raw = process.env.AUKORA_FUSION_MODELS;
  if (!raw || !raw.trim()) return useDefault(); // no override / whitespace-only → default council

  const requested = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!requested.length) return useDefault();

  const bySlug = new Map(knownRoster.map((m) => [m.slug, m]));
  const selected: T[] = [];
  const unknown: string[] = [];
  for (const slug of requested) {
    const m = bySlug.get(slug);
    if (m) selected.push(m);
    else unknown.push(slug);
  }
  // FAIL CLOSED: every requested slug was unknown. Do NOT fall back to the full default council.
  if (selected.length === 0) {
    return {
      ok: false,
      reason: `AUKORA_FUSION_MODELS listed only unknown slug(s): ${unknown.join(', ')}. Known selectable slugs: ${knownSlugs.join(', ')}`,
      requested,
      known: knownSlugs,
    };
  }
  // Mixed known + unknown: drop the unknowns, keep the lean known roster (selected is guaranteed non-empty).
  return { ok: true, council: selected, source: 'env-selected' };
}

export interface KeyResolution {
  key: string;
  source: string;
}

/** Machine-local key file written by the in-app Settings panel (contributor/dev nodes). Lives OUTSIDE the
 *  repo under the symbiote home, so it is never tracked, committed, or synced. Holds either a bare key or an
 *  `OPENROUTER_API_KEY=...` line. This is a runtime API-key convenience only — it is NOT the AUMLOK signing
 *  key and grants no authority. */
export function openrouterKeyFilePath(): string {
  const home = process.env.AUKORA_SYMBIOTE_HOME || path.join(process.env.HOME || '', '.aukora-symbiote');
  return path.join(home, 'openrouter.key');
}

function readLocalKeyFile(filePath: string): string | undefined {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (!raw) return undefined;
    if (raw.includes('=')) return readEnvFileKey(filePath); // supports OPENROUTER_API_KEY=... form
    return raw; // bare key (first line, trimmed)
  } catch { return undefined; }
}

export function resolveApiKey(envFilePath?: string): KeyResolution | null {
  const sources: Array<{ label: string; value: string | undefined }> = [
    { label: 'process.env', value: process.env.OPENROUTER_API_KEY },
  ];

  // Settings-panel key (machine-local, outside the repo) — the normal path for a contributor node.
  const localKeyFile = openrouterKeyFilePath();
  if (fs.existsSync(localKeyFile)) {
    sources.push({ label: 'Settings (local key file)', value: readLocalKeyFile(localKeyFile) });
  }

  const edgeNodeEnv = path.resolve(__dirname, '..', '.env');
  if (fs.existsSync(edgeNodeEnv)) {
    sources.push({ label: edgeNodeEnv, value: readEnvFileKey(edgeNodeEnv) });
  }

  if (envFilePath && fs.existsSync(envFilePath)) {
    sources.push({ label: envFilePath, value: readEnvFileKey(envFilePath) });
  }

  const fusionEnvFile = process.env.FUSION_ENV_FILE;
  if (fusionEnvFile && fusionEnvFile !== envFilePath && fs.existsSync(fusionEnvFile)) {
    sources.push({ label: fusionEnvFile, value: readEnvFileKey(fusionEnvFile) });
  }

  // 88f — the IDE's OWN OpenRouter key (opencode auth store). Fusion uses the SAME key the runtime already runs on,
  // so there is never a "no key" surprise just because it isn't duplicated into edge-node/.env.
  const opencodeAuth = path.join(process.env.HOME || '', '.local', 'share', 'opencode', 'auth.json');
  if (fs.existsSync(opencodeAuth)) {
    try {
      const j = JSON.parse(fs.readFileSync(opencodeAuth, 'utf-8'));
      const k = j?.openrouter?.key ?? j?.openrouter?.apiKey ?? j?.openrouter?.api_key;
      if (typeof k === 'string' && k.length >= 8) sources.push({ label: opencodeAuth, value: k });
    } catch { /* malformed auth.json — skip */ }
  }

  for (const src of sources) {
    if (!src.value || src.value.length < 8) continue;
    if (COMPROMISED_KEY_HASHES.has(hashValue(src.value))) continue;
    return { key: src.value, source: src.label };
  }

  return null;
}

function readEnvFileKey(filePath: string): string | undefined {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const eqIdx = trimmed.indexOf('=');
      const key = trimmed.substring(0, eqIdx).trim();
      if (key === 'OPENROUTER_API_KEY') {
        let val = trimmed.substring(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        return val || undefined;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export interface AdvisoryResult {
  model: string;
  lens?: AuditLens;
  label: string;
  durationMs: number;
  adapterFailure: boolean;
  failureReason?: string;
  provider_contacted?: boolean;  // governance: a non-vote with provider_contacted=true was a real API call that failed/empty (not a skip)
  verdict: 'GREEN' | 'YELLOW' | 'RED';
  findings: string;
  risks: string;
  missing_tests: string;
  recommended_next_commit: string;
  confidence: number;
}

export interface SwarmSynthesis {
  completed_count: number;
  failure_count: number;
  green_count: number;
  yellow_count: number;
  red_count: number;
  disagreement_score: number;
  consensus: 'GREEN' | 'YELLOW' | 'RED' | 'NO_QUORUM';
  failures: Array<{ model: string; label: string; findings: string }>;
}

export function synthesizeSwarmResults(results: AdvisoryResult[]): SwarmSynthesis {
  // 24Z.2.1: classify via classifyVote so an adapter-failure-with-verdict:'RED' is a non-vote, never RED.
  const failures = results.filter(r => r.adapterFailure);
  const green = results.filter(r => classifyVote(r) === 'GREEN').length;
  const yellow = results.filter(r => classifyVote(r) === 'YELLOW').length;
  const red = results.filter(r => classifyVote(r) === 'RED').length;
  const completedCount = green + yellow + red;

  let disagreement = 0;
  if (completedCount > 1) {
    const distinctVerdicts = new Set(
      results.filter(r => classifyVote(r) !== 'non_vote').map(r => classifyVote(r)),
    ).size;
    disagreement = (distinctVerdicts - 1) / 2;
  }

  let consensus: SwarmSynthesis['consensus'] = 'NO_QUORUM';
  if (completedCount > 0) {
    if (red > 0) consensus = 'RED';
    else if (yellow > 0) consensus = 'YELLOW';
    else consensus = 'GREEN';
  }

  return {
    completed_count: completedCount,
    failure_count: failures.length,
    green_count: green,
    yellow_count: yellow,
    red_count: red,
    disagreement_score: disagreement,
    consensus,
    failures: failures.map(f => ({ model: f.model, label: f.label, findings: f.findings })),
  };
}

// ── Quorum evaluation ──

export type QuorumStatus = 'GREEN_QUORUM' | 'YELLOW_QUORUM' | 'NO_QUORUM' | 'RED_QUORUM';

/** A single council member's effective vote. (24Z.2.1) */
export type FusionVote = 'GREEN' | 'YELLOW' | 'RED' | 'non_vote';

/**
 * Classify a result into an effective vote. CRITICAL (24Z.2.1): an adapter failure / schema mismatch /
 * timeout is a `non_vote` REGARDLESS of any `verdict` string the adapter carried — a non-responding model
 * must NEVER be counted as RED (the runner-level "adapter-failure-as-RED" bug). An unrecognized verdict on
 * a non-failed result also collapses to a non_vote (fail safe, not fail loud-RED).
 */
export function classifyVote(r: AdvisoryResult): FusionVote {
  if (r.adapterFailure) return 'non_vote';
  if (r.verdict === 'GREEN' || r.verdict === 'YELLOW' || r.verdict === 'RED') return r.verdict;
  return 'non_vote';
}

export interface QuorumEvaluation {
  status: QuorumStatus;
  completedCount: number;
  failureCount: number;
  totalCount: number;
  adapterFailuresArePoisoning: false;
  reason: string;
  // 24Z.2.1 explicit vote breakdown — adapter failures are non-votes, never RED.
  completedVotes: number;
  nonVotes: number;
  redVotes: number;
  greenVotes: number;
  yellowVotes: number;
}

export function evaluateFusionQuorum(results: AdvisoryResult[]): QuorumEvaluation {
  const votes = results.map(classifyVote);
  const redVotes = votes.filter(v => v === 'RED').length;
  const greenVotes = votes.filter(v => v === 'GREEN').length;
  const yellowVotes = votes.filter(v => v === 'YELLOW').length;
  const nonVotes = votes.filter(v => v === 'non_vote').length;
  const completedVotes = redVotes + greenVotes + yellowVotes; // real, responding votes only
  const total = results.length;

  const base = {
    completedCount: completedVotes,
    failureCount: nonVotes,
    totalCount: total,
    adapterFailuresArePoisoning: false as const,
    completedVotes,
    nonVotes,
    redVotes,
    greenVotes,
    yellowVotes,
  };

  // A real RED from a COMPLETED model triggers RED_QUORUM. A non-vote never can.
  if (redVotes > 0) {
    return { ...base, status: 'RED_QUORUM', reason: `${redVotes} completed model(s) returned RED (${nonVotes} non-votes excluded)` };
  }
  if (completedVotes >= 3) {
    return { ...base, status: 'GREEN_QUORUM', reason: `${completedVotes}/${total} completed — strong quorum (${nonVotes} non-votes)` };
  }
  if (completedVotes >= 2) {
    return { ...base, status: 'YELLOW_QUORUM', reason: `${completedVotes}/${total} completed — minimum quorum (${nonVotes} non-votes)` };
  }
  // 0–1 real votes (incl. ALL adapters failed) → NO_QUORUM, never RED_QUORUM.
  return { ...base, status: 'NO_QUORUM', reason: `Only ${completedVotes}/${total} completed — below minimum quorum of 2 (${nonVotes} non-votes)` };
}

// ── Governance report (Peter's standing rule: every round reports the council, the verdicts, the non-votes
//    with a typed reason + provider_contacted, and what changed because of Fusion) ──

export interface FusionNonVote { model: string; reason: string; provider_contacted: boolean }
export interface FusionGovernanceReport {
  councilModels: string[];                 // exact model list contacted
  verdicts: { green: number; yellow: number; red: number; nonVotes: number };
  quorum: string;                          // GREEN_QUORUM | YELLOW_QUORUM | RED_QUORUM | NO_QUORUM
  nonVotes: FusionNonVote[];               // each non-vote: typed reason + whether the provider was actually contacted
  changedBecauseOfFusion: string;          // human-supplied: what the build changed in response (or "nothing — advisory only")
}

/** Build the four-part Fusion governance report from a council run. `changed` is the builder's honest note of
 *  what was altered because of Fusion (folded hardening, etc.) — defaults to the advisory-only disclaimer. */
export function buildFusionGovernanceReport(
  councilModels: string[],
  results: AdvisoryResult[],
  quorum: QuorumEvaluation,
  changed?: string,
): FusionGovernanceReport {
  const nonVotes: FusionNonVote[] = results
    .filter(r => classifyVote(r) === 'non_vote')
    .map(r => ({ model: r.model, reason: r.failureReason ?? 'unknown', provider_contacted: r.provider_contacted ?? false }));
  return {
    councilModels: [...councilModels],
    verdicts: { green: quorum.greenVotes, yellow: quorum.yellowVotes, red: quorum.redVotes, nonVotes: quorum.nonVotes },
    quorum: quorum.status,
    nonVotes,
    changedBecauseOfFusion: changed ?? 'nothing — advisory only (no finding required a code change)',
  };
}

/** Render the governance report as printable lines for a runner / evidence doc. */
export function formatFusionGovernanceReport(r: FusionGovernanceReport): string[] {
  return [
    `council (${r.councilModels.length}): ${r.councilModels.join(', ')}`,
    `verdict: ${r.quorum} — green=${r.verdicts.green} yellow=${r.verdicts.yellow} red=${r.verdicts.red} nonVotes=${r.verdicts.nonVotes}`,
    r.nonVotes.length
      ? `non-votes: ${r.nonVotes.map(n => `${n.model} (reason=${n.reason}, provider_contacted=${n.provider_contacted})`).join('; ')}`
      : 'non-votes: none',
    `changed because of Fusion: ${r.changedBecauseOfFusion}`,
  ];
}

// ── Retry pack builder ──

export interface FusionRetryPack {
  failedModels: string[];
  compactPack: string;
  originalPackLength: number;
  retryPackLength: number;
}

export function buildFusionRetryPack(
  results: AdvisoryResult[],
  hardLaw: string,
  filesChanged: string[],
  testCount: number,
  coreQuestion: string,
): FusionRetryPack {
  const failed = results.filter(r => r.adapterFailure);

  const compactLines = [
    '--- COMPACT RETRY PACK ---',
    '',
    '## Hard Law',
    hardLaw,
    '',
    '## Files Changed',
    ...filesChanged.map(f => `- ${f}`),
    '',
    `## Tests: ${testCount} green`,
    '',
    '## Core Question',
    coreQuestion,
    '',
    'Answer with ONE LINE: GREEN/YELLOW/RED + reason.',
  ];

  const compactPack = compactLines.join('\n');

  return {
    failedModels: failed.map(f => f.model),
    compactPack,
    originalPackLength: 0,
    retryPackLength: compactPack.length,
  };
}
