# Receipt v3 shape (toy)

Closed fields: aura, composition, issuedAt, issuerPk, kind, nonce, sig.
Composition closed: coeffectEnvelopeDigest, operation, pluginDigest,
pluginId, revertOf.

No alg. No owner/identity/did. Unknown fields refuse. Class is derived
(never a signed field). Live → unattributed / NON-CONFORMING.
Cold verify: signature + closed fields; CONSISTENCY_UNCHECKED without Phase 0.
Attendance: reported-not-proven. No human-ceremony in this toy.
