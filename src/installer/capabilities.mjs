import fs from 'node:fs/promises';
import path from 'node:path';
import { POSTGRES_DRIVER_VERSION } from '../postgres-state-backend.mjs';
import { resolveStateBackendConfig, STATE_BACKEND_KINDS } from '../state-backend-factory.mjs';

function selectedKind(env) {
  return String(env?.VETERAN_ENGINEER_STATE_BACKEND || STATE_BACKEND_KINDS.LOCAL_JSON).trim();
}

async function readPostgresDriver(runtimeRoot) {
  const packagePath = path.join(path.resolve(runtimeRoot), 'node_modules', 'pg', 'package.json');
  try {
    const raw = await fs.readFile(packagePath, 'utf8');
    const pkg = JSON.parse(raw);
    return { installed: true, readable: true, version: typeof pkg.version === 'string' ? pkg.version : null };
  } catch (error) {
    if (error?.code === 'ENOENT') return { installed: false, readable: false, version: null, errorCode: null };
    return { installed: true, readable: false, version: null, errorCode: error?.code || 'PG_PACKAGE_INVALID' };
  }
}

export async function inspectPostgresStateCapability({ runtimeRoot, env = process.env } = {}) {
  if (typeof runtimeRoot !== 'string' || !runtimeRoot) {
    const error = new Error('runtimeRoot is required to inspect PostgreSQL capability');
    error.code = 'RUNTIME_ROOT_REQUIRED';
    throw error;
  }

  const requestedKind = selectedKind(env);
  let resolved = null;
  let configError = null;
  try {
    resolved = resolveStateBackendConfig({ env });
  } catch (error) {
    configError = {
      code: error?.code || 'STATE_BACKEND_CONFIGURATION_INVALID',
      message: error?.message || 'State backend configuration is invalid'
    };
  }

  const driver = await readPostgresDriver(runtimeRoot);
  const driverExact = driver.readable && driver.version === POSTGRES_DRIVER_VERSION;
  const postgresSelected = requestedKind === STATE_BACKEND_KINDS.POSTGRES;
  const urlConfigured = typeof env?.VETERAN_ENGINEER_POSTGRES_URL === 'string' && Boolean(env.VETERAN_ENGINEER_POSTGRES_URL.trim());
  const instanceConfigured = typeof env?.VETERAN_ENGINEER_STATE_INSTANCE === 'string' && Boolean(env.VETERAN_ENGINEER_STATE_INSTANCE.trim());
  const checks = [
    {
      name: 'state-backend-config',
      ok: configError === null,
      selected: resolved?.kind || requestedKind,
      errorCode: configError?.code || null,
      message: configError?.message || null
    },
    {
      name: 'postgres-driver',
      ok: driverExact,
      optional: !postgresSelected,
      requiredVersion: POSTGRES_DRIVER_VERSION,
      installed: driver.installed,
      readable: driver.readable,
      installedVersion: driver.version,
      errorCode: driver.errorCode || null
    }
  ];

  return {
    ok: checks.filter((check) => !check.optional).every((check) => check.ok),
    selected: resolved?.kind || requestedKind,
    postgresSelected,
    config: {
      valid: configError === null,
      urlConfigured,
      instanceConfigured,
      poolMax: resolved?.kind === STATE_BACKEND_KINDS.POSTGRES ? resolved.poolMax : null,
      errorCode: configError?.code || null,
      message: configError?.message || null
    },
    driver: {
      requiredVersion: POSTGRES_DRIVER_VERSION,
      installed: driver.installed,
      readable: driver.readable,
      installedVersion: driver.version,
      exact: driverExact,
      errorCode: driver.errorCode || null
    },
    checks
  };
}
