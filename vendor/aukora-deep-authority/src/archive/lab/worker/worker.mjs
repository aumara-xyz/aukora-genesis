import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * WorkerClient: Untrusted worker interface using launch-hygiene process separation.
 */
export class WorkerClient {
  constructor({ brokerProcess, brokerDaemon } = {}) {
    this.brokerProcess = brokerProcess || null;
    this.brokerDaemon = brokerDaemon || null;
    this.pending = new Map();
    this.rl = null;
    if (this.brokerProcess) this._initIPC();
  }

  static async spawnBroker({ rootPublicKeyPem, rootPublicKeyHex, rootDir = '.aukora' } = {}) {
    const brokerPath = resolve(__dirname, '..', 'broker', 'broker.mjs');
    const scrubbedEnv = {
      PATH: process.env.PATH || '',
      SYSTEMROOT: process.env.SYSTEMROOT || '',
      HOME: process.env.HOME || '',
      NODE_ENV: 'production',
      AUKORA_ROOT_PUBKEY: rootPublicKeyPem || rootPublicKeyHex || '',
      AUKORA_ROOT_DIR: rootDir
    };
    const child = spawn(process.execPath, [brokerPath], { env: scrubbedEnv, stdio: ['pipe', 'pipe', 'inherit'] });
    return new WorkerClient({ brokerProcess: child });
  }

  _initIPC() {
    this.rl = readline.createInterface({ input: this.brokerProcess.stdout, terminal: false });
    this.rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          resolve(msg);
        }
      } catch {}
    });
    this.brokerProcess.on('error', (err) => {
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
    });
    this.brokerProcess.on('exit', (code) => {
      for (const { reject } of this.pending.values()) reject(new Error(`Broker process exited with code ${code}`));
      this.pending.clear();
    });
  }

  async proposeEffect(toolName, args, grant, { now, expectedDefinitionId } = {}) {
    const id = randomUUID();
    const payload = { id, toolName, args, grant, now, expectedDefinitionId };
    if (this.brokerDaemon) return this.brokerDaemon.execute(payload);
    if (!this.brokerProcess || !this.brokerProcess.stdin.writable) throw new Error('Broker IPC unavailable');

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('Broker request timed out'));
        }
      }, 5000);
      this.pending.set(id, {
        resolve: (msg) => { clearTimeout(timer); resolve(msg); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });
      this.brokerProcess.stdin.write(JSON.stringify(payload) + '\n');
    });
  }

  async close() {
    if (this.rl) this.rl.close();
    if (this.brokerProcess) {
      return new Promise((resolve) => {
        this.brokerProcess.on('exit', () => resolve());
        this.brokerProcess.kill('SIGTERM');
        setTimeout(() => {
          try { this.brokerProcess.kill('SIGKILL'); } catch {}
          resolve();
        }, 1000);
      });
    }
  }
}
