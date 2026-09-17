import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createBrowserIsolatedEnvironment } from '../../src/browser-validation-provider.mjs';
import { signalProcessTree } from '../../src/process-lifecycle-authority.mjs';

// Temporary, fixture-only discriminator. Never inherit credentials or navigate
// to user content. Both cases retain an isolated profile and process-owned CDP.
for (const completeProfile of [false, true]) {
  const { env, home } = await createBrowserIsolatedEnvironment([], process.env);
  if (completeProfile) {
    env.APPDATA = path.join(home, 'AppData', 'Roaming');
    env.LOCALAPPDATA = path.join(home, 'AppData', 'Local');
    env.HOMEDRIVE = path.parse(home).root.replace(/[\\/]$/, '');
    env.HOMEPATH = home.slice(env.HOMEDRIVE.length);
    await fs.mkdir(env.APPDATA, { recursive: true });
    await fs.mkdir(env.LOCALAPPDATA, { recursive: true });
  }
  const profile = path.join(home, 'chromium-profile');
  await fs.mkdir(profile, { recursive: true });
  const child = spawn(process.env.VETERAN_TEST_BROWSER_PATH, [
    '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--metrics-recording-only',
    '--disable-default-apps', 'about:blank'
  ], { env, shell: false, detached: process.platform !== 'win32', windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'] });
  let stderr = '', bytes = 0, pipeBytes = 0;
  child.stdout.resume();
  child.stdin.on('error', () => {});
  child.stderr.on('data', chunk => {
    bytes += chunk.length;
    if (Buffer.byteLength(stderr) < 4096) stderr += chunk.toString('utf8').slice(0, 4096 - stderr.length);
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  const report = await new Promise(resolve => {
    let settled = false, buffer = '';
    const done = value => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => done({ result: 'handshake-timeout' }), 15000);
    child.on('error', error => done({ result: 'spawn-error', code: error.code }));
    child.on('exit', (code, signal) => done({ result: 'exit', code, signal }));
    child.stdio[3].on('error', error => done({ result: 'write-error', code: error.code }));
    child.stdio[4].on('error', error => done({ result: 'read-error', code: error.code }));
    child.stdio[4].on('data', chunk => {
      pipeBytes += chunk.length;
      buffer += chunk.toString('utf8');
      if (buffer.length > 65536) return done({ result: 'oversized-handshake' });
      const end = buffer.indexOf('\0');
      if (end < 0) return;
      try {
        const message = JSON.parse(buffer.slice(0, end));
        done({ result: message.result?.product ? 'handshake-ok' : 'unexpected-response', product: message.result?.product });
      } catch { done({ result: 'malformed-handshake' }); }
    });
    child.stdio[3].write(JSON.stringify({ id: 1, method: 'Browser.getVersion' }) + '\0');
  });
  signalProcessTree(child.pid, 'SIGKILL');
  await closed;
  // Only the isolated fixture/browser log is printed; do not forward any
  // provider caller environment, token, app output, or user profile content.
  const diagnostic = stderr.split(home).join('<isolated-home>');
  console.log(JSON.stringify({ completeProfile, ...report, pipeBytes, stderrBytes: bytes, diagnostic }));
  await fs.rm(home, { recursive: true, force: true });
}
