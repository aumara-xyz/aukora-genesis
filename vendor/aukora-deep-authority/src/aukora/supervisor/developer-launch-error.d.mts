/** Stable named refusals shared by the source launcher and issuer prompt bridge. */
export declare class DeveloperLaunchError extends Error {
  readonly reason: string
  constructor(reason: string, detail: string)
}
