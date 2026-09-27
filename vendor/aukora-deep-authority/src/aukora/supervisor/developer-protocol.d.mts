export declare const DEVELOPER_LAUNCH_SCHEMA: 'aukora:developer-launch:v1'
export declare const GUEST_READY_TYPE: 'aukora:guest-ready:v2'
export declare const GUEST_EXECUTE_TYPE: 'aukora:guest-memory-put:v1'
export declare const GUEST_TURN_TYPE: 'aukora:guest-user-turn:v1'
export declare const LIVE_TURN_SCHEMA: 'aukora:live-turn:v1'
export declare const GUEST_RESULT_TYPE: 'aukora:guest-memory-put-result:v1'
export declare const SOURCE_OUTCOME_SETTLED: 'SETTLED'
export declare const SOURCE_OUTCOME_REFUSED: 'REFUSED'
export declare const SOURCE_OUTCOME_INDETERMINATE: 'INDETERMINATE'
export declare function sourceOutcomeExitCode(
  outcome: typeof SOURCE_OUTCOME_SETTLED | typeof SOURCE_OUTCOME_REFUSED | typeof SOURCE_OUTCOME_INDETERMINATE,
): 0 | 2 | 3
export declare const DEVELOPER_OBSERVATION_CLASS: 'SAME_UID_PARENT_LAUNCH / NO_CUSTODY_CLAIM'
