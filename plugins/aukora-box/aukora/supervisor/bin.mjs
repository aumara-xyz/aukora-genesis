#!/usr/bin/env node
/** Read-only command line entry point for launch-downward topology observation. */
import { readFileSync } from 'node:fs'
import {
  inspectTopology,
  TOPOLOGY_INPUT_REFUSAL_SCHEMA,
  TOPOLOGY_OBSERVATION_FAILURE_SCHEMA,
  TOPOLOGY_VERIFICATION_BLOCKERS,
  topologyCliExitCode,
  TopologyManifestError,
} from './topology.mjs'

main()

function main() {
  const manifestPath = process.argv[2]
  if (process.argv.length !== 3 || manifestPath.startsWith('-')) {
    emit(inputRefusal('topology:usage', 'argv', 'usage: node aukora/supervisor/bin.mjs <topology.json>'), 1)
    return
  }

  let manifestBytes
  try {
    manifestBytes = readFileSync(manifestPath)
  }
  catch (error) {
    emit(inputRefusal('topology:manifest-unreadable', manifestPath, error instanceof Error ? error.message : String(error)), 1)
    return
  }

  try {
    const observation = inspectTopology(manifestBytes)
    emit(observation, topologyCliExitCode(observation.status))
  }
  catch (error) {
    if (error instanceof TopologyManifestError) {
      emit(inputRefusal(error.reason, error.subject, error.message), 1)
    }
    else {
      emit(observationFailure(error instanceof Error ? error.message : String(error)), 1)
    }
  }
}

function inputRefusal(reason, subject, detail) {
  return {
    schema: TOPOLOGY_INPUT_REFUSAL_SCHEMA,
    status: 'REFUSED',
    observationClass: 'INPUT_ONLY',
    factsSource: 'none',
    configurationMatched: false,
    activationPerformed: false,
    hostMutationPerformed: false,
    separationVerified: false,
    verificationBlockers: [...TOPOLOGY_VERIFICATION_BLOCKERS],
    refusals: [{ reason, subject, detail }],
  }
}

function observationFailure(detail) {
  return {
    schema: TOPOLOGY_OBSERVATION_FAILURE_SCHEMA,
    status: 'REFUSED',
    observationClass: 'OBSERVATION_ATTEMPT',
    factsSource: 'live-os-attempted',
    configurationMatched: false,
    activationPerformed: false,
    hostMutationPerformed: false,
    separationVerified: false,
    verificationBlockers: [...TOPOLOGY_VERIFICATION_BLOCKERS],
    refusals: [{ reason: 'supervisor:observation-failed', subject: 'host', detail }],
  }
}

function emit(result, exitCode) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = exitCode
}
