/** Closed child environment and rejected caller inputs. */
export interface PreparedGateEnvironment {
  env: NodeJS.ProcessEnv
  rejectedNames: string[]
}

/**
 * Close environment-controlled execution inputs before a Court Gate child starts.
 * @param source Caller environment.
 * @param options Fixed child values.
 * @returns Closed child environment and rejected inputs.
 */
export declare function prepareGateEnvironment(
  source: NodeJS.ProcessEnv,
  options: { root: string, nullDevice: string },
): PreparedGateEnvironment

/**
 * Add the runner-owned memory ceiling used only by the Host artifact build.
 * @param source Sanitized Court Gate environment.
 * @returns Build-only environment.
 */
export declare function prepareGateBuildEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv
