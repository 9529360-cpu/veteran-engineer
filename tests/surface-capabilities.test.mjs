import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { requireSurfaceCapability, resolveSurfaceProfile, SURFACE_CAPABILITY_CONTRACT } from '../src/surface-capabilities.mjs';
import { createVeteranApp } from '../src/app.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

test('surface capability profiles are explicit and fail closed on unknown profiles', () => {
  const local = resolveSurfaceProfile('local-stdio');
  const remote = resolveSurfaceProfile('remote-mcp');
  const tunnel = resolveSurfaceProfile('secure-tunnel');
  assert.equal(local.contract, SURFACE_CAPABILITY_CONTRACT);
  assert.equal(local.capabilities.repository.localPath, true);
  assert.equal(remote.capabilities.repository.localPath, false);
  assert.equal(remote.capabilities.repository.remoteGit, true);
  assert.equal(remote.capabilities.repository.fileUrl, false);
  assert.equal(tunnel.capabilities.transport.secureTunnel, true);
  assert.throws(() => resolveSurfaceProfile('made-up-surface'), (error) => error.code === 'SURFACE_PROFILE_UNSUPPORTED');
});

test('surface capability objects are canonicalized instead of trusting caller-provided capabilities', () => {
  const forged = {
    contract: SURFACE_CAPABILITY_CONTRACT,
    id: 'remote-mcp',
    capabilities: { repository: { localPath: true, remoteGit: true, fileUrl: true } }
  };
  assert.throws(
    () => requireSurfaceCapability(forged, 'repository', 'localPath'),
    (error) => error.code === 'SURFACE_CAPABILITY_UNAVAILABLE' && error.details?.surfaceProfile === 'remote-mcp'
  );
  const canonical = requireSurfaceCapability(forged, 'repository', 'remoteGit');
  assert.equal(canonical.capabilities.repository.localPath, false);
  assert.equal(canonical.capabilities.repository.fileUrl, false);
  assert.throws(
    () => resolveSurfaceProfile({ contract: 'forged-contract', id: 'remote-mcp' }),
    (error) => error.code === 'SURFACE_CAPABILITY_CONTRACT_INVALID'
  );
  assert.throws(
    () => resolveSurfaceProfile({ contract: SURFACE_CAPABILITY_CONTRACT, id: '' }),
    (error) => error.code === 'SURFACE_CAPABILITY_CONTRACT_INVALID'
  );
});

test('remote MCP surface refuses caller-local paths and runtime-local file URLs', async () => {
  const fixture = await createGitRepo();
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot, surfaceProfile: 'remote-mcp' });
    await assert.rejects(
      app.callTool('project_open', { requestId: 'remote-local-path-denied', repoPath: fixture.repo }),
      (error) => error.code === 'SURFACE_CAPABILITY_UNAVAILABLE' && error.details?.capability === 'repository.localPath'
    );
    await assert.rejects(
      app.callTool('project_open', { requestId: 'remote-file-url-denied', repoUrl: pathToFileURL(fixture.repo).href }),
      (error) => error.code === 'SURFACE_CAPABILITY_UNAVAILABLE' && error.details?.capability === 'repository.fileUrl'
    );
    const health = await app.callTool('runtime_health');
    assert.equal(health.surface.id, 'remote-mcp');
    assert.equal(health.surface.contract, SURFACE_CAPABILITY_CONTRACT);
    assert.equal(health.surface.capabilities.repository.localPath, false);
  } finally {
    await cleanup(fixture.root);
  }
});
