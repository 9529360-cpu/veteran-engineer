import path from 'node:path';
import fs from 'node:fs/promises';
import { HOST_ADAPTER_API_VERSION } from '../../constants.mjs';
import { ensureDir, pathExists } from '../../util.mjs';
import { findExecutable, readJson, writeJsonAtomic } from '../util.mjs';

const OWNERSHIP_FILE = '.veteran-engineer-owned.json';

function hermesHome(context) {
  return path.resolve(context.options.hermesHome || context.env.HERMES_HOME || path.join(context.home, '.hermes'));
}

function skillTarget(context) {
  return path.join(hermesHome(context), 'skills', 'runtime-regression-debugger');
}

async function copyOwnedSkill(context) {
  const source = path.join(context.runtimeRoot, 'skills', 'runtime-regression-debugger');
  const target = skillTarget(context);
  if (await pathExists(target)) {
    const marker = await readJson(path.join(target, OWNERSHIP_FILE), null);
    if (!marker?.ownedBy || marker.ownedBy !== 'veteran-engineer') {
      const error = new Error(`Hermes skill path already exists and is not Veteran-owned: ${target}`);
      error.code = 'HOST_SKILL_CONFLICT';
      throw error;
    }
    await fs.rm(target, { recursive: true, force: true });
  }
  await ensureDir(path.dirname(target));
  await fs.cp(source, target, { recursive: true, force: false, errorOnExist: true });
  await writeJsonAtomic(path.join(target, OWNERSHIP_FILE), { ownedBy: 'veteran-engineer', version: context.version });
  return target;
}

async function requireHermes(context) {
  const executable = await findExecutable('hermes', context.env);
  if (!executable) {
    const error = new Error('Hermes CLI not found on PATH');
    error.code = 'HOST_CLI_NOT_FOUND';
    throw error;
  }
  return executable;
}

async function listHermes(executable, context) {
  return context.exec(executable, ['mcp', 'list'], { env: context.env, allowFailure: true, timeoutMs: 30_000 });
}

export default {
  apiVersion: HOST_ADAPTER_API_VERSION,
  id: 'hermes',
  displayName: 'Hermes Agent',
  capabilities: { mcp: true, skill: true },
  async install(context) {
    const executable = await requireHermes(context);
    const before = await listHermes(executable, context);
    const already = /\bveteran-engineer\b/.test(`${before.stdout}\n${before.stderr}`);
    if (already && !context.previousBinding) {
      const error = new Error('Hermes already has an MCP server named veteran-engineer that is not recorded as Veteran-owned');
      error.code = 'HOST_BINDING_CONFLICT';
      throw error;
    }
    if (already && context.previousBinding) {
      await context.exec(executable, ['mcp', 'remove', 'veteran-engineer'], { env: context.env, allowFailure: true, timeoutMs: 30_000 });
    }
    const server = path.join(context.runtimeRoot, 'mcp', 'server.mjs');
    await context.exec(executable, ['mcp', 'add', 'veteran-engineer', '--command', 'node', '--args', server], { env: context.env, timeoutMs: 30_000 });
    const skillPath = await copyOwnedSkill(context);
    return { installed: true, cli: executable, skillPath, mcpServer: server, hermesHome: hermesHome(context) };
  },
  async status(context) {
    const executable = await findExecutable('hermes', context.env);
    const marker = await readJson(path.join(skillTarget(context), OWNERSHIP_FILE), null);
    let mcpInstalled = false;
    let list = null;
    if (executable) {
      list = await listHermes(executable, context);
      mcpInstalled = /\bveteran-engineer\b/.test(`${list.stdout}\n${list.stderr}`);
    }
    const skillInstalled = marker?.ownedBy === 'veteran-engineer';
    return { installed: Boolean(executable && mcpInstalled && skillInstalled), cliAvailable: Boolean(executable), mcpInstalled, skillInstalled, skillPath: skillTarget(context), hermesHome: hermesHome(context), listExitCode: list?.code ?? null };
  },
  async doctor(context) {
    const status = await this.status(context);
    const checks = [
      { name: 'hermes-cli', ok: status.cliAvailable },
      { name: 'hermes-mcp-binding', ok: status.mcpInstalled },
      { name: 'hermes-skill-projection', ok: status.skillInstalled }
    ];
    if (status.cliAvailable && status.mcpInstalled) {
      const executable = await findExecutable('hermes', context.env);
      const probe = await context.exec(executable, ['mcp', 'test', 'veteran-engineer'], { env: context.env, allowFailure: true, timeoutMs: 30_000 });
      checks.push({ name: 'hermes-mcp-test', ok: probe.code === 0, exitCode: probe.code, stderr: probe.stderr.slice(0, 1000) });
    }
    return { ok: checks.every((check) => check.ok), checks, status };
  },
  async uninstall(context) {
    const executable = await findExecutable('hermes', context.env);
    const actions = [];
    if (executable) {
      const remove = await context.exec(executable, ['mcp', 'remove', 'veteran-engineer'], { env: context.env, allowFailure: true, timeoutMs: 30_000 });
      actions.push({ action: 'mcp-remove', exitCode: remove.code });
    } else actions.push({ action: 'mcp-remove', skipped: true, reason: 'cli-unavailable' });
    const target = skillTarget(context);
    const marker = await readJson(path.join(target, OWNERSHIP_FILE), null);
    if (marker?.ownedBy === 'veteran-engineer') {
      await fs.rm(target, { recursive: true, force: true });
      actions.push({ action: 'skill-remove', removed: true });
    }
    return { removed: true, actions };
  }
};
