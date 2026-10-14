import os from 'node:os';
import { readFileSync } from 'node:fs';

const MIB = 1024 * 1024;

function optionalLinuxText(name) {
  if (process.platform !== 'linux') return null;
  try {
    return readFileSync(name, 'utf8').trim();
  } catch {
    return null;
  }
}

function optionalNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function cpuQuotaCores() {
  const unified = optionalLinuxText('/sys/fs/cgroup/cpu.max');
  if (unified) {
    const [quota, period] = unified.split(/\s+/);
    const q = optionalNumber(quota);
    const p = optionalNumber(period);
    if (q !== null && p > 0) return q / p;
  }
  const q = optionalNumber(optionalLinuxText('/sys/fs/cgroup/cpu/cpu.cfs_quota_us'));
  const p = optionalNumber(optionalLinuxText('/sys/fs/cgroup/cpu/cpu.cfs_period_us'));
  return q !== null && p > 0 ? q / p : null;
}

function cgroupMemory() {
  const v2Limit = optionalNumber(optionalLinuxText('/sys/fs/cgroup/memory.max'));
  const v2Used = optionalNumber(optionalLinuxText('/sys/fs/cgroup/memory.current'));
  if (v2Limit !== null && v2Used !== null) return { limit: v2Limit, used: v2Used };
  const limit = optionalNumber(optionalLinuxText('/sys/fs/cgroup/memory/memory.limit_in_bytes'));
  const used = optionalNumber(optionalLinuxText('/sys/fs/cgroup/memory/memory.usage_in_bytes'));
  return limit !== null && used !== null ? { limit, used } : null;
}

/**
 * Read actual machine / container availability in the executing Node host.
 * These are conservative admission estimates, not measured per-model quotas
 * or proof that a third-party Agent runtime is configured and authenticated.
 *
 * Tests may inject resource readings; production always samples the host.
 */
export function inspectHostWorkerCapacity({
  cpuParallelism = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length,
  freeMemoryBytes = os.freemem(),
  totalMemoryBytes = os.totalmem(),
  quotaCores = cpuQuotaCores(),
  cgroup = cgroupMemory(),
  workerMemoryMiB = 512
} = {}) {
  const cpuCount = Math.max(1, Math.floor(optionalNumber(cpuParallelism) || 1));
  const effectiveCpuSlots = quotaCores === null || quotaCores === undefined
    ? cpuCount
    : Math.min(cpuCount, Math.max(1, Math.floor(optionalNumber(quotaCores) || 1)));
  const hostTotal = Math.max(0, optionalNumber(totalMemoryBytes) || 0);
  let available = Math.max(0, optionalNumber(freeMemoryBytes) || 0);
  let effectiveTotal = hostTotal;
  let cgroupBound = false;
  if (cgroup && optionalNumber(cgroup.limit) !== null && optionalNumber(cgroup.used) !== null
      && cgroup.limit > 0 && (hostTotal === 0 || cgroup.limit <= hostTotal)) {
    effectiveTotal = hostTotal ? Math.min(hostTotal, cgroup.limit) : cgroup.limit;
    available = Math.min(available, Math.max(0, cgroup.limit - cgroup.used));
    cgroupBound = true;
  }
  const memoryMiBPerWorker = Number.isInteger(workerMemoryMiB) && workerMemoryMiB > 0 ? workerMemoryMiB : 512;
  // Retain at least half of a low-memory machine's free headroom, and on
  // larger machines reserve a sensible cushion for the parent and OS.
  const reserve = Math.min(available / 2, Math.max(512 * MIB, effectiveTotal * 0.10));
  const estimatedMemorySlots = Math.max(0, Math.floor((available - reserve) / (memoryMiBPerWorker * MIB)));
  return {
    contract: 'veteran-host-worker-capacity-v1',
    source: 'executing-runtime-host',
    cpuParallelism: cpuCount,
    effectiveCpuSlots,
    availableMemoryMiB: Math.floor(available / MIB),
    estimatedMemorySlots,
    workerMemoryMiB: memoryMiBPerWorker,
    cgroupBound,
    note: 'Admission estimate only: actual worker/provider availability and quotas are checked separately.'
  };
}
