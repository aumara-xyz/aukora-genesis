/**
 * OpenShell backend sketch for the 2026-09-29 Mac spike fixes.
 *
 * Data only. launch() always throws. The fixes are notes for a later metal
 * run; this module does not write gateway config, choose a TLS directory,
 * or start a container.
 *
 * @module @aukora/containment/backends/openshell-sketch
 */
import { REFUSAL } from '../lib/placement.mjs'

export const MEASURED_UPSTREAM = Object.freeze({
  remeasuredHere: false,
  cli: '0.1.2',
  gateway: '0.1.2',
  driver: 'docker',
  defaultImage: 'nvcr.io/nvidia/base/ubuntu:24.04',
  defaultUser: 'ubuntu',
  defaultUid: 1000,
})

/** Spike fixes A–D, encoded so a later profile can refuse a known-bad shape. */
export const MAC_SPIKE_FIXES = Object.freeze({
  A: Object.freeze({
    name: 'docker-desktop-callback',
    grpcEndpoint: 'https://host.docker.internal:17670',
    avoids: 'https://127.0.0.1:17670',
  }),
  B: Object.freeze({
    name: 'workload-user',
    refuseRoot: true,
    assumeSandboxUser: false,
  }),
  C: Object.freeze({
    name: 'tls-hygiene',
    note: 'A leftover local TLS directory can fail gateway signatures. This module sets no TLS path.',
  }),
  D: Object.freeze({
    name: 'sandbox-name-length',
    maxChars: 19,
  }),
})

/**
 * There is no launcher in this stage.
 * @returns {never}
 */
export function launch() {
  const error = new Error('containment: OpenShell launch is not wired')
  error.code = REFUSAL.notWired
  throw error
}
