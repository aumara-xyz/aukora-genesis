import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkLocalPostGuard } from '../src/localPostGuard';

const ROOT = join(__dirname, '..', '..');
const allowed = ['http://127.0.0.1:7090', 'http://localhost:7090'];

function headers(values: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(values)) h.set(k, v);
  return h;
}

describe('local POST guard (#74)', () => {
  it('accepts a legitimate local browser origin', () => {
    expect(checkLocalPostGuard(headers({ origin: 'http://127.0.0.1:7090' }), { allowedOrigins: allowed })).toEqual({ ok: true });
  });

  it('rejects a hostile browser Origin before the endpoint body is trusted', () => {
    expect(checkLocalPostGuard(headers({ origin: 'https://evil.example' }), { allowedOrigins: allowed })).toEqual({
      ok: false,
      status: 403,
      reason: 'origin_not_allowed',
    });
  });

  it('rejects a hostile Referer when Origin is absent', () => {
    expect(checkLocalPostGuard(headers({ referer: 'https://evil.example/form' }), { allowedOrigins: allowed })).toEqual({
      ok: false,
      status: 403,
      reason: 'referer_not_allowed',
    });
  });

  it('allows absent browser headers for explicit local tool/curl paths when configured', () => {
    expect(checkLocalPostGuard(headers({}), { allowedOrigins: allowed, allowNoBrowserOrigin: true })).toEqual({ ok: true });
  });

  it('can fail closed when a browser-origin header is required', () => {
    expect(checkLocalPostGuard(headers({}), { allowedOrigins: allowed, allowNoBrowserOrigin: false })).toEqual({
      ok: false,
      status: 403,
      reason: 'origin_not_allowed',
    });
  });

  it('rejects missing or wrong CSRF token when token mode is enabled', () => {
    expect(checkLocalPostGuard(headers({ origin: 'http://127.0.0.1:7090' }), { allowedOrigins: allowed, requiredToken: 'abc' })).toEqual({
      ok: false,
      status: 403,
      reason: 'missing_or_bad_token',
    });
    expect(checkLocalPostGuard(headers({ origin: 'http://127.0.0.1:7090', 'x-aukora-csrf': 'wrong' }), { allowedOrigins: allowed, requiredToken: 'abc' })).toEqual({
      ok: false,
      status: 403,
      reason: 'missing_or_bad_token',
    });
  });

  it('accepts the local UI request when token mode is enabled and the token matches', () => {
    expect(checkLocalPostGuard(headers({ origin: 'http://127.0.0.1:7090', 'x-aukora-csrf': 'abc' }), { allowedOrigins: allowed, requiredToken: 'abc' })).toEqual({ ok: true });
  });
});

describe('local POST guard integration (#74)', () => {
  it('spatial chat door uses the shared guard and admits the CSRF header in CORS preflight', () => {
    const src = readFileSync(join(ROOT, 'spatial', 'chat-serve.ts'), 'utf8');
    expect(src).toContain("from '../core/src/localPostGuard'");
    expect(src).toContain('checkLocalPostGuard(req.headers');
    expect(src).toContain('x-aukora-csrf');
  });

  it('dashboard workbench POST uses the shared guard and injects the optional token into the served page', () => {
    const serve = readFileSync(join(ROOT, 'dashboard', 'serve.ts'), 'utf8');
    const html = readFileSync(join(ROOT, 'dashboard', 'workbench.html'), 'utf8');
    expect(serve).toContain("from \"../core/src/localPostGuard\"");
    expect(serve).toContain('checkLocalPostGuard(req.headers');
    expect(serve).toContain('replace("__AUKORA_LOCAL_POST_TOKEN_JSON__", JSON.stringify(LOCAL_POST_TOKEN))');
    expect(html).toContain('x-aukora-csrf');
    expect(html).toContain('__AUKORA_LOCAL_POST_TOKEN_JSON__');
  });
});
