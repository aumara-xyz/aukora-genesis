// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Public-repo commit/tree secret + PII scanner gate (R39).
 *
 * Scans every tracked text file in the git tree with the CANONICAL evidence scanner (@aukora/evidence `scanForSecrets`)
 * plus a bounded PII pass, and FAILS CLOSED (exit 1) on any finding — WITHOUT ever echoing the secret/PII content.
 * It reports only the file path, the pattern id, and a line number; the matched bytes are never printed.
 *
 *   npx tsx apps/seed/scripts/scan-public-tree.ts            # scan the whole tracked tree
 *   npx tsx apps/seed/scripts/scan-public-tree.ts <paths...> # scan specific paths (e.g. the commit's changed files)
 *
 * Wire it into CI (see .github/workflows/public-scan.yml). Deterministic + offline; no network, no model, no key.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { scanForSecrets } from '@aukora/evidence';

// Bounded, HIGH-CONFIDENCE PII patterns (no content echo): emails and US SSNs. A bare long digit run is deliberately
// NOT flagged — it hits timestamps, hashes, and canonical vectors far more than real PII (too noisy to gate on).
const PII_PATTERNS: { id: string; re: RegExp }[] = [
  { id: 'pii-email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { id: 'pii-us-ssn', re: /\b\d{3}-\d{2}-\d{4}\b/ },
];

// R57A: the ONE allowed email-shaped literal — the universal git-transport service identity of the
// canonical origin's scp/ssh forms (`git@github.com:aumara-xyz/aukora`). It is a public service
// account, not personal data. The allowance is EXACT-MATCH only: any other user or host
// (deploy@…, git@evil.com, someone@gmail.com) still fails closed.
const PII_EMAIL_ALLOWED: ReadonlySet<string> = new Set(['git@github.com']);

// ADVISORY (reported, never fails the gate): `env-secret-assign` is the canonical scanner's HEURISTIC — it fires on
// ordinary `token = value` / `apiKey = value` code across the repo. Distinctive-shape secrets (AKIA*, sk-*, ghp_*,
// PEM, bearer, Google/Stripe/npm/GitLab/SendGrid/Azure/OpenRouter keys, JWTs) fail closed; this heuristic warns.
const ADVISORY_PATTERN_IDS: ReadonlySet<string> = new Set(['env-secret-assign']);

// Files whose PURPOSE is to enumerate secret SHAPES — deliberate scanner/test fixtures. They are the scanner's own
// vectors (they contain example, non-real patterns on purpose), so they are exempt from the SECRET scan to avoid
// self-poisoning the gate. Product code and any non-fixture file is NOT exempt — a real leak there fails the gate.
const SECRET_EXEMPT = /(^|\/)(test|tests|deferred-tests)\/|\.test\.[tj]s$|(^|\/)(catalogue|forbiddenContent|scan-public-tree|providerTransport)\.[tj]s$|SECURITY\.md$|README\.md$|_EVIDENCE\.md$/;
// PII heuristics additionally exempt authored/generated data: canonical conformance vectors, SBOM/lockfiles,
// provenance/CI scripts (expected hashes/timestamps), markdown docs, and the repository-identity manifest
// (R57A: its adversarial REJECT vectors enumerate userinfo-trick URL shapes on purpose — a fixture-vector
// file exactly like the conformance vectors; the exemption is name-scoped to that one root manifest).
const PII_EXEMPT = new RegExp(`${SECRET_EXEMPT.source}|(^|/)conformance/|SBOM\\.cdx\\.json$|package(-lock)?\\.json$|(^|/)scripts/[^/]+\\.mjs$|\\.md$|^repository-identity\\.json$`);
// Vendored / minified / built assets are third-party or generated — not authored source; exempt from all scans.
const VENDOR_EXEMPT = /(^|\/)(assets|vendor|dist|node_modules)\/|\.min\.(js|css)$/;
const BINARY_EXT = /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|otf|mp4|mov|wasm|node|lock)$/i;
const MAX_BYTES = 2_000_000;

interface Finding { file: string; patternId: string; line: number; advisory: boolean; }

function trackedFiles(args: string[]): string[] {
  if (args.length > 0) return args;
  const out = execFileSync('git', ['ls-files'], { encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

function scanFile(file: string): Finding[] {
  if (BINARY_EXT.test(file) || VENDOR_EXEMPT.test(file)) return [];
  try { if (statSync(file).size > MAX_BYTES) return []; } catch { return []; }
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch { return []; }

  const findings: Finding[] = [];
  // canonical secret scan — the pattern id is safe to print; the matched content is NOT (never echoed).
  if (!SECRET_EXEMPT.test(file)) {
    for (const hit of scanForSecrets(text)) {
      const patternId = (hit as { patternId?: string }).patternId ?? 'secret';
      const idx = typeof (hit as { start?: number }).start === 'number' ? (hit as { start: number }).start : 0;
      findings.push({ file, patternId, line: lineOf(text, idx), advisory: ADVISORY_PATTERN_IDS.has(patternId) });
    }
  }
  if (!PII_EXEMPT.test(file)) {
    for (const { id, re } of PII_PATTERNS) {
      // scan ALL matches so an allowed literal cannot shadow a real finding later in the file;
      // report the first non-allowed match (one finding per pattern per file, as before).
      const g = new RegExp(re.source, `${re.flags.replace('g', '')}g`);
      for (const m of text.matchAll(g)) {
        if (id === 'pii-email' && PII_EMAIL_ALLOWED.has(m[0])) continue;
        findings.push({ file, patternId: id, line: lineOf(text, m.index as number), advisory: false });
        break;
      }
    }
  }
  return findings;
}

function main(): void {
  const files = trackedFiles(process.argv.slice(2));
  const findings: Finding[] = [];
  for (const f of files) findings.push(...scanFile(f));

  const blocking = findings.filter((f) => !f.advisory);
  const advisories = findings.filter((f) => f.advisory);

  // Advisories are reported but never fail the gate (content redacted).
  for (const fnd of advisories) console.log(`  ADVISORY ${fnd.file}:${fnd.line} [${fnd.patternId}] (content not shown)`);

  if (blocking.length === 0) {
    console.log(`public-tree scan: PASS (${files.length} files; 0 blocking secret/PII findings, ${advisories.length} advisory)`);
    process.exit(0);
  }
  // FAIL CLOSED — report locations ONLY, never the matched bytes.
  console.error(`public-tree scan: FAIL — ${blocking.length} blocking finding(s) (content redacted):`);
  for (const fnd of blocking) console.error(`  ${fnd.file}:${fnd.line} [${fnd.patternId}] (content not shown)`);
  process.exit(1);
}

main();
