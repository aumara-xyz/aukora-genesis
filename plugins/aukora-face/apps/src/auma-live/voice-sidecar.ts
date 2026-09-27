// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The Auma Live voice sidecar supervisor, and the sink its lines are written to.
 *
 * WHY THIS IS ITS OWN MODULE. It was the first half of `voice.ts`, which also owns a WebSocket bridge and
 * therefore imports `ws` — a package this repository does not resolve from its root. A court that cannot
 * import a module can only read its text, so the supervisor lives here, where its only imports are node
 * builtins and type-only references, and `tests/auma-live-runtime.test.mjs` runs the REAL class with a
 * fake subprocess rather than a copy of it.
 *
 * WHERE ITS LINES GO, AND WHY THAT IS A FEATURE RATHER THAN PLUMBING. `ctx.logger` writes to the harness's
 * own log. The file a person actually opens when the orb has no voice is `<state>/logs/server.log`, and the
 * launcher points that file at the DSH child's stdout (`scripts/launch-dsh.py:399`); the plugins whose
 * lines appear there — `[composition-gate]`, `[aura-association]` — write with `console.log`. So the voice
 * lines go to BOTH: prefixed onto stdout, where a person will see them, and to the plugin logger, where the
 * harness keeps its own record. Before this, "browser voice fallback active" was a sentence nothing wrote.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { AUMA_LIVE_VOICE_ROOT } from '../vendor-paths.ts'

/**
 * The two methods this module logs through.
 *
 * NARROW ON PURPOSE. A clone of `ctx.logger` would be a copy of a class instance — which loses every method
 * that lives on the prototype, and which TypeScript refuses outright — while this interface says exactly
 * what the supervisor needs and `ctx.logger` satisfies it structurally.
 */
export interface VoiceLogSink {
  info(message: unknown): void
  warn(message: unknown): void
}

/** The prefix every voice line carries into the shell's stdout, so server.log is greppable by organ. */
export const VOICE_LOG_PREFIX = '[apps] auma-live voice:'

/** Local sidecar launch settings. */
export interface VoiceSidecarConfig {
  /** Private loopback port used only between the host proxy and Python. */
  port: number
  /** Whether the host should launch the repository-owned Python sidecar when installed. */
  autoStart: boolean
  /** Installed .venv and models directory; empty uses the package's voice directory. */
  runtimeDirectory?: string
}

/** Injectable operations used by the sidecar supervisor. */
export interface VoiceSupervisorDependencies {
  /** Subprocess capability owning spawn, environment scrub, and tree-scoped termination. */
  subprocess: SubprocessRuntime
  /** Package logger receiving sidecar lifecycle lines. */
  logger: VoiceLogSink
  /** Managed-environment probe; defaults to the filesystem. */
  exists?: (path: string) => boolean
}

/** TERM-to-KILL escalation grace for the sidecar's process tree. */
const SIDECAR_GRACE_MS = 3_000

/**
 * A logger whose lines ALSO reach the process's stdout, which is what `<state>/logs/server.log` holds.
 * @param logger - the plugin logger the lines are forwarded to.
 * @param sink - the stdout writer; injectable so a court can read what was written.
 * @returns a logger shaped like the plugin logger, with `info` and `warn` writing to both sinks.
 */
export function voiceLogger(
  logger: VoiceLogSink,
  sink: (line: string) => void = line => { console.log(line) },
): VoiceLogSink {
  const emit = (write: (message: unknown) => void) => (message: unknown) => {
    sink(`${VOICE_LOG_PREFIX} ${String(message)}`)
    write(message)
  }
  return {
    info: emit(message => { logger.info(message) }),
    warn: emit(message => { logger.warn(message) }),
  }
}

/**
 * Supervises the repository-owned Python voice sidecar through the subprocess
 * capability: the seam's scrubbed parent base keeps credential-shaped
 * environment names away from the child, and termination is tree-scoped so
 * helper processes cannot outlive the harness.
 */
