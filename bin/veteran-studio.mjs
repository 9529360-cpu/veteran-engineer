#!/usr/bin/env node
import { runNativeStudioCli } from '../src/native-studio-cli.mjs';

runNativeStudioCli(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.code ? `[${error.code}] ` : ''}${error.stack || error.message || String(error)}\n`);
  process.exitCode = 1;
});
