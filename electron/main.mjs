import { app, BrowserWindow, dialog, nativeImage, session } from 'electron';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
  delete process.env[key];
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 54821);
const API = `http://127.0.0.1:${PORT}`;
const HEALTH = `${API}/api/v1/health`;
const DATA_DIR = process.env.MUSICHE_DATA || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const ICON_FILE = [path.join(ROOT, 'electron', 'icon.ico'), path.join(ROOT, 'electron', 'icon.png')].find(item => fs.existsSync(item));
const WINDOW_ICON = ICON_FILE ? nativeImage.createFromPath(ICON_FILE) : undefined;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'AudioOutputDevices');
app.commandLine.appendSwitch('enable-transparent-visuals');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('no-proxy-server');
app.commandLine.appendSwitch('proxy-bypass-list', '<local>;<-loopback>;127.0.0.1;localhost;::1');
if (process.platform === 'win32') app.setAppUserModelId('cn.daybreak.musiche-danmaku-ji');
app.setPath('userData', path.join(DATA_DIR, 'cache'));
app.setPath('sessionData', path.join(DATA_DIR, 'cache'));
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let apiChild = null;
let spawnedApi = false;
let apiRestartTimer = null;
let apiCrashCount = 0;

function logLine(message) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(path.join(DATA_DIR, 'electron.log'), `${new Date().toISOString()} ${message}\n`);
  } catch {}
}

function isOverlayWindow(win) {
  return String(win?.getTitle() || '').startsWith('捕获窗');
}

function getMainWindow() {
  return BrowserWindow.getAllWindows().find(item => !isOverlayWindow(item));
}

function focusWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.setAlwaysOnTop(true);
  win.focus();
  setTimeout(() => {
    if (!win.isDestroyed()) win.setAlwaysOnTop(false);
  }, 400);
}

function healthy() {
  return new Promise(resolve => {
    const req = http.get(HEALTH, res => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitForHealth(timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (await healthy()) return resolve(true);
      if (Date.now() - start > timeoutMs) return reject(new Error(`API 启动超时：${HEALTH}`));
      setTimeout(tick, 400);
    };
    tick();
  });
}

function nodeExecutable() {
  const candidates = [
    process.env.MUSICHE_NODE,
    path.join(ROOT, '..', 'runtime', 'node.exe'),
    path.join(ROOT, 'runtime', 'node.exe'),
    'node'
  ].filter(Boolean);
  return candidates.find(item => item === 'node' || fs.existsSync(item)) || 'node';
}

function killPid(pid) {
  if (!pid) return;
  try { process.kill(pid, 'SIGKILL'); } catch {}
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    } catch {}
  }
}

function findListenerPid(port) {
  try {
    const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes(`127.0.0.1:${port}`) || !/LISTENING|侦听/i.test(line)) continue;
      const pid = Number((line.trim().match(/(\d+)\s*$/) || [])[1] || 0);
      if (pid) return pid;
    }
  } catch {}
  return 0;
}

function stopApi() {
  const pid = apiChild?.pid;
  apiChild = null;
  spawnedApi = false;
  killPid(pid);
}

async function waitUntilUnhealthy(timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await healthy())) return true;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return !(await healthy());
}

function startApi() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const node = nodeExecutable();
  const logPath = path.join(DATA_DIR, 'api.log');
  let logFd;
  try { logFd = fs.openSync(logPath, 'a'); } catch { logFd = 'ignore'; }
  apiChild = spawn(node, ['--experimental-sqlite', path.join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      MUSICHE_DATA: DATA_DIR,
      MUSICHE_CLOUD_COOKIE: '',
      MUSICHE_EXTERNAL_API: ''
    },
    stdio: logFd === 'ignore' ? 'ignore' : ['ignore', logFd, logFd],
    windowsHide: true,
    detached: false
  });
  spawnedApi = true;
  apiChild.on('error', error => {
    dialog.showErrorBox('弹幕点歌姬', `无法启动本机 API：${error?.message || error}\nNode：${node}`);
  });
  apiChild.on('exit', code => {
    apiChild = null;
    spawnedApi = false;
    if (app.isQuiting) return;
    logLine(`api exit ${code}`);
    scheduleApiRestart(node);
  });
}

