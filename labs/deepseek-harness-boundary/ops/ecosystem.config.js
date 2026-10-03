const common = { autorestart: true, restart_delay: 3000, max_restarts: 50, merge_logs: true, time: true, interpreter: 'none' };
const asUser = (u, script) => ({ script: '/usr/bin/sudo', args: ['-n', '-u', u, '-H', script] });
module.exports = { apps: [
  { name: 'sk-auma-podman', ...asUser('auma', '/workspace/skunkworks/ops/auma-podman.sh'), ...common },
  { name: 'sk-auma-gateway', ...asUser('auma', '/workspace/skunkworks/ops/auma-gateway.sh'), ...common },
  { name: 'sk-gate', ...asUser('aukora-gate', '/workspace/skunkworks/ops/run-gate.sh'), ...common },
  { name: 'sk-harness', ...asUser('aukora-host', '/workspace/skunkworks/ops/run-harness.sh'), ...common },
  { name: 'sk-tunnel', script: '/workspace/skunkworks/ops/run-tunnel.sh', ...common },
  { name: 'sk-gate-tunnel', script: '/workspace/skunkworks/ops/run-gate-tunnel.sh', ...common },
] };
