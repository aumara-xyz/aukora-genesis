export const FORBIDDEN_CONTENT_PATTERNS: ReadonlyArray<RegExp> = [
  /sk-or-[a-zA-Z0-9_-]{16,}/,
  /\b[a-fA-F0-9]{64}\b/,
  /\b[a-fA-F0-9]{96,}\b/,
  /\bnonce_[a-zA-Z0-9_.]+/,
  /\b(?:receipt|rcpt)_[a-zA-Z0-9_-]{8,}/i,
  /\bvk_[a-zA-Z0-9_-]{8,}/i,
  /Bearer\s+[a-zA-Z0-9_.-]+/i,
  /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/,
  /merkleRoot["']?\s*[:=]\s*["']?[a-fA-F0-9]{32,}/i,
  /signedHead["']?\s*[:=]/i,
];

export const FORBIDDEN_COMMAND_PATTERNS: ReadonlyArray<RegExp> = [
  /\bsignPoP\b/,
  /\boverrideGate\b/,
  /\bevaluateIntent\b/,
  /\bexecuteDecision\b/,
  /authority_granted\s*[:=]\s*true/i,
  /gate_changed\s*[:=]\s*true/i,
  /\bchild_process\b/,
  /\bexec\s*\(/,
  /\bspawn\s*\(/,
  /\brequire\s*\(\s*['"]child_process['"]\s*\)/,
];

export const AUTHORITY_FILE_SET: ReadonlySet<string> = new Set([
  'src/index.ts', 'src/normalizer.ts', 'src/crypto.ts', 'src/vk.ts',
  'src/trainingExport.ts', 'src/executor.ts', 'src/activeInferenceLoop.ts',
  'src/nodeIdentity.ts', 'src/pinnedPublicKey.ts', 'src/loop.ts', 'src/burn.ts',
]);

export const LEGACY_APP_MARKER = ['AUMA', 'ONE', 'APP'].join('-');
export const LEGACY_APP_MARKER_LOWER = LEGACY_APP_MARKER.toLowerCase();

export function containsForbiddenContent(text: string): boolean {
  return FORBIDDEN_CONTENT_PATTERNS.some(p => p.test(text));
}

export function containsForbiddenCommand(text: string): boolean {
  return FORBIDDEN_COMMAND_PATTERNS.some(p => p.test(text));
}

export function isLegacyAppPath(filePath: string): boolean {
  return filePath.includes(LEGACY_APP_MARKER) || filePath.includes(LEGACY_APP_MARKER_LOWER);
}

export function scrubText(text: string, maxLength = 2000): string {
  let clean = text;
  for (const p of FORBIDDEN_CONTENT_PATTERNS) {
    clean = clean.replace(new RegExp(p.source, p.flags + (p.flags.includes('g') ? '' : 'g')), '[SCRUBBED]');
  }
  for (const p of FORBIDDEN_COMMAND_PATTERNS) {
    clean = clean.replace(new RegExp(p.source, p.flags + (p.flags.includes('g') ? '' : 'g')), '[SCRUBBED]');
  }
  return clean.slice(0, maxLength);
}
