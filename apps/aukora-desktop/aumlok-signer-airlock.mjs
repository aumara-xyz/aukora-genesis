import { createPublicKey, randomBytes, verify } from 'node:crypto'
import { connect } from 'node:net'
import { peerUid } from '../../plugins/aukora-owner-daemon/lib/peer-uid.mjs'
import { withinWindow } from './aumlok-signer-review.mjs'
import { airlockProtocolRequest, airlockProtocolPreimage } from '../../plugins/aukora-owner-daemon/lib/airlock-rollout.mjs'

// Config presence keeps daemon custody even when compatibility cannot be proved. Never fall back to a local seed.
export async function assertOwnerDaemonProtocol(config, library, request = requestOwnerSignature) {
  const challenge = randomBytes(32).toString('hex')
  try {
    const preimage = airlockProtocolPreimage(challenge)
    const raw = await request(config, airlockProtocolRequest(challenge), preimage, challenge, library)
    verifyOwnerResponse(config, raw, preimage, challenge, library)
  } catch (error) {
    const reason = error?.message === 'signer:request-malformed'
      ? 'airlock:protocol-incompatible' : 'airlock:protocol-unverified'
    throw Object.assign(new Error(`${reason}: ${error?.message ?? String(error)}`), { code: reason })
  }
}

function verifyOwnerResponse(config, raw, preimage, challenge, library) {
  const response = library.parseApprovalResponse(raw)
  if (response.kind !== 'signed') throw new Error(response.refusal)
  if (response.challenge !== challenge) throw new Error('airlock:challenge')
  const publicKey = createPublicKey({ key: Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(config.ownerPublicKeyHex, 'hex'),
  ]), format: 'der', type: 'spki' })
  if (!verify(null, preimage, publicKey, Buffer.from(response.signature, 'hex'))) throw new Error('airlock:signature')
}

// Use the connected descriptor, never the socket file's owner or a UID in JSON.
// The key pin authenticates the signed bytes independently of that kernel check.
export function requestOwnerSignature(config, wire, preimage, challenge, library) {
  return new Promise((resolve, reject) => {
    const socket = connect(config.socketPath)
    let received = Buffer.alloc(0)
    let done = false
    const finish = (error, value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => finish(new Error('airlock:timeout')), 5000)
    socket.once('connect', () => {
      try {
        if (peerUid(socket, config.peerHelperPath) !== config.ownerUid) throw new Error('airlock:peer-uid')
        socket.write(`${JSON.stringify(wire)}\n`)
      } catch (error) { finish(error) }
    })
    socket.on('data', chunk => {
      try {
        received = Buffer.concat([received, chunk])
        if (received.length > 4096) throw new Error('airlock:response-too-large')
        const newline = received.indexOf(10)
        if (newline < 0) return
        if (newline !== received.length - 1) throw new Error('airlock:trailing-response')
        const raw = JSON.parse(received.subarray(0, newline).toString('utf8'))
        verifyOwnerResponse(config, raw, preimage, challenge, library)
        finish(null, raw)
      } catch (error) { finish(error) }
    })
    socket.once('error', error => finish(error))
    socket.once('close', () => { if (!done) finish(new Error('airlock:closed')) })
  })
}

export function createAirlockSigner({ config, library, review, stillListed }) {
  const seen = new Set()
  const refuse = (challenge, refusal) => library.createRefusedApprovalResponse({ challenge, refusal })
  return {
    approve() { return refuse(null, 'signer:request-malformed') },
    async approveAsync(input, facts = {}) {
      let request
      try { request = library.parseApprovalRequest(input) } catch { return refuse(null, 'signer:request-malformed') }
      const no = reason => refuse(request.challenge, reason)
      if (seen.has(request.challenge)) return no('signer:challenge-already-seen')
      if (Math.floor(Date.now() / 1000) >= request.expiresAt) return no('signer:request-expired')
      seen.add(request.challenge)
      let signed = false
      try {
        if (!stillListed()) return no('aumlok:machine-signer-not-listed-by-the-record')
        const decision = await withinWindow(review({ request, operationContent: facts.operationContent }), request.expiresAt)
        if (decision?.expired || Math.floor(Date.now() / 1000) >= request.expiresAt) return no('signer:request-expired')
        if (decision?.approve !== true) return no(decision?.refusal ?? 'signer:declined')
        if (!stillListed()) return no('aumlok:machine-signer-not-listed-by-the-record')
        const response = await requestOwnerSignature(config, { kind: 'approval', request },
          library.approvalSigningBytes(request), request.challenge, library)
        if (Math.floor(Date.now() / 1000) >= request.expiresAt || !stillListed()) return no('airlock:authority-changed')
        signed = true
        return response
      } catch { return no('airlock:refused') }
      finally { if (!signed) seen.delete(request.challenge) }
    },
  }
}
