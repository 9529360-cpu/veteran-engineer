import fs from 'node:fs/promises';

export const PROCESS_OWNER_CONTRACT = 'veteran-process-owner-v1';
const STOPPED_LINUX_STATES = new Set(['Z', 'X', 'x']);

export function parseLinuxProcessStat(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const close = raw.lastIndexOf(')');
  if (close < 0) return null;
  const fields = raw.slice(close + 1).trim().split(/\s+/);
  if (fields.length < 20) return null;
  const state = fields[0];
  const startToken = fields[19];
  if (!state || !/^\d+$/.test(startToken || '')) return null;
  return { state, startToken };
}

function normalizedOwner(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!Number.isInteger(value.pid) || value.pid <= 0) return null;
  const startToken = value.startToken === undefined || value.startToken === null
    ? null
    : String(value.startToken);
  return {
    contract: PROCESS_OWNER_CONTRACT,
    pid: value.pid,
    ...(startToken && /^\d+$/.test(startToken) ? { startToken } : {})
  };
}

export function processOwnerFromRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  if (record.processOwner !== undefined) return normalizedOwner(record.processOwner);
  return normalizedOwner({ pid: record.pid });
}

async function signalProcessState(pid) {
  try {
    process.kill(pid, 0);
    return 'running';
  } catch (error) {
    if (error?.code === 'ESRCH') return 'stopped';
    if (error?.code === 'EPERM') return 'running';
    return 'unknown';
  }
}

async function linuxProcessSnapshot(pid) {
  try {
    const parsed = parseLinuxProcessStat(await fs.readFile(`/proc/${pid}/stat`, 'utf8'));
    if (!parsed) return { status: 'unknown', pid, reason: 'proc-stat-invalid' };
    if (STOPPED_LINUX_STATES.has(parsed.state)) {
      return { status: 'stopped', pid, state: parsed.state, observedStartToken: parsed.startToken, reason: 'linux-process-stopped' };
    }
    return { status: 'running', pid, state: parsed.state, observedStartToken: parsed.startToken };
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ESRCH') {
      return { status: 'stopped', pid, reason: 'process-missing' };
    }
    const fallback = await signalProcessState(pid);
    return {
      status: fallback,
      pid,
      reason: fallback === 'running' ? 'proc-stat-unavailable-process-exists' : 'process-observation-failed'
    };
  }
}

export async function currentProcessOwner() {
  const pid = process.pid;
  if (process.platform !== 'linux') return { contract: PROCESS_OWNER_CONTRACT, pid };
  const snapshot = await linuxProcessSnapshot(pid);
  return {
    contract: PROCESS_OWNER_CONTRACT,
    pid,
    ...(snapshot.observedStartToken ? { startToken: snapshot.observedStartToken } : {})
  };
}

export async function inspectProcessOwner(value) {
  const owner = normalizedOwner(value);
  if (!owner) return { status: 'unknown', pid: null, reason: 'owner-invalid' };
  if (process.platform !== 'linux') {
    const status = await signalProcessState(owner.pid);
    return { status, pid: owner.pid, reason: status === 'stopped' ? 'process-missing' : null };
  }

  const snapshot = await linuxProcessSnapshot(owner.pid);
  if (snapshot.status !== 'running') return snapshot;
  if (owner.startToken && snapshot.observedStartToken && owner.startToken !== snapshot.observedStartToken) {
    return {
      ...snapshot,
      status: 'replaced',
      expectedStartToken: owner.startToken,
      reason: 'pid-reused'
    };
  }
  return snapshot;
}

export function processOwnerDefinitelyGone(inspection) {
  return inspection?.status === 'stopped' || inspection?.status === 'replaced';
}
