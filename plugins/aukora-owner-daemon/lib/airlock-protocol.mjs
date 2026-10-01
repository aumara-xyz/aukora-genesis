import { createHash, sign } from 'node:crypto'
import {
  approvalSigningBytes, parseApprovalRequest, createSignedApprovalResponse,
  createRefusedApprovalResponse,
} from '../../aukora-aumlok/lib/owner-approval.mjs'
import {
  nostrBindingPreimage, sasConfirmationPreimage, decodeNpub, NOSTR_SAFETY_VERSION, assertWitnessFields,
} from './airlock-witness.mjs'
import { airlockProtocolRequest, airlockProtocolPreimage } from './airlock-rollout.mjs'

const HEX = /^[0-9a-f]{64}$/u
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u
const fail = code => { throw Object.assign(new Error(code), { code }) }
const malformed = () => fail('signer:request-malformed')
function closed(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) malformed()
}
function text(value, max) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\r\n]/u.test(value)) malformed()
  try { assertWitnessFields(value) } catch { malformed() }
}

/** Reuse the product's signing bytes; never accept a caller-supplied preimage. */
export function airlockSigningInput(message) {
  if (message?.kind === 'approval') {
    closed(message, ['kind', 'request'])
    const request = parseApprovalRequest(message.request)
    return { bytes: approvalSigningBytes(request), challenge: request.challenge,
      issuedAt: request.issuedAt, expiresAt: request.expiresAt, operationDigest: request.operationDigest }
  }
  closed(message, ['kind', 'request', 'challenge', 'operationDigest'])
  if (typeof message.challenge !== 'string' || !HEX.test(message.challenge)
    || typeof message.operationDigest !== 'string' || !HEX.test(message.operationDigest)) malformed()
  const statement = message.request
  let bytes, instant
  if (message.kind === 'nostr-binding') {
    closed(statement, ['subject', 'npub', 'nostrPubkeyHex', 'handle', 'createdAt', 'safetyVersion'])
    if (statement.safetyVersion !== NOSTR_SAFETY_VERSION) malformed()
    text(statement.handle, 128)
    if (decodeNpub(statement.npub) !== statement.nostrPubkeyHex || !HEX.test(statement.nostrPubkeyHex)) malformed()
    bytes = nostrBindingPreimage(statement)
    instant = statement.createdAt
  } else if (message.kind === 'nostr-sas') {
    closed(statement, ['subject', 'npub', 'controllerKeyHex', 'sasDigits', 'confirmedAt', 'safetyVersion'])
    if (typeof statement.controllerKeyHex !== 'string' || !HEX.test(statement.controllerKeyHex)
      || typeof statement.sasDigits !== 'string' || !/^[0-9]{70}$/u.test(statement.sasDigits)
      || statement.safetyVersion !== NOSTR_SAFETY_VERSION || decodeNpub(statement.npub) === null) malformed()
    bytes = Buffer.from(sasConfirmationPreimage(statement), 'utf8')
    instant = statement.confirmedAt
  } else malformed()
  text(statement.subject, 256)
  if (typeof instant !== 'string' || !INSTANT.test(instant)) malformed()
  const issuedAt = Date.parse(instant) / 1000
  if (!Number.isSafeInteger(issuedAt) || new Date(issuedAt * 1000).toISOString().replace('.000Z', 'Z') !== instant) malformed()
  if (createHash('sha256').update(bytes).digest('hex') !== message.operationDigest) {
    fail('airlock:digest-mismatch')
  }
  return { bytes, challenge: message.challenge, operationDigest: message.operationDigest,
    issuedAt, expiresAt: issuedAt + 300 }
}

/** UID admission belongs to the server. It proves a process UID, never a click. */
export function createAirlockHandler(privateKey, now = () => Math.floor(Date.now() / 1000)) {
  const seen = new Map()
  return message => {
    let challenge = null
    try {
      if (message?.kind === 'protocol') {
        closed(message, ['kind', 'protocolVersion', 'safetyVersion', 'confirmationDomain', 'challenge'])
        const expected = airlockProtocolRequest(message.challenge)
        if (message.protocolVersion !== expected.protocolVersion || message.safetyVersion !== expected.safetyVersion
          || message.confirmationDomain !== expected.confirmationDomain) malformed()
        const bytes = airlockProtocolPreimage(message.challenge)
        return createSignedApprovalResponse({ challenge: message.challenge,
          signature: sign(null, bytes, privateKey).toString('hex') })
      }
      const input = airlockSigningInput(message)
      challenge = input.challenge
      const current = now()
      for (const [key, expiry] of seen) if (expiry <= current) seen.delete(key)
      if (current >= input.expiresAt) fail('signer:request-expired')
      if (input.issuedAt > current + 30 || input.expiresAt - input.issuedAt > 600) malformed()
      const replay = `${message.kind}:${challenge}`
      if (seen.has(replay)) fail('signer:challenge-already-seen')
      if (seen.size >= 4096) fail('airlock:busy')
      const signature = sign(null, input.bytes, privateKey).toString('hex')
      seen.set(replay, input.expiresAt)
      return createSignedApprovalResponse({ challenge, signature })
    } catch (error) {
      return createRefusedApprovalResponse({ challenge,
        refusal: error?.code ?? 'signer:request-malformed' })
    }
  }
}
