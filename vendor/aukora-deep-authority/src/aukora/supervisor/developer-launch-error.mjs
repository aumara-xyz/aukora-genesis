/** Stable named refusals shared by the source launcher and issuer prompt bridge. */
export class DeveloperLaunchError extends Error {
  /**
   * @param {string} reason - Stable refusal reason.
   * @param {string} detail - Human-readable detail.
   */
  constructor(reason, detail) {
    super(`${reason}: ${detail}`)
    this.name = 'DeveloperLaunchError'
    this.reason = reason
  }
}
