export type OverlayKind = 'static' | 'scroll';

export interface OverlayFormat {
  id: string;
  name: string;
  hint: string;
  detail: string;
  width: number;
  height: number;
  ratio: string;
  kind: OverlayKind;
}

export const OVERLAY_FORMATS: OverlayFormat[] = [
  { id: 'sidebar', name: '竖条队列', hint: '完整待播', detail: '画面侧边，当前曲 + 完整待播', width: 420, height: 780, ratio: '9:16 侧栏', kind: 'static' },
  { id: 'poster', name: '竖屏海报', hint: '大封面', detail: '手机竖屏，大封面 + 短队列', width: 480, height: 854, ratio: '9:16', kind: 'static' },
  { id: 'queue', name: '纯队列', hint: '只列待播', detail: '只要待播名单，适合塞角落', width: 360, height: 720, ratio: '1:2', kind: 'static' },
  { id: 'bar', name: '底栏横条', hint: '贴画面底', detail: '贴在画面底部，当前曲 + 接下来几首', width: 1280, height: 160, ratio: '8:1', kind: 'static' },
  { id: 'ticker', name: '细条标题', hint: '只显示当前', detail: '最省空间，只显示正在播放', width: 1280, height: 72, ratio: '16:0.9', kind: 'static' },
  { id: 'card', name: '横版卡片', hint: '适合画中画', detail: '16:9 当前曲大卡，适合画中画', width: 720, height: 405, ratio: '16:9', kind: 'static' },
  { id: 'scroll', name: '横滚字幕', hint: '横向滚动', detail: '小横条流式滚动：当前曲 + 接下来 3 首', width: 640, height: 56, ratio: '小横条', kind: 'scroll' },
  { id: 'scrollv', name: '竖滚字幕', hint: '向上滚动', detail: '窄竖条向上滚动：当前曲 + 接下来 3 首', width: 240, height: 320, ratio: '窄竖条', kind: 'scroll' },
  { id: 'flip', name: '片段横切', hint: '横滑切换', detail: '一首一首横滑进来，停一下再切下一首', width: 640, height: 64, ratio: '小横条', kind: 'scroll' },
  { id: 'flipv', name: '片段竖切', hint: '上滑切换', detail: '一首一首从下往上滑入，停一下再切', width: 260, height: 96, ratio: '小竖卡', kind: 'scroll' }
];

export const STATIC_OVERLAY_FORMATS = OVERLAY_FORMATS.filter(item => item.kind === 'static');
export const SCROLL_OVERLAY_FORMATS = OVERLAY_FORMATS.filter(item => item.kind === 'scroll');

export const OVERLAY_FORMAT_IDS = OVERLAY_FORMATS.map(item => item.id);

export type OverlayBgMode = 'color' | 'transparent' | 'image';
export interface OverlayBackground {
  mode: OverlayBgMode;
  color: string;
  opacity: number;
}
export const OVERLAY_BG_PRESETS = [
  { id: 'night', name: '深黑', color: '#0b0d12' },
  { id: 'gray', name: '深灰', color: '#22262f' },
  { id: 'green', name: '绿幕', color: '#00ff00' },
  { id: 'white', name: '白色', color: '#ffffff' }
];

const STORAGE_FORMAT = 'danmaku-overlay-format';
const STORAGE_TOP = 'danmaku-overlay-always-top';
const STORAGE_BG = 'danmaku-overlay-background';
const THEME_CHANNEL = 'danmaku-overlay-theme';
const BG_DB = 'danmaku-overlay';
const BG_STORE = 'files';
const BG_IMAGE_KEY = 'background-image';
const MAX_IMAGE_EDGE = 1600;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function defaultOverlayBackground(): OverlayBackground {
  return { mode: 'color', color: '#0b0d12', opacity: 100 };
}

function normalizeColor(value: unknown) {
  const text = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : '#0b0d12';
}

function normalizeOpacity(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeMode(value: unknown): OverlayBgMode {
  if (value === 'transparent' || value === 'image') return value;
  return 'color';
}

function openBgDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BG_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(BG_STORE)) req.result.createObjectStore(BG_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function readOverlayBackgroundImage(): Promise<string> {
  try {
    const db = await openBgDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(BG_STORE, 'readonly');
      const req = tx.objectStore(BG_STORE).get(BG_IMAGE_KEY);
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : '');
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return '';
  }
}

