import path from 'node:path';
import fs from 'node:fs/promises';
import { HOST_ADAPTER_API_VERSION } from '../../constants.mjs';
import { pathExists } from '../../util.mjs';
import { writeJsonAtomic, readJson } from '../util.mjs';
import { requireSurfaceCapability, resolveSurfaceProfile } from '../../surface-capabilities.mjs';

function selectedSurfaceProfile(context) {
  const recorded = context.previousBinding?.binding?.surfaceProfile || context.previousBinding?.surfaceProfile || null;
  const profile = resolveSurfaceProfile(context.options.surfaceProfile || recorded || 'local-stdio');
  return requireSurfaceCapability(
    profile,
    'transport',
    'stdioMcp',
    `Generic MCP descriptors require a stdio-capable surface; ${profile.id} does not provide transport.stdioMcp`
  ).id;
}

function descriptorFor(context) {
  const surfaceProfile = selectedSurfaceProfile(context);
  return {
    mcpServers: {
      'veteran-engineer': {
        command: 'node',
        args: [path.join(context.runtimeRoot, 'mcp', 'server.mjs')],
        env: { VETERAN_ENGINEER_STATE_DIR: context.runtimeStateRoot, VETERAN_ENGINEER_SURFACE_PROFILE: surfaceProfile }
      }
    }
  };
}

function descriptorPath(context) {
  return path.resolve(context.options.descriptorPath || path.join(context.installerRoot, 'veteran-engineer.mcp.json'));
}

export default {
  apiVersion: HOST_ADAPTER_API_VERSION,
  id: 'generic',
  displayName: 'Generic MCP Host',
  surfaceProfile: 'local-stdio',
  capabilities: { mcp: true, skill: false, portableDescriptor: true },
  async install(context) {
    const file = descriptorPath(context);
    await writeJsonAtomic(file, descriptorFor(context));
    return { installed: true, descriptorPath: file, surfaceProfile: selectedSurfaceProfile(context) };
  },
  async status(context) {
    const file = descriptorPath(context);
    const config = await readJson(file, null);
    const server = config?.mcpServers?.['veteran-engineer'];
    const expected = descriptorFor(context).mcpServers['veteran-engineer'];
    const healthy = Boolean(server && server.command === expected.command && Array.isArray(server.args) && server.args[0] === expected.args[0] && server.env?.VETERAN_ENGINEER_STATE_DIR === expected.env.VETERAN_ENGINEER_STATE_DIR && server.env?.VETERAN_ENGINEER_SURFACE_PROFILE === expected.env.VETERAN_ENGINEER_SURFACE_PROFILE);
    return { installed: healthy, descriptorPath: file, exists: await pathExists(file), drift: Boolean(config && !healthy), surfaceProfile: selectedSurfaceProfile(context) };
  },
  async doctor(context) {
    const status = await this.status(context);
    return { ok: status.installed, checks: [{ name: 'generic-descriptor', ok: status.installed, details: status }] };
  },
  async uninstall(context) {
    const file = descriptorPath(context);
    if (await pathExists(file)) await fs.rm(file, { force: true });
    return { removed: true, descriptorPath: file };
  }
};
