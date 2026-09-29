import fs from 'node:fs/promises';
import path from 'node:path';
import { auditStudioProject, buildStudioProject } from './native-studio.mjs';
import { buildStudioSite, buildVisualPack } from './native-studio-publisher.mjs';

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
  if (['build', 'site', 'visual-pack'].includes(command) && argv[i] && !argv[i].startsWith('-')) out.specPath = argv[i++];
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

async function readSpec(specPath, command) {
  if (!specPath) throw Object.assign(new Error(`studio ${command} requires a spec path`), { code: 'STUDIO_SPEC_REQUIRED' });
  return JSON.parse(await fs.readFile(path.resolve(specPath), 'utf8'));
}

function requireOutput(outputDir, command) {
  if (!outputDir) throw Object.assign(new Error(`studio ${command} requires --out`), { code: 'STUDIO_OUTPUT_REQUIRED' });
  return outputDir;
}

export function nativeStudioUsage() {
  return `Veteran Native Studio\n\nUsage:\n  veteran-engineer studio build <spec.json> --out <directory> [--json]\n  veteran-engineer studio site <site.json> --out <directory> [--json]\n  veteran-engineer studio visual-pack <visual.json> --out <directory> [--json]\n  veteran-engineer studio audit <directory> [--json]\n\nBuild outputs:\n  build: responsive HTML/CSS, design tokens, studio JSON, SVG design board, audit\n  site: deployable multi-page static site with per-page Studio artifacts and site.json\n  visual-pack: portable SVG social/OG/story/banner/poster assets plus manifest\n\nThe studio uses local open files and Node.js built-ins. No Figma, Canva, Wix, paid API, or SaaS account is required.\n`;
}

export async function runNativeStudioCli(argv, { stdout = process.stdout } = {}) {
  const args = parse(argv);
  if (['help', '-h', '--help'].includes(args.command)) {
    stdout.write(nativeStudioUsage());
    return { ok: true, command: 'help' };
  }
  let result;
  if (args.command === 'build') {
    result = await buildStudioProject(await readSpec(args.specPath, 'build'), requireOutput(args.outputDir, 'build'));
  } else if (args.command === 'site') {
    result = await buildStudioSite(await readSpec(args.specPath, 'site'), requireOutput(args.outputDir, 'site'));
  } else if (args.command === 'visual-pack') {
    result = await buildVisualPack(await readSpec(args.specPath, 'visual-pack'), requireOutput(args.outputDir, 'visual-pack'));
  } else if (args.command === 'audit') {
    if (!args.projectDir) throw Object.assign(new Error('studio audit requires a project directory'), { code: 'STUDIO_PROJECT_REQUIRED' });
    result = await auditStudioProject(args.projectDir);
  } else {
    throw Object.assign(new Error(`Unknown studio command: ${args.command}`), { code: 'STUDIO_COMMAND_UNKNOWN' });
  }
  stdout.write(`${JSON.stringify(result, null, args.json ? 2 : 0)}\n`);
  return result;
}
