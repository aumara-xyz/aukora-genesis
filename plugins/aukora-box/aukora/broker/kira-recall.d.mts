import type { BrokerKiraRecallResult } from '../kira/recall.mjs'
import type { KiraPrivacyClass, KiraRecordKind } from '../kira/stage.mjs'

export declare const KIRA_RECALL_MAX_INDEX_ENTRIES: number
export declare const KIRA_RECALL_MAX_AURA_BYTES: number

export declare function readBrokerKiraRecall(
  stateDir: string,
  query: {
    subject: string
    kind?: KiraRecordKind
    permittedPrivacy: ReadonlyArray<KiraPrivacyClass>
  },
): BrokerKiraRecallResult