export async function saveOverlayBackgroundImage(dataUrl: string) {
  const db = await openBgDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BG_STORE, 'readwrite');
    tx.objectStore(BG_STORE).put(dataUrl, BG_IMAGE_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
  publishOverlayTheme();
}

export async function clearOverlayBackgroundImage() {
  try {
    const db = await openBgDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BG_STORE, 'readwrite');
      tx.objectStore(BG_STORE).delete(BG_IMAGE_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
  publishOverlayTheme();
}

export function compressOverlayImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error('图片不要超过 8MB'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let width = img.naturalWidth || 1;
      let height = img.naturalHeight || 1;
      if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE) {
        const scale = MAX_IMAGE_EDGE / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('无法处理图片'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取图片'));
    };
    img.src = url;
  });
}

export function readOverlayBackground(): OverlayBackground {
  const fallback = defaultOverlayBackground();
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_BG) || 'null');
    if (!raw || typeof raw !== 'object') return fallback;
    return {
      mode: normalizeMode(raw.mode),
      color: normalizeColor(raw.color),
      opacity: normalizeOpacity(raw.opacity)
    };
  } catch {
    return fallback;
  }
}

export function saveOverlayBackground(patch: Partial<OverlayBackground>) {
  const next = { ...readOverlayBackground(), ...patch };
  next.color = normalizeColor(next.color);
  next.opacity = normalizeOpacity(next.opacity);
  next.mode = normalizeMode(next.mode);
  try { localStorage.setItem(STORAGE_BG, JSON.stringify(next)); } catch {}
  publishOverlayTheme();
  return next;
}

let themeChannel: BroadcastChannel | null = null;
function getThemeChannel() {
  if (themeChannel) return themeChannel;
  try { themeChannel = new BroadcastChannel(THEME_CHANNEL); } catch { return null; }
  return themeChannel;
}

export function overlayBackgroundIsLight(bg: OverlayBackground) {
  if (bg.mode === 'transparent' || bg.mode === 'image' || bg.opacity < 55) return false;
  const n = parseInt(bg.color.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 168;
}

export function subscribeOverlayTheme(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_BG) callback();
  };
  window.addEventListener('storage', onStorage);
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(THEME_CHANNEL);
    channel.onmessage = () => callback();
  } catch {}
  return () => {
    window.removeEventListener('storage', onStorage);
    channel?.close();
  };
}

export function publishOverlayTheme() {
  try { getThemeChannel()?.postMessage({ type: 'theme' }); } catch {}
}

export function getOverlayFormat(id?: string | null): OverlayFormat {
  return OVERLAY_FORMATS.find(item => item.id === id) || OVERLAY_FORMATS[0];
}

export function readSavedOverlayFormat(): string {
  try {
    return getOverlayFormat(localStorage.getItem(STORAGE_FORMAT)).id;
  } catch {
    return OVERLAY_FORMATS[0].id;
  }
}

export function saveOverlayFormat(id: string) {
  try { localStorage.setItem(STORAGE_FORMAT, getOverlayFormat(id).id); } catch {}
}

export function readOverlayAlwaysOnTop(): boolean {
  try { return localStorage.getItem(STORAGE_TOP) === '1'; } catch { return false; }
}

export function saveOverlayAlwaysOnTop(value: boolean) {
  try { localStorage.setItem(STORAGE_TOP, value ? '1' : '0'); } catch {}
}

export function overlayWindowUrl(format: OverlayFormat, origin = location.origin, alwaysOnTop = false) {
  const bg = readOverlayBackground();
  const query = new URLSearchParams({
    w: String(format.width),
    h: String(format.height),
    title: `捕获窗 · ${format.name}`,
    top: alwaysOnTop ? '1' : '0',
    clear: bg.mode === 'transparent' ? '1' : '0',
    bg: bg.color
  });
  return `${origin}/overlay/${format.id}?${query.toString()}`;
}

export function openOverlayWindow(formatId: string, alwaysOnTop = false) {
  const format = getOverlayFormat(formatId);
  saveOverlayFormat(format.id);
  const features = [
    `width=${format.width}`,
    `height=${format.height}`,
    'menubar=no',
    'toolbar=no',
    'location=no',
    'status=no',
    'resizable=yes',
    alwaysOnTop ? 'alwaysOnTop=yes' : ''
  ].filter(Boolean).join(',');
  const popup = window.open(overlayWindowUrl(format, location.origin, alwaysOnTop), `danmaku-overlay-${format.id}`, features);
  popup?.focus();
  return Boolean(popup);
}
