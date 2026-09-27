// organs/aumlok/chain.mjs — MINIMAL port for aumlok.mjs (AUMLOK-AUTHORITY-PORT-v0).
//
// Donor: aukora-phi core/witness/chain.mjs (canonicalJSON only).
// Full chain.mjs was NOT ported: it imports ./identity.mjs and ./law.mjs which are not
// local under organs/aumlok. aumlok.mjs only needs canonicalJSON for cert bodies.
// This is not a receipt chain and grants nothing.

export function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(',')}}`;
}
