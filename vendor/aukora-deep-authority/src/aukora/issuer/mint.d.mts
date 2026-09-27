import type { KeyObject } from 'node:crypto'

export interface MintedGrant {
  grant: Record<string, unknown>
  operation: Record<string, unknown>
  operationDigestValue: string
}

export declare function mintGrant(params: {
  rootPrivateKey: KeyObject
  args: { key: string; value: unknown }
  exp: number
  receiptKeyId: string
}): MintedGrant

export declare function issueRequest(args: { key: string; value: unknown }, expiry: number): {
  op: string
  toolName: string
  arguments: { key: string; value: unknown }
  expiry: number
}
