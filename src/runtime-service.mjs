import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME_NAME, RUNTIME_VERSION, STATE_SCHEMA_VERSION } from './constants.mjs';
import { protocolCapability, MCP_TRANSPORT_MODES } from './mcp-protocol-capability.mjs';
import { TOOL_NAMES } from './tool-catalog.mjs';
import { nowIso, pathExists } from './util.mjs';
import { inspectMcpSdkIntegrity } from './mcp-sdk-integrity.mjs';
import { resolveSurfaceProfile } from './surface-capabilities.mjs';

const defaultRuntimeRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export class RuntimeService {
  constructor({ store, experienceService, protocolMode = MCP_TRANSPORT_MODES.STANDALONE_FALLBACK, runtimeRoot = defaultRuntimeRoot, surfaceProfile = 'local-stdio' }) {
    this.store = store;
    this.experienceService = experienceService;
    this.protocolMode = protocolMode;
    this.runtimeRoot = runtimeRoot;
    this.surfaceProfile = resolveSurfaceProfile(surfaceProfile);
  }

  setProtocolMode(mode) {
    this.protocolMode = mode;
  }

  async health() {
    const state = await this.store.read();
    const audit = await this.store.verifyAudit();
    return {
      name: RUNTIME_NAME,
      version: RUNTIME_VERSION,
      stateSchemaVersion: STATE_SCHEMA_VERSION,
      stateRoot: this.store.root,
      stateBackend: {
        kind: this.store.backendKind || 'legacy-state-store',
        contract: this.store.backendContract || null,
        transactionContract: this.store.transactionContract || null,
        durabilityContract: this.store.durabilityContract || null,
        instanceKey: this.store.backendKind === 'postgres' ? this.store.instanceKey : null
      },
      stateReadable: Boolean(state),
      audit: { ok: audit.ok, entries: audit.entries },
      mcp: protocolCapability(this.protocolMode),
      surface: this.surfaceProfile,
      sdk: await inspectMcpSdkIntegrity(this.runtimeRoot),
      toolCount: TOOL_NAMES.length,
      toolSurface: [...TOOL_NAMES],
      at: nowIso()
    };
  }

  async integrity() {
    const issues = [];
    let state;
    try { state = await this.store.read(); } catch (error) { issues.push({ code: 'STATE_UNREADABLE', message: error.message }); }
    const audit = await this.store.verifyAudit();
    if (!audit.ok) issues.push({ code: 'AUDIT_CHAIN_INVALID', details: audit });
    if (state) {
      const started = Object.values(state.requests || {}).filter((request) => request.status === 'started');
      if (started.length) issues.push({ code: 'UNRECONCILED_STARTED_REQUESTS', requestIds: started.map((item) => item.requestId) });
      for (const mission of Object.values(state.missions || {})) {
        if (!state.projects[mission.projectId]) issues.push({ code: 'MISSION_PROJECT_MISSING', missionId: mission.id });
      }
    }
    return { ok: issues.length === 0, audit, issues, toolCount: TOOL_NAMES.length };
  }

  async cleanup({ apply = false } = {}) {
    const state = await this.store.read();
    const referenced = new Set();
    for (const mission of Object.values(state.missions || {})) {
      if (!['completed', 'cancelled'].includes(mission.status)) referenced.add(`mission-${mission.id}`);
    }
    for (const task of Object.values(state.tasks || {})) {
      if (!['done', 'cancelled', 'superseded'].includes(task.status)) referenced.add(`task-${task.missionId}-${task.id}`);
    }
    const entries = await fs.readdir(this.store.worktreesDir, { withFileTypes: true }).catch(() => []);
    const orphans = entries.filter((entry) => entry.isDirectory() && ![...referenced].some((prefix) => entry.name.startsWith(prefix))).map((entry) => entry.name);
    const removed = [];
    if (apply) {
      for (const name of orphans) {
        await fs.rm(path.join(this.store.worktreesDir, name), { recursive: true, force: true });
        removed.push(name);
      }
    }
    return { apply, orphans, removed };
  }

  async maintenance({ projectId = null } = {}) {
    const state = await this.store.read();
    const unknownRequests = Object.values(state.requests || {}).filter((item) => item.status === 'unknown').map((item) => item.requestId);
    const experienceAudit = await this.experienceService.audit({ projectId });
    const backupPresent = this.store.backupPath ? await pathExists(this.store.backupPath) : null;
    const result = { unknownRequests, experienceAudit, backupPresent, at: nowIso() };
    await this.store.transaction('runtime_maintenance', (working) => {
      working.runtime.maintenance.lastRun = result.at;
      working.runtime.maintenance.lastSummary = { unknownRequests: unknownRequests.length, experiences: experienceAudit.length, backupPresent };
    }, { unknownRequests: unknownRequests.length, experiences: experienceAudit.length });
    return result;
  }
}
