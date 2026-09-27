// core/aura/memoryKey.ts — ONE LINE, ported deliberately alone.
//
// `auraEvidenceReader` and `auraEvidenceKeyRecord` both need `MEM_KEY_RE` and
// nothing else from `core/src/memoryAppend.ts` (12,590 bytes at symbiote
// 9a950afc). Porting that whole module to obtain one regular expression would
// drag an append-only memory API into a lane that renders a figure.
//
// Subtractive transplant: the line, its meaning, and a row in PROVENANCE.md
// naming where it came from.
//
// Donor: aumara-xyz/aukora-symbiote @ 9a950afc, core/src/memoryAppend.ts:38 — VERBATIM.
export const MEM_KEY_RE = /^[a-z0-9._-]{1,64}$/;
