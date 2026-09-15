import fs from 'node:fs/promises';
import path from 'node:path';
import { auditStudioProject, buildStudioProject } from './native-studio.mjs';

function optionValue(argv, index, option) {
  const value = argv[index + 1];
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('-')) {
    const error = new Error(`${option} requires a value`);
    error.code = 'STUDIO_ARGUMENT_VALUE_REQUIRED';
    throw error;
  }
  return value;
}

function parse(argv) {
  const command = argv[0] || 'help';
  const out = { command, json: false, specPath: null, outputDir: null, projectDir: null };
  let i = 1;
  if (command === 'build' && argv[i] && !argv[i].startsWith('-')) out.specPath = argv[i++];
  if (command === 'audit' && argv[i] && !argv[i].startsWith('-')) out.projectDir = argv[i++];
  for (; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') out.json = true;
    else if (arg === '--spec') out.specPath = optionValue(argv, i++, arg);
    else if (arg === '--out') out.outputDir = optionValue(argv, i++, arg);
    else if (arg === '--project') out.projectDir = optionValue(argv, i++, arg);
    else throw Object.assign(new Error(`Unknown studio argument: ${arg}`), { code: 'STUDIO_ARGUMENT_UNKNOWN' });
  }
  return out;
}

export function nativeStudioUsage() {
  return `Veteran Native Studio\n\nUsage:\n  node bin/veteran-studio.mjs build <spec.json> --out <directory> [--json]\n  node bin/veteran-studio.mjs audit <directory> [--json]\n\nBuild outputs:\n  index.html, styles.css, design-tokens.css, studio.json, design-system.svg, audit.json\n\nThe studio uses only local open files and Node.js built-ins. No Figma, Canva, Wix, or paid API is required.\n`;
}

export async function runNativeStudioCli(argv, { stdout = process.stdout } = {}) {
  const args = parse(argv);
  if (['help', '-h', '--help'].includes(args.command)) {
    stdout.write(nativeStudioUsage());
    return { ok: true, command: 'help' };
  }
  let result;
  if (args.command === 'build') {
    if (!args.specPath) throw Object.assign(new Error('studio build requires a spec path'), { code: 'STUDIO_SPEC_REQUIRED' });
    if (!args.outputDir) throw Object.assign(new Error('studio build requires --out'), { code: 'STUDIO_OUTPUT_REQUIRED' });
    const specPath = path.resolve(args.specPath);
    const raw = JSON.parse(await fs.readFile(specPath, 'utf8'));
    result = await buildStudioProject(raw, args.outputDir);
  } else if (args.command === 'audit') {
    if (!args.projectDir) throw Object.assign(new Error('studio audit requires a project directory'), { code: 'STUDIO_PROJECT_REQUIRED' });
    result = await auditStudioProject(args.projectDir);
  } else {
    throw Object.assign(new Error(`Unknown studio command: ${args.command}`), { code: 'STUDIO_COMMAND_UNKNOWN' });
  }
  stdout.write(`${JSON.stringify(result, null, args.json ? 2 : 0)}\n`);
  return result;
}
