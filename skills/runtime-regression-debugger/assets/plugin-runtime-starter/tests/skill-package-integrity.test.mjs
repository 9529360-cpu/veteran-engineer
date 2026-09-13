import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const skillRoot = path.join(root, 'skills', 'runtime-regression-debugger');

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

const skillAvailable = await exists(skillRoot);

test('Skill package references, metadata, and benchmark scenarios stay coherent', {
  skip: skillAvailable ? false : 'runtime starter intentionally omits the source Skill package'
}, async () => {
  const skillPath = path.join(skillRoot, 'SKILL.md');
  const skill = await fs.readFile(skillPath, 'utf8');
  const skillLines = skill.split('\n').length;
  assert.ok(skillLines <= 500, `SKILL.md must remain a compact control plane (<= 500 lines); got ${skillLines}`);

  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter, 'SKILL.md must have YAML frontmatter');
  const frontmatterKeys = [...frontmatter[1].matchAll(/^([A-Za-z0-9_-]+):/gm)].map((match) => match[1]);
  assert.deepEqual(frontmatterKeys, ['name', 'description'], 'Skill frontmatter must contain only name and description');

  const referencedPaths = [...new Set(
    [...skill.matchAll(/\b(?:references|scripts|assets)\/[A-Za-z0-9._/-]+/g)]
      .map((match) => match[0].replace(/\/+$/, ''))
  )].sort();
  assert.ok(referencedPaths.length > 0, 'SKILL.md should reference packaged resources');

  for (const rel of referencedPaths) {
    const target = path.resolve(skillRoot, rel);
    assert.equal(target === skillRoot || target.startsWith(`${skillRoot}${path.sep}`), true, `Skill reference escapes package root: ${rel}`);
    assert.equal(await exists(target), true, `SKILL.md references missing packaged resource: ${rel}`);
  }

  const agentPath = path.join(skillRoot, 'agents', 'openai.yaml');
  assert.equal(await exists(agentPath), true, 'Skill UI metadata is missing: agents/openai.yaml');
  const agent = await fs.readFile(agentPath, 'utf8');
  for (const match of agent.matchAll(/^\s*icon_(?:small|large):\s*(\S+)\s*$/gm)) {
    const rel = match[1];
    const target = path.resolve(skillRoot, rel);
    assert.equal(target.startsWith(`${skillRoot}${path.sep}`), true, `Skill icon escapes package root: ${rel}`);
    assert.equal(await exists(target), true, `Skill UI metadata references missing icon: ${rel}`);
  }

  const benchmarkPath = path.join(skillRoot, 'references', 'veteran-engineer-benchmark.md');
  const benchmark = await fs.readFile(benchmarkPath, 'utf8');
  const scenarioIds = [...benchmark.matchAll(/^(\d+)\. \*\*.+?\*\*:/gm)].map((match) => Number(match[1]));
  assert.ok(scenarioIds.length > 0, 'Veteran benchmark must contain numbered scenarios');
  assert.deepEqual(
    scenarioIds,
    Array.from({ length: scenarioIds.length }, (_, index) => index + 1),
    'Veteran benchmark scenario ids must stay sequential from 1'
  );
});
