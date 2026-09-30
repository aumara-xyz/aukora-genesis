// SPDX-License-Identifier: AGPL-3.0-or-later
// Syntax checks only; these helpers do not authenticate keys or bindings.
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
const MAX_CONTACT_INPUT = 64 * 1024
const CONTACT_FIELDS = new Set(['type', 'version', 'npub', 'peerControllerKey', 'binding', 'label', 'live'])

export const MAX_ADD_NAME = 120
export const ADD_REFUSE = Object.freeze({
  NPUB: 'messages:add-npub-invalid',
  CONTROLLER: 'messages:add-controller-invalid',
  NAME: 'messages:add-name-invalid',
  QR: 'messages:add-qr-invalid',
  BINDING: 'messages:add-binding-invalid',
})

type Refusal = { readonly ok: false; readonly reason: string; readonly detail: string }
type Binding = Readonly<Record<string, unknown>>
export type NpubCheck = { readonly ok: true; readonly npub: string } | Refusal
export type ControllerCheck = { readonly ok: true; readonly controller: string } | Refusal
export type NameCheck = { readonly ok: true; readonly name: string } | Refusal
export type ContactDraft = {
  readonly name: string
  readonly npub: string
  readonly controller: string
  readonly binding?: Binding | null
  readonly nameEdited?: boolean
}
export type ContactInput = {
  readonly ok: true
  readonly npub: string
  readonly controller: string
  readonly binding: Binding | null
  readonly label: string
  readonly source: 'key' | 'qr'
} | Refusal
export type BodyCheck = {
  readonly ok: true
  readonly body: { readonly npub: string; readonly controller: string; readonly name: string; readonly binding?: Binding }
} | Refusal

function refuse(reason: string, detail: string): Refusal {
  return { ok: false, reason, detail }
}

function isRecord(value: unknown): value is Binding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function polymod(values: readonly number[]): number {
  let checksum = 1
  for (const value of values) {
    const top = checksum >> 25
    checksum = ((checksum & 0x1ffffff) << 5) ^ value
    for (let bit = 0; bit < 5; bit += 1) {
      if (((top >> bit) & 1) === 1) checksum ^= GENERATOR[bit] ?? 0
    }
  }
  return checksum
}

export function checkNpub(value: unknown): NpubCheck {
  const raw = typeof value === 'string' ? value.trim().replace(/^nostr:/iu, '') : ''
  if (!raw) return refuse(ADD_REFUSE.NPUB, 'no npub was given')
  const lower = raw.toLowerCase()
  if (raw !== lower && raw !== raw.toUpperCase()) {
    return refuse(ADD_REFUSE.NPUB, 'mixed case is not valid bech32')
  }
  if (lower.length !== 63 || !lower.startsWith('npub1')) {
    return refuse(ADD_REFUSE.NPUB, 'an npub must be 63 characters starting with npub1')
  }
  const values = []
  for (const character of lower.slice(5)) {
    const index = CHARSET.indexOf(character)
    if (index === -1) return refuse(ADD_REFUSE.NPUB, 'invalid bech32 character')
    values.push(index)
  }
  const hrp = [...'npub'].map(character => character.charCodeAt(0))
  if (polymod([...hrp.map(code => code >> 5), 0, ...hrp.map(code => code & 31), ...values]) !== 1) {
    return refuse(ADD_REFUSE.NPUB, 'the npub checksum does not match')
  }
  let accumulator = 0
  let bits = 0
  let bytes = 0
  for (const value of values.slice(0, -6)) {
    accumulator = ((accumulator << 5) | value) & 0xfff
    bits += 5
    while (bits >= 8) {
      bits -= 8
      bytes += 1
    }
  }
  if (bytes !== 32 || bits >= 5 || ((accumulator << (8 - bits)) & 0xff) !== 0) {
    return refuse(ADD_REFUSE.NPUB, 'an npub must encode 32 bytes with zero padding')
  }
  return { ok: true, npub: lower }
}

// A controller is a 32-byte Ed25519 public key in hex.
export function checkController(value: unknown): ControllerCheck {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return refuse(ADD_REFUSE.CONTROLLER, 'no controller key was given')
  if (!/^[0-9a-f]{64}$/iu.test(raw)) {
    return refuse(ADD_REFUSE.CONTROLLER, 'a controller key must be 64 hex characters')
  }
  return { ok: true, controller: raw.toLowerCase() }
}

export function checkName(value: unknown): NameCheck {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name) return refuse(ADD_REFUSE.NAME, 'a contact needs a name')
  if (name.length > MAX_ADD_NAME) return refuse(ADD_REFUSE.NAME, `a name may be up to ${MAX_ADD_NAME} characters`)
  return { ok: true, name }
}

