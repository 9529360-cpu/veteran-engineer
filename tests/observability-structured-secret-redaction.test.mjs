import assert from 'node:assert/strict';
import test from 'node:test';
import { CredentialBroker } from '../src/credential-broker.mjs';
import { normalizeObservabilityValidation, runObservabilityValidation } from '../src/observability-validation-provider.mjs';
import { cleanup, tempDir } from './helpers.mjs';

const SECRET = 'observability-structured-secret-9f4c';
const providerSource = `
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input);
  const secret = process.env.OBS_TOKEN;
  process.stdout.write(JSON.stringify({
    contract: payload.contract,
    passed: true,
    summary: 'summary ' + secret,
    observedSourceHead: secret,
    checks: [{
      name: 'name ' + secret,
      passed: true,
      signal: 'signal ' + secret,
      observed: 'observed ' + secret,
      threshold: 'threshold ' + secret,
      detail: 'detail ' + secret
    }]
  }));
});
`;

function broker() {
  return new CredentialBroker({ providers: {
    vault: { async resolve() { return SECRET; } }
  } });
}

function config(requireSourceMatch) {
  return normalizeObservabilityValidation({
    command: [process.execPath, '-e', providerSource],
    target: 'service-under-test',
    windowSeconds: 60,
    requireSourceMatch,
    credentialRefs: [{ provider: 'vault', name: 'observability/read-token', targetEnv: 'OBS_TOKEN' }]
  });
}

test('observability redacts credentials from every returned structured provider field', async () => {
  const cwd = await tempDir('veteran-observability-redaction-');
  try {
    const result = await runObservabilityValidation(config(false), {
      cwd,
      expectedSourceHead: 'expected-source-head',
      credentialBroker: broker()
    });

    assert.equal(result.passed, true);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
    assert.equal(result.summary, 'summary [REDACTED]');
    assert.equal(result.observedSourceHead, '[REDACTED]');
    assert.equal(result.checks[0].name, 'name [REDACTED]');
    assert.equal(result.checks[0].signal, 'signal [REDACTED]');
    assert.equal(result.checks[0].observed, 'observed [REDACTED]');
    assert.equal(result.checks[0].threshold, 'threshold [REDACTED]');
    assert.equal(result.checks[0].detail, 'detail [REDACTED]');
  } finally {
    await cleanup(cwd);
  }
});

test('observability source mismatch never returns a credential-bearing observed source identity', async () => {
  const cwd = await tempDir('veteran-observability-mismatch-');
  try {
    const result = await runObservabilityValidation(config(true), {
      cwd,
      expectedSourceHead: 'expected-source-head',
      credentialBroker: broker()
    });

    assert.equal(result.passed, false);
    assert.equal(result.failureCode, 'OBSERVABILITY_SOURCE_IDENTITY_MISMATCH');
    assert.equal(result.observedSourceHead, '[REDACTED]');
    assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
    assert.equal(result.checks[0].name, 'name [REDACTED]');
    assert.equal(result.checks[0].signal, 'signal [REDACTED]');
  } finally {
    await cleanup(cwd);
  }
});