export class VoiceSidecarSupervisor {
  private readonly config: VoiceSidecarConfig
  private readonly dependencies: VoiceSupervisorDependencies
  private readonly exists: (path: string) => boolean
  private handle: SubprocessHandle | undefined

  /**
   * @param config - Private port and launch policy.
   * @param dependencies - Subprocess capability, logger, and environment probe.
   *
   * FIELDS ARE ASSIGNED RATHER THAN DECLARED AS CONSTRUCTOR PARAMETER PROPERTIES, so plain Node can import
   * this module with `--experimental-strip-types`: that mode erases types and cannot rewrite a parameter
   * property into a field, and a court that cannot import the class cannot run it.
   */
  constructor(config: VoiceSidecarConfig, dependencies: VoiceSupervisorDependencies) {
    this.config = config
    this.dependencies = dependencies
    this.exists = dependencies.exists ?? existsSync
  }

  /** Start the current sidecar source using the selected installed Python environment. */
  start(): void {
    if (!this.config.autoStart || this.handle !== undefined) return
    const runtimeDirectory = this.config.runtimeDirectory === undefined || this.config.runtimeDirectory === ''
      ? AUMA_LIVE_VOICE_ROOT
      : this.config.runtimeDirectory
    const executable = join(runtimeDirectory, '.venv', 'bin', 'python')
    const script = join(AUMA_LIVE_VOICE_ROOT, 'sidecar.py')
    const { logger } = this.dependencies
    if (!this.exists(executable)) {
      // THE FALLBACK IS A STATE, NOT A FAILURE, and it says which one it is: the browser's own speech
      // synthesis is doing the talking, and the local duplex setup is one command away.
      logger.info(`Auma Live browser voice fallback active; local duplex setup is available at ${join(AUMA_LIVE_VOICE_ROOT, 'setup.sh')}`)
      return
    }
    const handle = this.dependencies.subprocess.spawn({
      argv: [executable, script],
      cwd: AUMA_LIVE_VOICE_ROOT,
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: SIDECAR_GRACE_MS,
      env: voiceEnvironment(this.config.port, runtimeDirectory),
    })
    this.handle = handle
    handle.stdout?.setEncoding('utf8')
    handle.stderr?.setEncoding('utf8')
    handle.stdout?.on('data', (text: string) => { logger.info(text.trimEnd()) })
    handle.stderr?.on('data', (text: string) => { logger.warn(text.trimEnd()) })
    handle.done.then((outcome) => {
      if (this.handle === handle) this.handle = undefined
      logger.info(`Auma Live voice sidecar exited (${String(outcome.exitCode ?? outcome.signal ?? 'unknown')})`)
    }, (error: unknown) => {
      if (this.handle === handle) this.handle = undefined
      logger.warn(error)
    })
  }

  /**
   * Terminate the owned sidecar tree and wait for its exit.
   * @returns Promise settled after the tree is gone.
   */
  async stop(): Promise<void> {
    const handle = this.handle
    if (handle === undefined) return
    this.handle = undefined
    handle.terminate()
    await handle.waitForExit()
  }
}

/**
 * The sidecar's environment: explicit entries only.
 *
 * The subprocess seam merges these over its scrubbed parent base, which already withholds credential-shaped
 * names (KEY, PASSWORD, SECRET, TOKEN) and DSH-managed facts from every child, so this function never has
 * to decide what NOT to pass.
 * @param port - private loopback port.
 * @param runtimeDirectory - the installed environment and models root.
 * @returns the child's environment.
 */
export function voiceEnvironment(port: number, runtimeDirectory: string): NodeJS.ProcessEnv {
  const modelsDirectory = join(runtimeDirectory, 'models')
  const huggingFaceHome = join(modelsDirectory, 'huggingface')
  return {
    AUKORA_VOICE_PORT: String(port),
    AUKORA_VOICE_MODELS_DIR: modelsDirectory,
    HF_HOME: huggingFaceHome,
    HUGGINGFACE_HUB_CACHE: join(huggingFaceHome, 'hub'),
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
  }
}
