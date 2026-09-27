/** A retained statement about one verified Aura record prefix. */
export interface AuraCheckpoint {
  domain: 'aukora:aura-checkpoint:v1'
  treeSize: number
  root: string
  commitment: string
  streamNamespace: string
}

/** A checkpoint plus the RFC 6962 proof from one retained prefix. */
export interface AuraConsistencyPresentation extends AuraCheckpoint {
  proofFromPrevious: string[]
}

/** Closed checkpoint wire domain. */
export const CHECKPOINT_DOMAIN: 'aukora:aura-checkpoint:v1'

/** Export one checkpoint from a verified Aura record. */
export function checkpointFromRecord(params: {
  file: string
  streamNamespace: string
}): AuraCheckpoint

/** Export a presented checkpoint and its proof from a retained prefix. */
export function consistencyPresentationFromRecord(params: {
  file: string
  retainedSize: number
  streamNamespace: string
}): AuraConsistencyPresentation
