/**
 * The closed argument grammar for one compute.job operation.
 *
 * Five fields, no more: an endpoint name and four content digests. Everything a
 * job is allowed to vary is one of these; everything else is fixed by the
 * effect definition and by the executor whose bytes that definition binds.
 * This module imports nothing, so the guest can name a job without loading
 * the executor.
 * @module @aukora/broker/compute-job-args
 */

/** Operator-defined endpoint names carry no filesystem or URL syntax. */
export const ENDPOINT_NAME_SHAPE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/

/** The exact, ordered parameter list the definition record hashes. */
export const COMPUTE_JOB_FIELDS = Object.freeze(['endpoint', 'imageSha256', 'volumeSha256', 'decodeSha256', 'budgetSha256'])

const digestFields = ['imageSha256', 'volumeSha256', 'decodeSha256', 'budgetSha256']
const sha256 = /^[a-f0-9]{64}$/

/**
 * Capture exact enumerable data properties without invoking argument getters.
 * @param {unknown} input - arguments received from a caller.
 * @returns {{endpoint:string,imageSha256:string,volumeSha256:string,decodeSha256:string,budgetSha256:string}|null} validated values or null.
 */
export function captureComputeJobArgs(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  try {
    const prototype = Object.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) return null
    const descriptors = Object.getOwnPropertyDescriptors(input)
    const keys = Reflect.ownKeys(descriptors)
    if (keys.length !== COMPUTE_JOB_FIELDS.length || COMPUTE_JOB_FIELDS.some(field => !keys.includes(field))) return null
    if (COMPUTE_JOB_FIELDS.some(field => !descriptors[field].enumerable || !Object.hasOwn(descriptors[field], 'value'))) return null
    const endpoint = descriptors.endpoint.value
    if (typeof endpoint !== 'string' || !ENDPOINT_NAME_SHAPE.test(endpoint)) return null
    const captured = { endpoint }
    for (const field of digestFields) {
      const value = descriptors[field].value
      if (typeof value !== 'string' || !sha256.test(value)) return null
      captured[field] = value
    }
    return captured
  } catch {
    return null
  }
}

/**
 * Test the complete compute.job argument alphabet.
 * @param {unknown} input - arguments received from a caller.
 * @returns {input is {endpoint:string,imageSha256:string,volumeSha256:string,decodeSha256:string,budgetSha256:string}} whether all fields are accepted.
 */
export function isExactComputeJobArgs(input) {
  return captureComputeJobArgs(input) !== null
}

/**
 * The resource a compute.job grant names: one endpoint serving one image.
 * @param {{endpoint:string,imageSha256:string}} args - exact arguments.
 * @returns {string} the resource string.
 * @throws {TypeError} when any argument violates the closed grammar.
 */
export function computeJobResource(args) {
  const captured = captureComputeJobArgs(args)
  if (captured === null) throw new TypeError('compute.job:arguments-not-exact')
  return `compute:job:${captured.endpoint}:${captured.imageSha256}`
}
