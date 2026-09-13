import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCredentialReferences } from '../src/credential-broker.mjs';

test('credential targets cannot bypass protected environment names with casing changes', () => {
  for (const targetEnv of ['pAtH', 'node_options', 'SystemROOT', 'ld_preload']) {
    assert.throws(
      () => normalizeCredentialReferences([{ provider: 'environment', name: 'SOURCE_SECRET', targetEnv }]),
      (error) => error?.code === 'CREDENTIAL_TARGET_INVALID',
      targetEnv
    );
  }
});

test('credential targets reject case-only duplicates for cross-host determinism', () => {
  assert.throws(
    () => normalizeCredentialReferences([
      { provider: 'environment', name: 'TOKEN_A', targetEnv: 'NPM_TOKEN' },
      { provider: 'environment', name: 'TOKEN_B', targetEnv: 'npm_token' }
    ]),
    (error) => error?.code === 'CREDENTIAL_TARGET_DUPLICATE'
  );
});

test('credential targets preserve the caller spelling for non-protected unique names', () => {
  const result = normalizeCredentialReferences([
    { provider: 'environment', name: 'TOKEN_A', targetEnv: 'NpmReadToken' }
  ]);
  assert.equal(result[0].targetEnv, 'NpmReadToken');
});
