import { createHash } from 'node:crypto';
import { canonicalJSON } from '../kernel/canonical.mjs';

/**
 * ConfluenceVerifier:
 * Mathematically demonstrates Theorem 73 (Confluence of Dynamic Composition):
 * The quiescent state of a dynamic component graph is a pure function of the final
 * configuration alone, completely independent of the activation/deactivation trajectory.
 */
export class ConfluenceEngine {
  constructor() {
    this.registry = new Map(); // name -> { deps, value, active }
  }

  register(name, deps = [], value = '') {
    this.registry.set(name, { name, deps, value, active: false });
  }

  activate(name) {
    const comp = this.registry.get(name);
    if (!comp) throw new Error(`confluence:unknown-component: ${name}`);
    for (const d of comp.deps) {
      const dep = this.registry.get(d);
      if (!dep || !dep.active) {
        throw new Error(`confluence:unmet-dependency: Component '${name}' requires active '${d}'`);
      }
    }
    comp.active = true;
  }

  deactivate(name) {
    const comp = this.registry.get(name);
    if (!comp) throw new Error(`confluence:unknown-component: ${name}`);
    // Check if anyone depends on this active component
    for (const [otherName, other] of this.registry.entries()) {
      if (other.active && other.deps.includes(name)) {
        throw new Error(`confluence:active-dependent-blockade: Cannot deactivate '${name}' while '${otherName}' depends on it`);
      }
    }
    comp.active = false;
  }

  computeQuiescentDigest() {
    const activeEntries = [];
    for (const [name, comp] of this.registry.entries()) {
      if (comp.active) {
        activeEntries.push({ name: comp.name, deps: comp.deps, value: comp.value });
      }
    }
    activeEntries.sort((a, b) => a.name.localeCompare(b.name));
    return createHash('sha256').update(canonicalJSON(activeEntries)).digest('hex');
  }

  static computeStaticDigest(components = []) {
    const active = components.map(c => ({ name: c.name, deps: c.deps || [], value: c.value || '' }));
    active.sort((a, b) => a.name.localeCompare(b.name));
    return createHash('sha256').update(canonicalJSON(active)).digest('hex');
  }
}