function scheduleApiRestart(node) {
  if (process.env.MUSICHE_EXTERNAL_API === '1' || apiRestartTimer || app.isQuiting) return;
  apiCrashCount += 1;
  const delay = Math.min(4000, 300 * apiCrashCount);
  apiRestartTimer = setTimeout(async () => {
    apiRestartTimer = null;
    if (app.isQuiting) return;
    try {
      startApi();
      await waitForHealth(15000);
      apiCrashCount = 0;
      await reloadOverlayWindows();
    } catch (error) {
      logLine(`api restart failed: ${error?.message || error}`);
      if (apiCrashCount >= 3) {
        dialog.showErrorBox('弹幕点歌姬', `本机 API 已退出且未能自动恢复。请确认 Node 可用：${node} --experimental-sqlite`);
      } else {
        scheduleApiRestart(node);
      }
    }
  }, delay);
}

async function reloadOverlayWindows() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || !isOverlayWindow(win)) continue;
    const url = win.overlayUrl || (() => {
      try { return win.webContents.getURL(); } catch { return ''; }
    })();
    if (!url) continue;
    const pathname = win.overlayPath || overlayPathname(url);
    if (pathname && !overlayNeedsLoad(win, pathname)) continue;
    try { await loadOverlayUrl(win, url); } catch (error) {
      logLine(`overlay reload: ${error?.message || error}`);
    }
  }
}

async function ensureApi() {
  if (process.env.MUSICHE_EXTERNAL_API === '1') {
    if (!(await healthy())) throw new Error('已设置 MUSICHE_EXTERNAL_API=1，但本机 API 未就绪');
    return;
  }
  if (await healthy()) {
    killPid(findListenerPid(PORT));
    const freed = await waitUntilUnhealthy();
    if (!freed) throw new Error(`端口 ${PORT} 仍被其他程序占用，无法启动本机 API`);
  }
  startApi();
  await waitForHealth();
}

function quitApp() {
  if (app.isQuiting) {
    stopApi();
    return;
  }
  app.isQuiting = true;
  stopApi();
  for (const win of BrowserWindow.getAllWindows()) {
    try { if (!win.isDestroyed()) win.destroy(); } catch {}
  }
  app.quit();
}

function stripWindowMenu(win) {
  try { win.removeMenu(); } catch {}
  try { win.setMenu(null); } catch {}
  win.setMenuBarVisibility(false);
  win.autoHideMenuBar = true;
}

function attachOverlayControls(win) {
  win.webContents.on('context-menu', () => {
    if (win.overlayToggling || win.isDestroyed()) return;
    toggleOverlayFrame(win);
  });
}

function overlayChromeOptions(url, { framed, contentBounds, alwaysOnTop }) {
  let parsed;
  try { parsed = new URL(url); } catch { parsed = null; }
  const wantClear = parsed?.searchParams.get('clear') === '1';
  const bg = parsed?.searchParams.get('bg') || '#0b0d12';
  const transparent = !framed && wantClear;
  return {
    width: Math.max(200, contentBounds?.width || Number(parsed?.searchParams.get('w')) || 420),
    height: Math.max(48, contentBounds?.height || Number(parsed?.searchParams.get('h')) || 780),
    useContentSize: true,
    minWidth: 200,
    minHeight: 48,
    title: parsed?.searchParams.get('title') || '捕获窗',
    icon: WINDOW_ICON,
    frame: framed,
    transparent,
    backgroundColor: transparent ? '#00000000' : bg,
    hasShadow: framed || !transparent,
    thickFrame: true,
    resizable: true,
    minimizable: true,
    closable: true,
    alwaysOnTop: Boolean(alwaysOnTop),
    autoHideMenuBar: true,
    show: false,
    roundedCorners: framed || !transparent,
    backgroundThrottling: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  };
}

function overlayPathname(url) {
  try { return new URL(url).pathname; } catch { return ''; }
}

function overlayNeedsLoad(win, pathname) {
  try {
    const current = win.webContents.getURL();
    if (!current || current === 'about:blank') return true;
    return new URL(current).pathname !== pathname;
  } catch {
    return true;
  }
}

async function loadOverlayUrl(win, url) {
  if (win.isDestroyed()) return false;
  if (!(await healthy())) {
    try { await waitForHealth(8000); } catch {}
  }
  if (!(await healthy())) {
    logLine(`overlay skip, api down: ${url}`);
    return false;
  }
  try {
    await win.loadURL(url);
    return true;
  } catch (error) {
    logLine(`overlay loadURL: ${error?.message || error}`);
    await new Promise(resolve => setTimeout(resolve, 600));
    if (win.isDestroyed() || !(await healthy())) return false;
    try {
      await win.loadURL(url);
      return true;
    } catch (retryError) {
      logLine(`overlay retry: ${retryError?.message || retryError}`);
      return false;
    }
  }
}

