export interface ConfinementField {
  class: 'unconfined' | 'state-owned' | 'peer-separated'
  euid: number
  stateUid: number | null
  stateMode: string | null
  stateDev: number | null
  stateIno: number | null
  platform: string
  sealClass: 'unconfined' | 'state-owned' | 'peer-separated'
  peerProof: { tokenPath: string; brokerReadError: string; peerEchoedAt: string } | null
}

export interface SettlementReceipt {
  requestDigest: string
  definitionId: string
  nonce: string
  sequence: number
  path: string
  bytes: number
  contentSha256: string
  inode: number
  mtimeNs: string
  confinement: ConfinementField
  signature: string
}

export declare const RECEIPT_DIRECTORY: 'receipts'
export declare const RECEIPT_DOMAIN: 'aukora:settlement-receipt:v1'
export declare const RECEIPT_REFUSE: Readonly<Record<string, string>>

export declare function receiptPath(stateDir: string, receiptSha256: string): string

export declare function writeReceipt(params: {
  stateDir: string
  receipt: SettlementReceipt | Record<string, unknown>
}): { path: string; receiptSha256: string; receipt: Record<string, unknown> }

export declare function readReceipt(params: {
  stateDir: string
  receiptSha256: string
}): Record<string, unknown>

export declare function verifyReceiptDirectory(params: {
  stateDir: string
  receiptSha256s: ReadonlySet<string>
}): { ok: boolean; count?: number; reason?: string }

export declare function verifyReceiptSignature(params: {
  receipt: SettlementReceipt | Record<string, unknown>
  brokerPublicKeyPem: string
  require?: { class: ConfinementField['class'] }
}): { ok: boolean; reason?: string }

export declare function verifyReceipt(params: {
  receipt: SettlementReceipt | Record<string, unknown>
  brokerPublicKeyPem: string
  observe: (path: string) => ({
    status: 'observed'
    bytes: number
    contentSha256: string
    inode: number
    mtimeNs: string
  } | { status: 'absent' } | { status: 'unobservable' })
  require?: { class: ConfinementField['class'] }
}): { ok: boolean; reason?: string }
