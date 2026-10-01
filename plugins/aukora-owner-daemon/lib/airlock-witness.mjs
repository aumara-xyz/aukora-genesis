// Existing Nostr/SAS encoding and signing bytes, moved from the desktop witness.
// Shared by the shell and daemon so a release carries one definition without importing the desktop.
export const SAS_CONFIRMATION_DOMAIN = 'aukora:nostr-sas-confirmation:v2'
export const NOSTR_SAFETY_VERSION = 2

export const SAS_CONFIRMATION_KEYS = Object.freeze([
  'subject', 'npub', 'controllerKeyHex', 'sasDigits', 'confirmedAt', 'safetyVersion',
])

export function assertWitnessFields(value, depth = 0) {
  if (depth > 32 || (typeof value === 'string' && /[\p{Cc}\u202a-\u202e\u2066-\u2069\p{Zl}\p{Zp}]/u.test(value))) {
    throw new Error('witness fields must not contain control, bidi override/isolate or line separator characters')
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, field] of Object.entries(value)) {
      assertWitnessFields(key, depth + 1)
      assertWitnessFields(field, depth + 1)
    }
  }
}

export function sasConfirmationPreimage(statement) {
  assertWitnessFields(statement)
  if (!statement || Array.isArray(statement)
    || Object.keys(statement).sort().join(',') !== [...SAS_CONFIRMATION_KEYS].sort().join(',')
    || SAS_CONFIRMATION_KEYS.filter(key => key !== 'safetyVersion').some(key => typeof statement[key] !== 'string' || !statement[key])
    || statement.safetyVersion !== NOSTR_SAFETY_VERSION || !/^[0-9]{70}$/u.test(statement.sasDigits)) {
    throw new Error('confirmation must contain current safety protocol fields')
  }
  const lines = SAS_CONFIRMATION_KEYS.map(key => `${key}=${statement[key]}`)
  // NO TRAILING NEWLINE, matching the module: `${DOMAIN}\n${lines.join('\n')}`.
  return `${SAS_CONFIRMATION_DOMAIN}\n${lines.join('\n')}`
}

export const NOSTR_BINDING_DOMAIN = 'aukora:nostr-identity-binding:v1'

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

function bech32Polymod(values) {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let checksum = 1
  for (const value of values) {
    const top = checksum >> 25
    checksum = ((checksum & 0x1ffffff) << 5) ^ value
    for (let index = 0; index < 5; index += 1) if ((top >> index) & 1) checksum ^= generators[index]
  }
  return checksum >>> 0
}

const bech32HrpExpand = hrp => [...hrp].map(c => c.charCodeAt(0) >> 5)
  .concat([0], [...hrp].map(c => c.charCodeAt(0) & 31))

export function decodeNpub(npub) {
  if (typeof npub !== 'string' || npub.length < 8 || npub.length > 128) return null
  // MIXED CASE IS INVALID BECH32, and it is checked before lowercasing so it is not silently accepted.
  if (npub !== npub.toLowerCase() && npub !== npub.toUpperCase()) return null
  const text = npub.toLowerCase()
  const separator = text.lastIndexOf('1')
  if (separator < 1 || separator + 7 > text.length) return null
  const hrp = text.slice(0, separator)
  if (hrp !== 'npub') return null
  const data = []
  for (const character of text.slice(separator + 1)) {
    const value = BECH32_CHARSET.indexOf(character)
    if (value === -1) return null
    data.push(value)
  }
  if (bech32Polymod(bech32HrpExpand(hrp).concat(data)) !== 1) return null
  // Drop the six checksum characters, then read the 5-bit groups back into bytes.
  let accumulator = 0
  let bits = 0
  const bytes = []
  for (const value of data.slice(0, -6)) {
    accumulator = (accumulator << 5) | value
    bits += 5
    while (bits >= 8) {
      bits -= 8
      bytes.push((accumulator >> bits) & 0xff)
    }
  }
  // NO PADDING IS ACCEPTED: an npub whose payload is not exactly 32 bytes is not a key.
  if (bits >= 5 || ((accumulator << (8 - bits)) & 0xff) !== 0) return null
  if (bytes.length !== 32) return null
  return Buffer.from(bytes).toString('hex')
}

export function nostrBindingPreimage(statement) {
  assertWitnessFields(statement)
  const ordered = {}
  for (const key of Object.keys(statement).sort()) ordered[key] = statement[key]
  return Buffer.from(`${NOSTR_BINDING_DOMAIN}\n${JSON.stringify(ordered)}`, 'utf8')
}