function createOverlayBrowserWindow(url, state) {
  const child = new BrowserWindow(overlayChromeOptions(url, state));
  child.overlayFramed = Boolean(state.framed);
  child.overlayPath = overlayPathname(url);
  child.overlayUrl = url;
  try { child.webContents.setBackgroundThrottling(false); } catch {}
  stripWindowMenu(child);
  attachOverlayControls(child);
  loadOverlayUrl(child, url).then(ok => {
    if (!ok && !child.isDestroyed()) {
      logLine(`overlay failed: ${url}`);
      try { child.close(); } catch {}
    }
  });
  return child;
}

function toggleOverlayFrame(win) {
  if (!win || win.isDestroyed() || win.overlayToggling) return;
  win.overlayToggling = true;
  const url = win.webContents.getURL();
  const contentBounds = win.getContentBounds();
  const next = createOverlayBrowserWindow(url, {
    framed: !win.overlayFramed,
    contentBounds,
    alwaysOnTop: win.isAlwaysOnTop()
  });
  next.once('ready-to-show', () => {
    try { next.setContentBounds(contentBounds); } catch {}
    next.show();
    if (!win.isDestroyed()) win.destroy();
  });
}

function findOverlayByPath(pathname) {
  return BrowserWindow.getAllWindows().find(win => {
    if (win.isDestroyed()) return false;
    if (win.overlayPath === pathname) return true;
    try {
      return new URL(win.webContents.getURL()).pathname === pathname;
    } catch {
      return false;
    }
  });
}

function openOverlayWindow(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return; }
  const existing = findOverlayByPath(parsed.pathname);
  if (existing) {
    existing.overlayUrl = url;
    try { existing.show(); existing.focus(); } catch {}
    if (overlayNeedsLoad(existing, parsed.pathname)) {
      loadOverlayUrl(existing, url).catch(() => {});
    }
    return;
  }
  const child = createOverlayBrowserWindow(url, {
    framed: false,
    contentBounds: {
      width: Math.max(200, Number(parsed.searchParams.get('w')) || 420),
      height: Math.max(48, Number(parsed.searchParams.get('h')) || 780)
    },
    alwaysOnTop: parsed.searchParams.get('top') === '1'
  });
  child.once('ready-to-show', () => child.show());
}

async function setDirectProxy() {
  try {
    await Promise.race([
      session.defaultSession.setProxy({ mode: 'direct' }),
      new Promise((resolve, reject) => setTimeout(() => reject(new Error('setProxy timeout')), 1500))
    ]);
  } catch (error) {
    logLine(`setProxy: ${error?.message || error}`);
  }
}

function createWindow() {
  const existing = getMainWindow();
  if (existing) {
    focusWindow(existing);
    return existing;
  }
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 650,
    title: '弹幕点歌姬',
    icon: WINDOW_ICON,
    show: true,
    center: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  focusWindow(win);
  win.on('close', () => {
    if (!app.isQuiting) quitApp();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    let parsed;
    try { parsed = new URL(url); } catch { return { action: 'deny' }; }
    if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) return { action: 'deny' };
    if (!parsed.pathname.includes('/overlay')) return { action: 'deny' };
    openOverlayWindow(url);
    return { action: 'deny' };
  });
  return win;
}

async function loadMainWindow(win) {
  if (!win || win.isDestroyed()) return;
  const target = process.env.MUSICHE_UI || API;
  try {
    await win.loadURL(target);
  } catch (error) {
    logLine(`loadURL: ${error?.message || error}`);
    await new Promise(resolve => setTimeout(resolve, 800));
    try {
      await win.loadURL(target);
    } catch (retryError) {
      dialog.showErrorBox('弹幕点歌姬', `窗口加载失败：${retryError?.message || error}\n请确认本机 API 已启动：${API}`);
    }
  }
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  logLine('ready');
  try {
    const win = createWindow();
    await setDirectProxy();
    await ensureApi();
    await loadMainWindow(win);
    focusWindow(win);
  } catch (error) {
    logLine(`startup: ${error?.message || error}`);
    dialog.showErrorBox('弹幕点歌姬启动失败', String(error?.message || error));
    quitApp();
  }
});

app.on('browser-window-created', (_event, win) => {
  const apply = () => {
    if (String(win.getTitle() || '').startsWith('捕获窗')) {
      stripWindowMenu(win);
      try { win.webContents.setBackgroundThrottling(false); } catch {}
    }
  };
  apply();
  win.on('page-title-updated', apply);
});

app.on('second-instance', () => {
  const win = getMainWindow() || createWindow();
  focusWindow(win);
});

app.on('window-all-closed', () => {
  quitApp();
});

app.on('before-quit', () => {
  quitApp();
});
