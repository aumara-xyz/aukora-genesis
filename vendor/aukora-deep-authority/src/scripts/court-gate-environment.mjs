const FIXED_DISALLOWED_NAMES = Object.freeze([
  'NODE_OPTIONS', 'NODE_PATH', 'TSX_TSCONFIG_PATH', 'TS_NODE_PROJECT', 'TS_NODE_REQUIRE',
  'BASH_ENV', 'BASHOPTS', 'CDPATH', 'ENV', 'GLOBIGNORE', 'SHELLOPTS', 'ZDOTDIR',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_PARAMETERS', 'GIT_DIR',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM', 'GIT_EXEC_PATH', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_WORK_TREE',
])

const SECRET_NAME = /(?:KEY|PASSWORD|SECRET|TOKEN)/i
const BUILD_NODE_OPTIONS = '--max-old-space-size=4096'

/**
 * Close environment-controlled execution inputs before a Court Gate child starts.
 * @param {NodeJS.ProcessEnv} source Caller environment.
 * @param {{ root: string, nullDevice: string }} options Fixed child values.
 * @returns {{ env: NodeJS.ProcessEnv, rejectedNames: string[] }} Closed child environment and rejected inputs.
 */
export const prepareGateEnvironment = (source, { root, nullDevice }) => {
  const disallowedNames = new Set([
    ...FIXED_DISALLOWED_NAMES,
    ...Object.keys(source).filter(name => /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(name)),
  ])
  const rejectedNames = [...disallowedNames]
    .filter(name => source[name] !== undefined && source[name] !== '')
    .sort()
  const env = {
    ...source,
    DSH_HOME: root,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
  }
  for (const name of disallowedNames) delete env[name]
  for (const name of Object.keys(env)) {
    if (SECRET_NAME.test(name)) delete env[name]
  }
  env.GIT_CONFIG_GLOBAL = nullDevice
  env.GIT_CONFIG_NOSYSTEM = '1'
  return { env, rejectedNames }
}

/**
 * Add the runner-owned memory ceiling used only by the Host artifact build.
 * @param {NodeJS.ProcessEnv} source Sanitized Court Gate environment.
 * @returns {NodeJS.ProcessEnv} Build-only environment.
 */
export const prepareGateBuildEnvironment = (source) => {
  if (source.NODE_OPTIONS !== undefined) {
    throw new Error('Court Gate build environment must not inherit NODE_OPTIONS')
  }
  return { ...source, NODE_OPTIONS: BUILD_NODE_OPTIONS }
}
