import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const discriminator = path.join(
  root,
  'skills',
  'runtime-regression-debugger',
  'scripts',
  'causal_discriminator.py'
);

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

function runPython(args) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [discriminator, ...args], {
      cwd: root,
      encoding: 'utf8'
    });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

async function writeManifest(dir, name, value) {
  const target = path.join(dir, name);
  await fs.writeFile(target, JSON.stringify(value), 'utf8');
  return target;
}

const hypotheses = [{ id: 'cache' }, { id: 'database' }];

test('causal discriminator never recommends irreversible or production-wide probes over bounded diagnostics', async (t) => {
  if (!(await exists(discriminator))) {
    t.skip('source Skill causal discriminator is not present in this isolated runtime fixture');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-causal-safe-'));
  try {
    const manifest = await writeManifest(dir, 'manifest.json', {
      hypotheses,
      probes: [
        {
          id: 'safe-expensive',
          cost: 20,
          blast_radius: 3,
          irreversible: false,
          production_wide: false,
          predictions: { cache: 'hit', database: 'miss' }
        },
        {
          id: 'destructive-perfect',
          cost: 0,
          blast_radius: 0,
          irreversible: true,
          production_wide: false,
          predictions: { cache: 'hit', database: 'miss' }
        },
        {
          id: 'production-wide-perfect',
          cost: 0,
          blast_radius: 0,
          irreversible: false,
          production_wide: true,
          predictions: { cache: 'hit', database: 'miss' }
        }
      ]
    });

    const result = runPython([manifest, '--json']);
    assert.ok(result, 'python is required by the Skill causal discriminator regression');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, 'ready');
    assert.equal(payload.recommended_probe, 'safe-expensive');
    assert.deepEqual(payload.ranked_probes.map((item) => item.id), ['safe-expensive']);
    assert.deepEqual(
      new Set(payload.escalation_only_probes.map((item) => item.id)),
      new Set(['destructive-perfect', 'production-wide-perfect'])
    );
    assert.ok(payload.escalation_only_probes.every((item) => item.admissibility === 'escalation-only'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('causal discriminator blocks when every available discriminator is escalation-only', async (t) => {
  if (!(await exists(discriminator))) {
    t.skip('source Skill causal discriminator is not present in this isolated runtime fixture');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-causal-blocked-'));
  try {
    const manifest = await writeManifest(dir, 'manifest.json', {
      hypotheses,
      probes: [
        {
          id: 'delete-live-state',
          cost: 1,
          blast_radius: 1,
          irreversible: true,
          predictions: { cache: 'yes', database: 'no' }
        },
        {
          id: 'restart-all-production',
          cost: 1,
          blast_radius: 10,
          production_wide: true,
          predictions: { cache: 'yes', database: 'no' }
        }
      ]
    });

    const result = runPython([manifest, '--json']);
    assert.ok(result, 'python is required by the Skill causal discriminator regression');
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, 'blocked-no-reversible-bounded-probe');
    assert.equal(payload.recommended_probe, null);
    assert.deepEqual(payload.ranked_probes, []);
    assert.equal(payload.escalation_only_probes.length, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('causal discriminator fails closed on ambiguous safety and ranking metadata', async (t) => {
  if (!(await exists(discriminator))) {
    t.skip('source Skill causal discriminator is not present in this isolated runtime fixture');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-causal-invalid-'));
  try {
    const cases = [
      {
        name: 'string-bool.json',
        manifest: { hypotheses, probes: [{ id: 'p', irreversible: 'false', predictions: { cache: 1, database: 2 } }] },
        error: /irreversible must be a boolean/
      },
      {
        name: 'numeric-bool.json',
        manifest: { hypotheses, probes: [{ id: 'p', production_wide: 1, predictions: { cache: 1, database: 2 } }] },
        error: /production_wide must be a boolean/
      },
      {
        name: 'negative-cost.json',
        manifest: { hypotheses, probes: [{ id: 'p', cost: -1, predictions: { cache: 1, database: 2 } }] },
        error: /cost must be a finite non-negative number/
      },
      {
        name: 'string-blast.json',
        manifest: { hypotheses, probes: [{ id: 'p', blast_radius: '0', predictions: { cache: 1, database: 2 } }] },
        error: /blast_radius must be a finite non-negative number/
      },
      {
        name: 'duplicate.json',
        manifest: {
          hypotheses,
          probes: [
            { id: 'same', predictions: { cache: 1, database: 2 } },
            { id: 'same', predictions: { cache: 2, database: 1 } }
          ]
        },
        error: /duplicate probe id: same/
      },
      {
        name: 'unknown-hypothesis.json',
        manifest: { hypotheses, probes: [{ id: 'p', predictions: { cache: 1, typo: 2 } }] },
        error: /predictions reference unknown hypotheses: typo/
      }
    ];

    for (const item of cases) {
      const manifest = await writeManifest(dir, item.name, item.manifest);
      const result = runPython([manifest, '--json']);
      assert.ok(result, 'python is required by the Skill causal discriminator regression');
      assert.equal(result.status, 2, `${item.name}: ${result.stderr || result.stdout}`);
      assert.match(result.stderr, item.error, item.name);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