export function parseContactInput(value: unknown): ContactInput {
  let payload: unknown = value
  if (typeof value === 'string') {
    if (value.length > MAX_CONTACT_INPUT || new TextEncoder().encode(value).length > MAX_CONTACT_INPUT) {
      return refuse(ADD_REFUSE.QR, 'contact input exceeds 64 KiB')
    }
    const raw = value.trim()
    if (/^(?:nostr:)?npub1/iu.test(raw) || raw === '') {
      const npub = checkNpub(raw)
      return npub.ok ? { ...npub, controller: '', binding: null, label: '', source: 'key' } : npub
    }
    try {
      payload = JSON.parse(raw) as unknown
    } catch {
      return refuse(ADD_REFUSE.QR, 'invalid contact JSON or npub')
    }
  } else if (isRecord(value)) {
    try {
      const encoded = JSON.stringify(value)
      if (encoded.length > MAX_CONTACT_INPUT || new TextEncoder().encode(encoded).length > MAX_CONTACT_INPUT) {
        return refuse(ADD_REFUSE.QR, 'contact input exceeds 64 KiB')
      }
    } catch {
      return refuse(ADD_REFUSE.QR, 'contact payload must be JSON')
    }
  }
  if (!isRecord(payload)) return refuse(ADD_REFUSE.QR, 'contact payload must be an object')
  if (payload.type !== 'aukora-contact') return refuse(ADD_REFUSE.QR, 'unsupported contact type')
  if (payload.version !== 1) return refuse(ADD_REFUSE.QR, 'unsupported contact version')
  if (Object.keys(payload).some(field => !CONTACT_FIELDS.has(field))) {
    return refuse(ADD_REFUSE.QR, 'unknown contact field')
  }
  // Freshness belongs to Identity Verify. Adding an ordinary contact remains possible after its
  // live proof expires, and this parser must never turn that optional proof into a verified mark.
  if ('live' in payload && (!isRecord(payload.live)
    || Object.keys(payload.live).length !== 4
    || !/^[0-9a-f]{64}$/u.test(String(payload.live.nonce ?? ''))
    || !Number.isSafeInteger(payload.live.issuedAt) || !Number.isSafeInteger(payload.live.expiresAt)
    || !/^[0-9a-f]{128}$/u.test(String(payload.live.signature ?? '')))) {
    return refuse(ADD_REFUSE.QR, 'invalid live contact proof')
  }
  const npub = checkNpub(payload.npub)
  if (!npub.ok) return npub
  if ('binding' in payload && payload.binding !== null && !isRecord(payload.binding)) {
    return refuse(ADD_REFUSE.BINDING, 'binding must be an object or null')
  }
  let controller = ''
  if ('peerControllerKey' in payload) {
    if (typeof payload.peerControllerKey !== 'string') return refuse(ADD_REFUSE.CONTROLLER, 'controller must be a string')
    if (payload.peerControllerKey.trim()) {
      const checked = checkController(payload.peerControllerKey)
      if (!checked.ok) return checked
      controller = checked.controller
    }
  }
  let label = ''
  if ('label' in payload) {
    if (typeof payload.label !== 'string') return refuse(ADD_REFUSE.QR, 'label must be a string')
    label = payload.label.trim()
    if (label.length > MAX_ADD_NAME) return refuse(ADD_REFUSE.NAME, `a label may be up to ${MAX_ADD_NAME} characters`)
  }
  return { ok: true, npub: npub.npub, controller, binding: (payload.binding as Binding | null | undefined) ?? null, label, source: 'qr' }
}

export function applyContactInput(draft: ContactDraft, raw: string): ContactDraft {
  const parsed = parseContactInput(raw)
  if (!parsed.ok) return { ...draft, npub: raw, controller: '', binding: null }
  return {
    ...draft,
    npub: parsed.npub,
    controller: parsed.controller,
    binding: parsed.binding,
    name: parsed.source === 'qr' && parsed.label && !draft.nameEdited ? parsed.label : draft.name,
  }
}

export function checkAddContact(draft: {
  readonly name?: unknown
  readonly npub?: unknown
  readonly controller?: unknown
  readonly binding?: unknown
}): BodyCheck {
  const name = checkName(draft?.name)
  if (!name.ok) return name
  if (draft.binding !== undefined && draft.binding !== null && !isRecord(draft.binding)) {
    return refuse(ADD_REFUSE.BINDING, 'binding must be an object or null')
  }
  const parsed = parseContactInput(draft.npub)
  if (!parsed.ok) return parsed
  const binding = parsed.source === 'qr' ? parsed.binding : draft.binding ?? null
  const candidate = parsed.controller || draft.controller
  const blank = candidate === undefined || (typeof candidate === 'string' && candidate.trim() === '')
  const controller = blank && binding === null ? { ok: true as const, controller: '' } : checkController(candidate)
  if (!controller.ok) return controller
  return {
    ok: true,
    body: { npub: parsed.npub, controller: controller.controller, name: name.name, ...(isRecord(binding) ? { binding } : {}) },
  }
}
