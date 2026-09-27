/**
 * Pure RFC 8785 JSON Canonicalization Scheme (JCS).
 * Strict, deterministic, whitespace-free, UTF-16 lexicographically sorted.
 */
export function canonicalJSON(val) {
  if (val === null) return 'null';
  const type = typeof val;
  if (type === 'boolean') return val ? 'true' : 'false';
  if (type === 'number') {
    if (!Number.isFinite(val)) throw new TypeError('Cannot canonicalize non-finite number');
    if (Object.is(val, -0)) return '0';
    return JSON.stringify(val);
  }
  if (type === 'string') return JSON.stringify(val);
  if (type === 'bigint') throw new TypeError('BigInt not supported in RFC 8785');
  if (Array.isArray(val)) {
    const items = val.map(item => (item === undefined || typeof item === 'symbol' || typeof item === 'function' ? 'null' : canonicalJSON(item)));
    return `[${items.join(',')}]`;
  }
  if (type === 'object') {
    const keys = Object.keys(val).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const entries = [];
    for (const key of keys) {
      const v = val[key];
      if (v === undefined || typeof v === 'symbol' || typeof v === 'function') continue;
      entries.push(`${JSON.stringify(key)}:${canonicalJSON(v)}`);
    }
    return `{${entries.join(',')}}`;
  }
  return undefined;
}
