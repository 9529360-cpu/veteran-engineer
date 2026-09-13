import path from 'node:path';
import fs from 'node:fs/promises';
import { HOST_ADAPTER_API_VERSION } from '../../constants.mjs';
import { pathExists } from '../../util.mjs';
import { writeJsonAtomic, readJson } from '../util.mjs';

function descriptorFor(context) {
  return {
    mcpServers: {
      'veteran-engineer': {
        command: 'node',
        args: [path.join(context.runtimeRoot, 'mcp', 'server.mjs')],
        env: { VETERAN_ENGINEER_STATE_DIR: context.runtimeStateRoot }
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
  capabilities: { mcp: true, skill: false, portableDescriptor: true },
  async install(context) {
    const file = descriptorPath(context);
    await writeJsonAtomic(file, descriptorFor(context));
    return { installed: true, descriptorPath: file };
  },
  async status(context) {
    const file = descriptorPath(context);
    const config = await readJson(file, null);
    const server = config?.mcpServers?.['veteran-engineer'];
    const expected = descriptorFor(context).mcpServers['veteran-engineer'];
    const healthy = Boolean(server && server.command === expected.command && Array.isArray(server.args) && server.args[0] === expected.args[0]);
    return { installed: healthy, descriptorPath: file, exists: await pathExists(file), drift: Boolean(config && !healthy) };
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
