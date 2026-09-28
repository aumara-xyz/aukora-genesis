export declare const RECORD_DOMAIN: 'aukora:aura-record:v1'

export declare const RECORD_REFUSE: Readonly<{
  [k: string]: string
}>

export declare function entryHash(prevHash: string, fields: Record<string, unknown>): string

export declare function readHead(file: string): {
  exists: boolean
  count: number
  lastChainHash: string | null
}

export interface AppendLock {
  readonly file: string
  readonly lockPath: string
  readonly fd: number
}

export declare function acquireAppendLock(
  file: string,
  options?: { attempts?: number, spinMs?: number },
): AppendLock

export declare function releaseAppendLock(
  lock: AppendLock,
): { released: true } | { released: false, reason: string }

export declare function appendEntry(params: {
  file: string
  lock?: AppendLock
  afterAppend?: (entry: {
    hash: string
    prev: string
    fields: Record<string, unknown>
  }) => void
} & ({
  fields: Record<string, unknown>
  buildFields?: never
} | {
  fields?: never
  buildFields: (head: {
    count: number
    lastChainHash: string | null
  }) => Record<string, unknown>
})): { hash: string; prev: string }

export declare function verifyChain(file: string):
  | { ok: true; count: number; lastChainHash: string | null }
  | { ok: false; reason: string; line: number }

export declare function readVerifiedChain(file: string):
  | {
      ok: true
      count: number
      lastChainHash: string | null
      entries: Array<Record<string, unknown>>
    }
  | { ok: false; reason: string; line: number }

export declare function readEntries(file: string): Array<Record<string, unknown>>

export declare function compareObjectInventory(
  stateDir: string,
  entries: Array<Record<string, unknown>>,
): { ok: true } | { ok: false; reason: string }
