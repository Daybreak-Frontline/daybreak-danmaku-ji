import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:7890';
const env = {
  ...process.env,
  HTTP_PROXY: proxy,
  HTTPS_PROXY: proxy,
  http_proxy: proxy,
  https_proxy: proxy,
  ELECTRON_GET_USE_PROXY: 'true',
  GLOBAL_AGENT_HTTP_PROXY: proxy,
  GLOBAL_AGENT_HTTPS_PROXY: proxy
};

function electronExecutable() {
  try {
    const pkg = path.dirname(require.resolve('electron/package.json'));
    const exe = path.join(pkg, 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
    if (fs.existsSync(exe)) return exe;
  } catch {}
  return '';
}

const electronExe = electronExecutable();
const main = path.join(ROOT, 'electron', 'main.mjs');
const runEnv = { ...process.env };
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
  delete runEnv[key];
}
const child = electronExe
  ? spawn(electronExe, [main], {
    cwd: ROOT,
    env: runEnv,
    stdio: 'ignore',
    detached: true,
    windowsHide: false
  })
  : spawn('npx', ['--yes', 'electron@36', main], {
    cwd: ROOT,
    env,
    stdio: 'ignore',
    detached: true,
    shell: true,
    windowsHide: false
  });
child.on('error', () => process.exit(1));
if (!child.pid) process.exit(1);
child.unref();
process.exit(0);
