import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import { qqQrStart, qqQrPoll, upgradeQqMusicCookie, hasQqMusicKey } from './qq-login.mjs';
import { biliQrStart, biliQrPoll } from './bili-login.mjs';
import { cloudQrStart, cloudQrPoll } from './cloud-login.mjs';
import { miguQrStart, miguQrPoll } from './migu-login.mjs';
import { DanmakuClient, extractRoomId } from './bili-danmaku.mjs';
import { createCommandHandler, DEFAULT_COMMAND_CONFIG } from './bili-command.mjs';
import { migrate } from './schema.mjs';
import { HaltedError, persistableSong } from './qq-provider.mjs';
import { lookupCatalog, lyricFor, normalizeSources, parseBvid, playUrlFor, searchCatalog, songKey } from './sources.mjs';
import { biliCoverSource, biliRequestHeaders, resolveBiliAudioUrl } from './bili-provider.mjs';
import { createQueue } from './queue.mjs';
import {
  emptyGiftRequest,
  fetchBiliGifts,
  giftQualifies,
  normalizeCountMode,
  normalizeExpireSec,
  normalizeGiftRequest,
  normalizeQualifyMode,
  normalizeSkipAction,
  normalizeThreshold,
  parseDanmakuGift,
  qualifyConfigured,
  qualifyHint,
  reconcileGiftRequest,
  requestCreditGrant
} from './bili-gifts.mjs';
import { normalizeSongBlacklist } from './song-blacklist.mjs';
import { accountProfile, listPlaylists, normalizeSource, playlistDetail } from './user-playlists.mjs';
import { createFileLog } from './file-log.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.MUSICHE_DATA || path.join(ROOT, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const fileLog = createFileLog(DATA_DIR);
const db = new DatabaseSync(path.join(DATA_DIR, 'musiche-danmaku.sqlite'));
migrate(db);

const SESSION_KEY = crypto.createHash('sha256').update(process.env.MUSICHE_SESSION_SECRET || 'musiche-danmaku-local-secret').digest();
const qqLoginSessions = new Map();
const biliLoginSessions = new Map();
const cloudLoginSessions = new Map();
const miguLoginSessions = new Map();
const commandCfg = { ...DEFAULT_COMMAND_CONFIG };
const danmaku = new DanmakuClient();
function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SESSION_KEY, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${data.toString('base64')}`;
}
function decryptSecret(value) {
  const [iv, tag, data] = String(value || '').split('.').map(x => Buffer.from(x, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', SESSION_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

const sse = new Set();
const logs = [];
const FAILURE_THRESHOLD = 5;
const state = {
  version: 1,
  playing: false,
  loading: false,
  currentTime: 0,
  duration: 0,
  positionMs: 0,
  durationMs: 0,
  updatedAt: Date.now(),
  volume: 100,
  mode: 'loop',
  current: null,
  consecutiveFailures: 0,
  accepting: true,
  sinkMode: 'local',
  settingsRevision: 1,
  autoConnect: false,
  biliRoom: '',
  logRetentionDays: 14,
  logMaxMb: 32,
  enabledSources: ['qq'],
  giftRequestEnabled: false,
  giftRequest: emptyGiftRequest(),
  giftRequestQualifyMode: 'specific',
  giftRequestThreshold: 0,
  giftRequestCountMode: 'once',
  giftSkipEnabled: false,
  giftSkipAction: 'instant',
  giftSkipExpireSec: 300,
  giftSkipQualifyMode: 'specific',
  giftSkipGift: emptyGiftRequest(),
  giftSkipThreshold: 0,
  songBlacklistEnabled: false,
  songBlacklist: [],
  idlePlaylistEnabled: false,
  idlePlaylist: null,
  connection: {
    state: 'idle',
    roomId: 0,
    lastPacketAt: 0,
    retryCount: 0,
    detail: '未扫码登录 B站，拒绝连接弹幕'
  }
};
const {
  mapQueueRow,
  consumeCurrentFromQueue,
  queueNext,
  startQueuedIfIdle,
  enqueueSong,
  topQueue,
  removeQueue,
  skipQueue
} = createQueue({
  db,
  getState: () => state,
  snapshot: () => snapshot(),
  broadcast: (event, data) => broadcast(event, data),
  setPlayback: (partial, eventName) => setPlayback(partial, eventName),
  log: (message, level) => log(message, level)
});
const commandHandler = createCommandHandler({
  getConfig: () => commandCfg,
  getAccepting: () => state.accepting,
  setAccepting: value => {
    state.accepting = Boolean(value);
    persistSetting('accepting', state.accepting);
    broadcast('snapshot', snapshot());
  },
  getQueue: () => snapshot().queue,
  getCurrent: () => state.current,
  enqueue: (song, mode) => enqueueSong(song, mode),
  top: (keyword, user) => topQueue(keyword, user),
  remove: (keyword, user) => removeQueue(keyword, user),
  skip: user => skipQueue(user),
  search: async (keyword, sources) => (await searchCatalog(keyword, 15, { ...sourceExtras(), sources: sources || sourceExtras().sources })).list,
  lookup: async (platform, id) => lookupCatalog(platform, id, sourceExtras()),
  log: (message, level = 'info') => log(message, level),
  isGiftRequestEnabled: () => Boolean(state.giftRequestEnabled),
  getRequiredGift: () => state.giftRequest,
  getGiftRequestHint: () => qualifyHint({
    mode: state.giftRequestQualifyMode,
    required: state.giftRequest,
    threshold: state.giftRequestThreshold
  }),
  isGiftRequestReady: () => qualifyConfigured(state.giftRequestQualifyMode, state.giftRequest, state.giftRequestThreshold),
  hasGiftCredit: uid => giftCreditCount(uid) > 0,
  consumeGiftCredit: uid => consumeGiftCredit(uid),
  refundGiftCredit: uid => addGiftCredits(uid, '', 1),
  isGiftSkipCreditEnabled: () => Boolean(state.giftSkipEnabled && state.giftSkipAction === 'credit'),
  hasSkipCredit: uid => skipCreditCount(uid) > 0,
  consumeSkipCredit: uid => consumeSkipCredit(uid),
  isRoomOwner: uid => Boolean(viewerKey(uid) && viewerKey(uid) === viewerKey(danmaku.ownerUid)),
  isSongBlacklistEnabled: () => Boolean(state.songBlacklistEnabled),
  getSongBlacklist: () => state.songBlacklist
});
danmaku.on('status', (s, meta) => {
  state.connection = {
    state: s,
    roomId: danmaku.roomId || 0,
    lastPacketAt: danmaku.lastPacketAt || 0,
    retryCount: meta.retryCount || danmaku.retryCount || 0,
    detail: meta.detail || ''
  };
  log(`B站 ${s}${meta.detail ? `：${meta.detail}` : ''}`, s === 'failed' ? 'error' : 'info');
  broadcast('conn', state.connection);
  broadcast('snapshot', snapshot());
});
danmaku.on('danmaku', user => {
  const msg = String(user.msg || '').trim();
  if (/^(点歌|立即点歌|插队点歌|置顶点歌|移除|置顶|优先|切歌|跳过|开启点歌|关闭点歌)/.test(msg)) {
    log(`[弹幕] ${user.name || '观众'}: ${msg}`);
  }
  commandHandler.handle(user).catch(error => log(error?.message || String(error), 'error'));
});
const recentGiftTids = new Map();
function seenGiftTid(tid) {
  if (!tid) return false;
  const now = Date.now();
  for (const [key, at] of recentGiftTids) {
    if (now - at > 120000) recentGiftTids.delete(key);
  }
  if (recentGiftTids.has(tid)) return true;
  recentGiftTids.set(tid, now);
  return false;
}
function viewerKey(uid) {
  const key = String(uid ?? '').trim();
  if (!key || key === '0' || key === 'undefined' || key === 'null') return '';
  return key;
}
function giftCreditCount(uid) {
  const key = viewerKey(uid);
  if (!key) return 0;
  const row = db.prepare('SELECT credits FROM gift_credits WHERE uid=?').get(key);
  return Number(row?.credits || 0);
}
function addGiftCredits(uid, name, count) {
  const key = viewerKey(uid);
  const n = Math.floor(Number(count) || 0);
  if (!key || n <= 0) return giftCreditCount(uid);
  const next = giftCreditCount(key) + n;
  db.prepare(`INSERT INTO gift_credits(uid,name,credits,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(uid) DO UPDATE SET name=CASE WHEN excluded.name='' THEN gift_credits.name ELSE excluded.name END, credits=excluded.credits, updated_at=excluded.updated_at`)
    .run(key, String(name || ''), next, Date.now());
  return next;
}
function consumeGiftCredit(uid) {
  const key = viewerKey(uid);
  if (!key) return false;
  const changed = db.prepare('UPDATE gift_credits SET credits = credits - 1, updated_at=? WHERE uid=? AND credits > 0').run(Date.now(), key);
  if (!changed.changes) return false;
  db.prepare('DELETE FROM gift_credits WHERE uid=? AND credits <= 0').run(key);
  return true;
}
function purgeSkipLots(uid) {
  const key = viewerKey(uid);
  if (!key) return;
  db.prepare('DELETE FROM gift_skip_lots WHERE uid=? AND (credits<=0 OR expires_at<=?)').run(key, Date.now());
}
function skipCreditCount(uid) {
  const key = viewerKey(uid);
  if (!key) return 0;
  purgeSkipLots(key);
  return Number(db.prepare('SELECT COALESCE(SUM(credits),0) n FROM gift_skip_lots WHERE uid=?').get(key).n || 0);
}
function addSkipCredits(uid, name, count) {
  const key = viewerKey(uid);
  const n = Math.floor(Number(count) || 0);
  if (!key || n <= 0) return skipCreditCount(uid);
  const now = Date.now();
  db.prepare('INSERT INTO gift_skip_lots(uid,name,credits,expires_at,created_at) VALUES(?,?,?,?,?)')
    .run(key, String(name || ''), n, now + state.giftSkipExpireSec * 1000, now);
  return skipCreditCount(key);
}
function consumeSkipCredit(uid) {
  const key = viewerKey(uid);
  if (!key) return false;
  purgeSkipLots(key);
  const row = db.prepare('SELECT id,credits FROM gift_skip_lots WHERE uid=? ORDER BY expires_at,id LIMIT 1').get(key);
  if (!row) return false;
  if (Number(row.credits) <= 1) db.prepare('DELETE FROM gift_skip_lots WHERE id=?').run(row.id);
  else db.prepare('UPDATE gift_skip_lots SET credits=credits-1 WHERE id=?').run(row.id);
  return true;
}
danmaku.on('gift', doc => {
  if (!state.giftRequestEnabled && !state.giftSkipEnabled) return;
  const gift = parseDanmakuGift(doc);
  const uid = viewerKey(gift?.uid);
  if (!uid) return;
  if (seenGiftTid(gift.tid)) return;
  const owner = Boolean(viewerKey(danmaku.ownerUid) && uid === viewerKey(danmaku.ownerUid));
  if (state.giftRequestEnabled && !owner) {
    const granted = requestCreditGrant(gift, {
      mode: state.giftRequestQualifyMode,
      required: state.giftRequest,
      threshold: state.giftRequestThreshold,
      countMode: state.giftRequestCountMode
    });
    if (granted > 0) {
      const credits = addGiftCredits(uid, gift.name, granted);
      const via = qualifyHint({ mode: state.giftRequestQualifyMode, required: state.giftRequest, threshold: state.giftRequestThreshold });
      log(`[礼物] ${gift.name || uid} 赠送「${gift.giftName}」x${gift.num}（${giftBatteriesLabel(gift)}），获得 ${granted} 次点歌（${via}，剩余 ${credits}）`);
    }
  }
  if (state.giftSkipEnabled && !owner && giftQualifies(gift, {
    mode: state.giftSkipQualifyMode,
    required: state.giftSkipGift,
    threshold: state.giftSkipThreshold
  })) {
    if (state.giftSkipAction === 'credit') {
      const left = addSkipCredits(uid, gift.name, 1);
      log(`[礼物切歌] ${gift.name || uid} 获得 1 次切歌，${state.giftSkipExpireSec}s 内有效（剩余 ${left}）`);
    } else if (!state.current) {
      log(`[礼物切歌] ${gift.name || uid} 赠送「${gift.giftName}」，当前没有正在播放的歌曲`);
    } else {
      log(`[礼物切歌] ${gift.name || uid} 赠送「${gift.giftName}」，当场切歌`);
      skipQueue({ name: gift.name, uid });
    }
  }
});
function giftBatteriesLabel(gift) {
  const n = Number(gift?.batteries || 0);
  return n > 0 ? `${n} 电池` : '非金瓜子';
}
let giftCatalog = { list: [], fetchedAt: 0 };
async function refreshGiftCatalog({ force = false } = {}) {
  const now = Date.now();
  if (!force && giftCatalog.list.length && now - giftCatalog.fetchedAt < 60 * 1000) return giftCatalog;
  const account = biliAccount();
  if (!account?.cookie) throw new Error('未扫码登录 B站，无法获取礼物列表');
  const list = await fetchBiliGifts({
    cookie: account.cookie,
    roomId: danmaku.roomId || extractRoomId(state.biliRoom) || 0,
    parentAreaId: danmaku.parentAreaId || 0,
    areaId: danmaku.areaId || 0
  });
  giftCatalog = { list, fetchedAt: now };
  const result = reconcileGiftRequest(state.giftRequest, list);
  if (result.changed) {
    state.giftRequest = result.gift;
    persistSetting('giftRequest', state.giftRequest);
    broadcast('snapshot', snapshot());
    log(`[系统] 已按 B站最新礼物校准点歌礼物「${state.giftRequest.giftName}」`);
  } else if (result.missing && (state.giftRequest.giftId || state.giftRequest.giftName)) {
    log(`[警告] 点歌指定礼物「${state.giftRequest.giftName || state.giftRequest.giftId}」未出现在最新列表，送礼仍按名称或 ID 匹配`, 'error');
  }
  const skipResult = reconcileGiftRequest(state.giftSkipGift, list);
  if (skipResult.changed) {
    state.giftSkipGift = skipResult.gift;
    persistSetting('giftSkipGift', state.giftSkipGift);
    broadcast('snapshot', snapshot());
    log(`[系统] 已按 B站最新礼物校准切歌礼物「${state.giftSkipGift.giftName}」`);
  }
  return { ...giftCatalog, missing: result.missing, skipMissing: skipResult.missing };
}

function log(message, level = 'info') {
  const item = { message, level, at: Date.now() };
  logs.push(item);
  if (logs.length > 300) logs.shift();
  try { fileLog.append(item); } catch {}
  broadcast('log', item);
}
function eventPayload(data) {
  return { version: 1, eventId: crypto.randomUUID(), ...data };
}
function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(eventPayload(data))}\n\n`;
  for (const res of sse) {
    try { res.write(frame); } catch { sse.delete(res); }
  }
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}
function failProxy(res, error) {
  const message = error?.cause?.message || error?.message || String(error || 'B站资源获取失败');
  log(message, 'error');
  if (!res.headersSent) return json(res, 502, { error: message });
  try { res.destroy(); } catch {}
}
function pipeWebStream(req, res, body) {
  const stream = Readable.fromWeb(body);
  const fail = () => {
    try { stream.destroy(); } catch {}
    try { if (!res.writableEnded) res.destroy(); } catch {}
  };
  stream.on('error', error => {
    log(error?.cause?.message || error?.message || error, 'error');
    fail();
  });
  res.on('error', fail);
  req.on('close', fail);
  stream.pipe(res);
}
const WEB_DIST = path.join(ROOT, '..', 'web', 'dist');
function mimeOf(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js') || file.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json') || file.endsWith('.map')) return 'application/json; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
  if (file.endsWith('.webp')) return 'image/webp';
  if (file.endsWith('.woff2')) return 'font/woff2';
  if (file.endsWith('.woff')) return 'font/woff';
  if (file.endsWith('.ico')) return 'image/x-icon';
  return 'application/octet-stream';
}
function serveWeb(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (url.pathname.startsWith('/api/')) return false;
  if (!fs.existsSync(WEB_DIST)) return false;
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = 'index.html';
  rel = rel.replace(/^[/\\]+/, '');
  const root = path.normalize(WEB_DIST);
  const file = path.normalize(path.join(root, rel));
  if (file !== root && !file.startsWith(root + path.sep)) {
    json(res, 403, { error: 'forbidden' });
    return true;
  }
  const send = target => {
    res.writeHead(200, { 'Content-Type': mimeOf(target), 'Access-Control-Allow-Origin': '*' });
    if (req.method === 'HEAD') { res.end(); return true; }
    fs.createReadStream(target).pipe(res);
    return true;
  };
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return send(file);
  const index = path.join(root, 'index.html');
  if (fs.existsSync(index)) return send(index);
  return false;
}
async function body(req) {
  let text = '';
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : {};
}

function publicApiBase() {
  return `http://127.0.0.1:${Number(process.env.PORT || 54821)}/api/v1`;
}

function withBiliCover(song) {
  if (!song || (song.type !== 'bili' && song.platform !== 'bili')) return song;
  const bvid = parseBvid(song.id) || song.id;
  if (!bvid) return song;
  const cover = `${publicApiBase()}/songs/bili/${encodeURIComponent(bvid)}/cover`;
  return { ...song, image: cover, mediumImage: cover, largeImage: cover, coverUrl: cover };
}

function snapshot() {
  const queued = db.prepare("SELECT id,song_id,song_json,requester,requested_by_uid,position,status,created_at FROM queue_items WHERE status='queued' ORDER BY position,id").all().map(row => withBiliCover(mapQueueRow(row)));
  const history = db.prepare('SELECT id,song_json,requester,played_at FROM play_history ORDER BY played_at DESC LIMIT 100').all().map(x => withBiliCover({
    ...persistableSong(JSON.parse(x.song_json)),
    historyId: x.id,
    requester: x.requester,
    playedAt: x.played_at
  }));
  const current = state.current ? withBiliCover(persistableSong(state.current)) : null;
  return {
    version: 1,
    connection: state.connection,
    playback: {
      playing: state.playing,
      loading: state.loading,
      positionMs: state.positionMs,
      durationMs: state.durationMs,
      updatedAt: state.updatedAt
    },
    current,
    queue: queued,
    history,
    accepting: state.accepting,
    giftRequestEnabled: Boolean(state.giftRequestEnabled),
    giftRequest: normalizeGiftRequest(state.giftRequest),
    giftRequestQualifyMode: normalizeQualifyMode(state.giftRequestQualifyMode),
    giftRequestThreshold: normalizeThreshold(state.giftRequestThreshold),
    giftRequestCountMode: normalizeCountMode(state.giftRequestCountMode),
    giftSkipEnabled: Boolean(state.giftSkipEnabled),
    giftSkipAction: normalizeSkipAction(state.giftSkipAction),
    giftSkipExpireSec: normalizeExpireSec(state.giftSkipExpireSec),
    giftSkipQualifyMode: normalizeQualifyMode(state.giftSkipQualifyMode),
    giftSkipGift: normalizeGiftRequest(state.giftSkipGift),
    giftSkipThreshold: normalizeThreshold(state.giftSkipThreshold),
    songBlacklistEnabled: Boolean(state.songBlacklistEnabled),
    songBlacklist: normalizeSongBlacklist(state.songBlacklist),
    idlePlaylistEnabled: Boolean(state.idlePlaylistEnabled),
    idlePlaylist: normalizeIdlePlaylist(state.idlePlaylist),
    biliRoom: String(state.biliRoom || ''),
    sinkMode: state.sinkMode,
    settingsRevision: state.settingsRevision,
    enabledSources: normalizeSources(state.enabledSources),
    playing: state.playing,
    loading: state.loading,
    currentTime: state.currentTime,
    duration: state.duration,
    volume: state.volume,
    mode: state.mode,
    consecutiveFailures: state.consecutiveFailures,
    extensions: {}
  };
}

function markPlaybackFailure(song, reason) {
  state.consecutiveFailures += 1;
  state.playing = false;
  state.loading = false;
  log(`歌曲「${song?.name || '未知'}」播放失败：${reason || '未知原因'}（连续 ${state.consecutiveFailures} 次）`, 'error');
  const row = song?.queueId ? song.queueId : null;
  if (row) {
    db.prepare("UPDATE queue_items SET status='failed', failure_code=?, updated_at=? WHERE id=?").run(String(reason || 'play_url'), Date.now(), row);
  }
  const failedKey = songKey(song);
  const queuedLeft = snapshot().queue.filter(item => songKey(item) !== failedKey).length;
  const halt = state.consecutiveFailures >= FAILURE_THRESHOLD && queuedLeft === 0;
  if (halt) log(`连续失败达到 ${FAILURE_THRESHOLD} 次，且没有待播点歌，已暂停自动跳过`, 'error');
  const snap = snapshot();
  broadcast('error', { code: 'playback_failed', message: reason || '播放失败', recoverable: !halt, songId: song?.id || '' });
  broadcast('snapshot', snap);
  return { skipped: queuedLeft > 0 || Boolean(row), paused: halt, next: halt ? null : queueNext(true) };
}

function sourceAccount(table) {
  const row = db.prepare(`SELECT uid,name,remember_login,updated_at,cookie_ciphertext FROM ${table} WHERE id=1`).get();
  if (!row) return null;
  let cookie = '';
  try { cookie = row.cookie_ciphertext ? decryptSecret(row.cookie_ciphertext) : ''; }
  catch { log(`${table} 登录凭据解密失败，已视为未登录`, 'error'); }
  return { uid: row.uid, name: row.name || '', cookie, rememberLogin: Boolean(row.remember_login), updatedAt: row.updated_at };
}
function sourceAccountStatus(table) {
  const row = sourceAccount(table);
  return row?.cookie
    ? { loggedIn: true, uid: row.uid ? `${String(row.uid).slice(0, 2)}****` : '', name: row.name, rememberLogin: row.rememberLogin, updatedAt: row.updatedAt }
    : { loggedIn: false, uid: '', name: '', rememberLogin: false };
}
function cloudAccount() { return sourceAccount('cloud_accounts'); }
function miguAccount() { return sourceAccount('migu_accounts'); }
function cloudAccountStatus() { return sourceAccountStatus('cloud_accounts'); }
function miguAccountStatus() { return sourceAccountStatus('migu_accounts'); }
function sourceExtras() {
  const cloud = cloudAccount();
  const migu = miguAccount();
  const bili = biliAccount();
  return {
    sources: state.enabledSources,
    qqLoggedIn: qqAccountStatus().loggedIn,
    cloudLoggedIn: Boolean(cloud?.cookie),
    cloudCookie: cloud?.cookie || '',
    miguLoggedIn: Boolean(migu?.cookie),
    miguCookie: migu?.cookie || '',
    miguUid: migu?.uid || '',
    biliLoggedIn: Boolean(bili?.cookie),
    biliCookie: bili?.cookie || ''
  };
}

async function proxyBiliAudio(req, res, rawId) {
  try {
    const extras = sourceExtras();
    const current = persistableSong(state.current);
    const id = parseBvid(rawId) || String(rawId || '').trim();
    const resolved = await resolveBiliAudioUrl(id, {
      ...extras,
      contentId: new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('contentId')
        || (current && (parseBvid(current.id) === id) ? current.contentId : '')
        || ''
    });
    if (!resolved.url) return json(res, 502, { error: resolved.error || '无法获取 B站音频' });
    const headers = biliRequestHeaders(extras.biliCookie || '');
    if (req.headers.range) headers.Range = req.headers.range;
    const upstream = await fetch(resolved.url, { headers });
    if (!upstream.ok && upstream.status !== 206) {
      return json(res, 502, { error: resolved.error || `B站音频 HTTP ${upstream.status}` });
    }
    const out = {
      'Content-Type': upstream.headers.get('content-type') || 'audio/mp4',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
      'Cache-Control': 'no-store'
    };
    const len = upstream.headers.get('content-length');
    const range = upstream.headers.get('content-range');
    const accept = upstream.headers.get('accept-ranges');
    if (len) out['Content-Length'] = len;
    if (range) out['Content-Range'] = range;
    out['Accept-Ranges'] = accept || 'bytes';
    res.writeHead(upstream.status, out);
    if (req.method === 'HEAD' || !upstream.body) {
      res.end();
      return true;
    }
    pipeWebStream(req, res, upstream.body);
    return true;
  } catch (error) {
    failProxy(res, error);
    return false;
  }
}

async function proxyBiliCover(req, res, rawId) {
  try {
    const extras = sourceExtras();
    const resolved = await biliCoverSource(rawId, extras);
    if (!resolved.url) return json(res, 404, { error: resolved.error || '没有封面' });
    const upstream = await fetch(resolved.url, { headers: biliRequestHeaders(extras.biliCookie || '') });
    if (!upstream.ok || !upstream.body) return json(res, 502, { error: `B站封面 HTTP ${upstream.status}` });
    const out = {
      'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400'
    };
    const len = upstream.headers.get('content-length');
    if (len) out['Content-Length'] = len;
    res.writeHead(200, out);
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    pipeWebStream(req, res, upstream.body);
    return true;
  } catch (error) {
    failProxy(res, error);
    return false;
  }
}

function normalizeIdlePlaylist(value) {
  if (!value || typeof value !== 'object') return null;
  const source = normalizeSource(value.source || value.type);
  const id = String(value.id || '').trim();
  if (!source || !id) return null;
  return {
    source,
    id,
    name: String(value.name || ''),
    image: String(value.image || '')
  };
}

function sourceAccountFor(source) {
  if (source === 'qq') {
    const row = qqAccount();
    return row?.cookie ? { uid: row.uin || '', uin: row.uin || '', name: '', cookie: row.cookie } : null;
  }
  if (source === 'cloud') return cloudAccount();
  if (source === 'migu') return miguAccount();
  return null;
}

let meProfileCache = { at: 0, list: null };
function localMeAccount(source) {
  const account = sourceAccountFor(source);
  if (!account?.cookie) return { source, loggedIn: false, uid: '', name: '', image: '' };
  const cached = Array.isArray(meProfileCache.list) ? meProfileCache.list.find(item => item.source === source) : null;
  return {
    source,
    loggedIn: true,
    uid: String(account.uid || account.uin || cached?.uid || ''),
    name: account.name || cached?.name || '',
    image: cached?.image || ''
  };
}
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallback), ms))
  ]);
}
async function meAccounts({ force = false } = {}) {
  const now = Date.now();
  if (!force && meProfileCache.list && now - meProfileCache.at < 5 * 60 * 1000) return meProfileCache.list;
  const sources = ['cloud', 'qq', 'migu'];
  const locals = sources.map(localMeAccount);
  const pending = Promise.all(sources.map(async (source, index) => {
    const account = sourceAccountFor(source);
    const fallback = locals[index];
    if (!account?.cookie) return fallback;
    try { return await withTimeout(accountProfile(source, account), 1500, fallback); }
    catch { return fallback; }
  })).then(list => {
    meProfileCache = { at: Date.now(), list };
    return list;
  });
  if (!force && meProfileCache.list) {
    pending.catch(() => {});
    return meProfileCache.list;
  }
  return pending;
}

function qqAccount() {
  const row = db.prepare('SELECT uin,remember_login,updated_at,cookie_ciphertext FROM qq_accounts WHERE id=1').get();
  return row ? { uin: row.uin, cookie: row.cookie_ciphertext ? decryptSecret(row.cookie_ciphertext) : '', rememberLogin: Boolean(row.remember_login), updatedAt: row.updated_at } : null;
}
function qqAccountStatus() {
  const row = qqAccount();
  return row ? { loggedIn: true, uin: row.uin ? `${String(row.uin).slice(0, 3)}****` : '', rememberLogin: row.rememberLogin, updatedAt: row.updatedAt, musicLogin: hasQqMusicKey(row.cookie) } : { loggedIn: false, uin: '', rememberLogin: false, musicLogin: false };
}

let qqMusicUpgradeTried = false;
async function ensureQqMusicAccount() {
  const account = qqAccount();
  if (!account?.cookie || hasQqMusicKey(account.cookie) || qqMusicUpgradeTried) return account;
  qqMusicUpgradeTried = true;
  try {
    const upgraded = await upgradeQqMusicCookie(account.cookie);
    if (!upgraded.cookie) {
      log('当前 QQ 登录未换到音乐 Cookie，VIP 曲可能无法播放；请重新扫码', 'error');
      return account;
    }
    const now = Date.now();
    db.prepare('INSERT INTO qq_accounts(id,uin,cookie_ciphertext,remember_login,created_at,updated_at) VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET uin=excluded.uin,cookie_ciphertext=excluded.cookie_ciphertext,remember_login=excluded.remember_login,updated_at=excluded.updated_at')
      .run(upgraded.uin || account.uin || '', encryptSecret(upgraded.cookie), 1, now, now);
    log('已补全 QQ 音乐登录 Cookie');
    return qqAccount();
  } catch (error) {
    log(`补全 QQ 音乐登录失败：${error?.message || error}`, 'error');
    return account;
  }
}

function biliAccount() {
  const row = db.prepare('SELECT uid,remember_login,updated_at,cookie_ciphertext FROM bili_accounts WHERE id=1').get();
  if (!row) return null;
  let cookie = '';
  try { cookie = row.cookie_ciphertext ? decryptSecret(row.cookie_ciphertext) : ''; }
  catch { log('B站登录凭据解密失败，已视为未登录', 'error'); }
  return { uid: row.uid, cookie, rememberLogin: Boolean(row.remember_login), updatedAt: row.updated_at };
}
function biliAccountStatus() {
  const row = biliAccount();
  return row?.cookie
    ? { loggedIn: true, uid: row.uid ? `${String(row.uid).slice(0, 2)}****` : '', rememberLogin: row.rememberLogin, updatedAt: row.updatedAt }
    : { loggedIn: false, uid: '', rememberLogin: false };
}

async function connectBiliRoom(input) {
  const account = biliAccount();
  if (!account?.cookie) {
    state.connection = { state: 'failed', roomId: 0, lastPacketAt: 0, retryCount: 0, detail: '未扫码登录 B站，拒绝连接弹幕（匿名弹幕不恢复）' };
    log(state.connection.detail, 'error');
    broadcast('conn', state.connection);
    broadcast('snapshot', snapshot());
    return { ok: false, error: state.connection.detail, connection: state.connection };
  }
  danmaku.setCredential(account.cookie, account.uid);
  persistSetting('biliRoom', String(input || ''));
  const roomId = extractRoomId(input);
  if (Number.isFinite(roomId) && roomId > 0) {
    db.prepare('INSERT INTO rooms(room_id,name,last_connected_at,auto_connect,created_at) VALUES(?,?,?,?,?) ON CONFLICT(room_id) DO UPDATE SET last_connected_at=excluded.last_connected_at')
      .run(String(roomId), '', Date.now(), state.autoConnect ? 1 : 0, Date.now());
  }
  const ok = await danmaku.connect(input);
  if (ok) refreshGiftCatalog({ force: true }).catch(error => log(`礼物列表刷新失败：${error.message}`, 'error'));
  return { ok, connection: state.connection, error: ok ? '' : state.connection.detail };
}

function persistSetting(key, value) {
  state.settingsRevision += 1;
  db.prepare('INSERT INTO app_settings(key,value,updated_at,revision) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,revision=excluded.revision').run(key, JSON.stringify(value), Date.now(), state.settingsRevision);
}
function loadSettings() {
  for (const row of db.prepare('SELECT key,value FROM app_settings').all()) {
    try {
      const parsed = JSON.parse(row.value);
      if (row.key === 'current') state.current = persistableSong(parsed);
      else if (row.key === 'commandConfig') Object.assign(commandCfg, parsed);
      else if (row.key === 'enabledSources') state.enabledSources = normalizeSources(parsed);
      else if (row.key === 'giftRequest') state.giftRequest = normalizeGiftRequest(parsed);
      else if (row.key === 'giftRequestEnabled') state.giftRequestEnabled = Boolean(parsed);
      else if (row.key === 'giftRequestQualifyMode') state.giftRequestQualifyMode = normalizeQualifyMode(parsed);
      else if (row.key === 'giftRequestThreshold') state.giftRequestThreshold = normalizeThreshold(parsed);
      else if (row.key === 'giftRequestCountMode') state.giftRequestCountMode = normalizeCountMode(parsed);
      else if (row.key === 'giftSkipEnabled') state.giftSkipEnabled = Boolean(parsed);
      else if (row.key === 'giftSkipAction') state.giftSkipAction = normalizeSkipAction(parsed);
      else if (row.key === 'giftSkipExpireSec') state.giftSkipExpireSec = normalizeExpireSec(parsed);
      else if (row.key === 'giftSkipQualifyMode') state.giftSkipQualifyMode = normalizeQualifyMode(parsed);
      else if (row.key === 'giftSkipGift') state.giftSkipGift = normalizeGiftRequest(parsed);
      else if (row.key === 'giftSkipThreshold') state.giftSkipThreshold = normalizeThreshold(parsed);
      else if (row.key === 'songBlacklistEnabled') state.songBlacklistEnabled = Boolean(parsed);
      else if (row.key === 'songBlacklist') state.songBlacklist = normalizeSongBlacklist(parsed);
      else if (row.key === 'idlePlaylistEnabled') state.idlePlaylistEnabled = Boolean(parsed);
      else if (row.key === 'idlePlaylist') state.idlePlaylist = normalizeIdlePlaylist(parsed);
      else if (row.key in state) state[row.key] = parsed;
    } catch {}
  }
}
loadSettings();
fileLog.setLimits({ retentionDays: state.logRetentionDays, maxMb: state.logMaxMb });
if (!db.prepare("SELECT 1 FROM queue_items WHERE status='queued' LIMIT 1").get()) {
  state.current = null;
  state.playing = false;
  persistSetting('current', null);
}

function asMediaMs(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 10000 ? Math.round(n) : Math.round(n * 1000);
}

function setPlayback(partial, eventName) {
  Object.assign(state, partial);
  state.updatedAt = Date.now();
  const durationMs = asMediaMs(state.durationMs || state.duration);
  if (durationMs) {
    state.durationMs = durationMs;
    state.duration = durationMs / 1000;
  }
  state.positionMs = Math.round(Number(state.currentTime || 0) * 1000);
  persistSetting('current', persistableSong(state.current));
  persistSetting('mode', state.mode);
  db.prepare(`INSERT INTO playback_state(id,current_queue_id,mode,playing,position_ms,duration_ms,updated_at,revision)
    VALUES(1,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET current_queue_id=excluded.current_queue_id,mode=excluded.mode,playing=excluded.playing,position_ms=excluded.position_ms,duration_ms=excluded.duration_ms,updated_at=excluded.updated_at,revision=excluded.revision`)
    .run(state.current?.queueId || null, state.mode, state.playing ? 1 : 0, state.positionMs, state.durationMs, state.updatedAt, state.settingsRevision);
  if (eventName) broadcast(eventName, snapshot());
  else broadcast('snapshot', snapshot());
}

export function createServer(port = Number(process.env.PORT || 54821)) {
  return import('node:http').then(({ createServer }) => {
    const server = createServer(async (req, res) => {
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

      if (url.pathname === '/api/v1/qq/account' && req.method === 'GET') return json(res, 200, qqAccountStatus());
      if (url.pathname === '/api/v1/qq/login/start' && req.method === 'POST') {
        const qr = await qqQrStart();
        const id = crypto.randomUUID();
        qqLoginSessions.set(id, { qrsig: qr.qrsig, createdAt: Date.now() });
        const payload = { sessionId: id, image: qr.image, expiresIn: 180 };
        broadcast('qr', { status: 'waiting', expiresIn: 180 });
        return json(res, 200, payload);
      }
      if (url.pathname === '/api/v1/qq/login/poll' && req.method === 'POST') {
        const b = await body(req);
        const session = qqLoginSessions.get(String(b.sessionId || ''));
        if (!session || Date.now() - session.createdAt > 180000) return json(res, 410, { status: 'expired', message: 'QQ二维码已过期' });
        const result = await qqQrPoll(session.qrsig);
        if (result.status === 'success') {
          const now = Date.now();
          db.prepare('INSERT INTO qq_accounts(id,uin,cookie_ciphertext,remember_login,created_at,updated_at) VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET uin=excluded.uin,cookie_ciphertext=excluded.cookie_ciphertext,remember_login=excluded.remember_login,updated_at=excluded.updated_at').run(result.uin || '', encryptSecret(result.cookie), 1, now, now);
          qqLoginSessions.delete(String(b.sessionId || ''));
          broadcast('qq-account', qqAccountStatus());
          meProfileCache = { at: 0, list: null };
          return json(res, 200, qqAccountStatus());
        }
        return json(res, 200, { status: result.status, message: result.message || '' });
      }
      if (url.pathname === '/api/v1/qq/account' && req.method === 'DELETE') {
        db.prepare('DELETE FROM qq_accounts WHERE id=1').run();
        broadcast('qq-account', qqAccountStatus());
        meProfileCache = { at: 0, list: null };
        return json(res, 200, qqAccountStatus());
      }

      if (url.pathname === '/api/v1/cloud/account' && req.method === 'GET') return json(res, 200, cloudAccountStatus());
      if (url.pathname === '/api/v1/cloud/login/start' && req.method === 'POST') {
        const qr = await cloudQrStart();
        const id = crypto.randomUUID();
        cloudLoginSessions.set(id, { unikey: qr.unikey, createdAt: Date.now() });
        broadcast('qr', { kind: 'cloud', status: 'waiting', expiresIn: 180 });
        return json(res, 200, { sessionId: id, image: qr.image, expiresIn: 180 });
      }
      if (url.pathname === '/api/v1/cloud/login/poll' && req.method === 'POST') {
        const b = await body(req);
        const session = cloudLoginSessions.get(String(b.sessionId || ''));
        if (!session || Date.now() - session.createdAt > 180000) return json(res, 410, { status: 'expired', message: '网易云二维码已过期' });
        const result = await cloudQrPoll(session.unikey);
        if (result.status === 'success') {
          const now = Date.now();
          db.prepare('INSERT INTO cloud_accounts(id,uid,name,cookie_ciphertext,remember_login,created_at,updated_at) VALUES(1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET uid=excluded.uid,name=excluded.name,cookie_ciphertext=excluded.cookie_ciphertext,remember_login=excluded.remember_login,updated_at=excluded.updated_at')
            .run(result.uid || '', result.name || '', encryptSecret(result.cookie), 1, now, now);
          cloudLoginSessions.delete(String(b.sessionId || ''));
          meProfileCache = { at: 0, list: null };
          return json(res, 200, cloudAccountStatus());
        }
        return json(res, 200, { status: result.status, message: result.message || '' });
      }
      if (url.pathname === '/api/v1/cloud/account' && req.method === 'DELETE') {
        db.prepare('DELETE FROM cloud_accounts WHERE id=1').run();
        meProfileCache = { at: 0, list: null };
        return json(res, 200, cloudAccountStatus());
      }

      if (url.pathname === '/api/v1/migu/account' && req.method === 'GET') return json(res, 200, miguAccountStatus());
      if (url.pathname === '/api/v1/migu/login/start' && req.method === 'POST') {
        const qr = await miguQrStart();
        const id = crypto.randomUUID();
        miguLoginSessions.set(id, { sessionKey: qr.sessionId, createdAt: Date.now() });
        broadcast('qr', { kind: 'migu', status: 'waiting', expiresIn: 180 });
        return json(res, 200, { sessionId: id, image: qr.image, expiresIn: 180 });
      }
      if (url.pathname === '/api/v1/migu/login/poll' && req.method === 'POST') {
        const b = await body(req);
        const session = miguLoginSessions.get(String(b.sessionId || ''));
        if (!session || Date.now() - session.createdAt > 180000) return json(res, 410, { status: 'expired', message: '咪咕二维码已过期' });
        const result = await miguQrPoll(session.sessionKey);
        if (result.status === 'success') {
          const now = Date.now();
          db.prepare('INSERT INTO migu_accounts(id,uid,name,cookie_ciphertext,remember_login,created_at,updated_at) VALUES(1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET uid=excluded.uid,name=excluded.name,cookie_ciphertext=excluded.cookie_ciphertext,remember_login=excluded.remember_login,updated_at=excluded.updated_at')
            .run(result.uid || '', result.name || '', encryptSecret(result.cookie), 1, now, now);
          miguLoginSessions.delete(String(b.sessionId || ''));
          meProfileCache = { at: 0, list: null };
          return json(res, 200, miguAccountStatus());
        }
        return json(res, 200, { status: result.status, message: result.message || '' });
      }
      if (url.pathname === '/api/v1/migu/account' && req.method === 'DELETE') {
        db.prepare('DELETE FROM migu_accounts WHERE id=1').run();
        meProfileCache = { at: 0, list: null };
        return json(res, 200, miguAccountStatus());
      }

      if (url.pathname === '/api/v1/health') return json(res, 200, { ok: true, service: 'musiche-danmaku', db: 'sqlite', schema: 1, qq: qqAccountStatus().loggedIn, cloud: cloudAccountStatus().loggedIn, migu: miguAccountStatus().loggedIn, bili: biliAccountStatus().loggedIn, sources: normalizeSources(state.enabledSources) });
      if (url.pathname === '/api/v1/state') return json(res, 200, snapshot());
      if (url.pathname === '/api/v1/me' && req.method === 'GET') {
        const accounts = await meAccounts({ force: url.searchParams.get('refresh') === '1' });
        return json(res, 200, { accounts, idlePlaylistEnabled: Boolean(state.idlePlaylistEnabled), idlePlaylist: normalizeIdlePlaylist(state.idlePlaylist) });
      }
      {
        const mine = url.pathname.match(/^\/api\/v1\/me\/(qq|cloud|migu)\/playlists(?:\/([^/]+))?$/);
        if (mine && req.method === 'GET') {
          const source = mine[1];
          const playlistId = mine[2] ? decodeURIComponent(mine[2]) : '';
          const account = sourceAccountFor(source);
          if (!account?.cookie) return json(res, 401, { error: '未登录对应平台，请先到账号设置扫码' });
          const offset = Number(url.searchParams.get('offset') || 0) || 0;
          try {
            if (playlistId) return json(res, 200, await playlistDetail(source, account, playlistId, offset));
            return json(res, 200, await listPlaylists(source, account, offset));
          } catch (error) {
            return json(res, 502, { error: error?.message || '读取歌单失败' });
          }
        }
      }
      if (url.pathname === '/api/v1/logs' && req.method === 'GET') {
        const date = String(url.searchParams.get('date') || fileLog.todayStamp()).trim();
        const items = /^\d{4}-\d{2}-\d{2}$/.test(date) ? fileLog.readDate(date) : [];
        return json(res, 200, { date, items, ...fileLog.settings() });
      }
      if (url.pathname === '/api/v1/logs/settings' && req.method === 'POST') {
        const b = await body(req);
        const next = fileLog.setLimits({
          retentionDays: b.retentionDays ?? b.logRetentionDays,
          maxMb: b.maxMb ?? b.logMaxMb
        });
        state.logRetentionDays = next.retentionDays;
        state.logMaxMb = next.maxMb;
        persistSetting('logRetentionDays', state.logRetentionDays);
        persistSetting('logMaxMb', state.logMaxMb);
        return json(res, 200, next);
      }
      if (url.pathname === '/api/v1/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
        sse.add(res);
        res.write(`event: snapshot\ndata: ${JSON.stringify(eventPayload(snapshot()))}\n\n`);
        req.on('close', () => sse.delete(res));
        return;
      }

      if ((url.pathname === '/api/v1/songs/search' || url.pathname === '/api/v1/search') && req.method === 'GET') {
        const keyword = (url.searchParams.get('q') || '').trim();
        if (!keyword) return json(res, 400, { error: '缺少搜索词' });
        const sources = url.searchParams.get('sources') ? normalizeSources(url.searchParams.get('sources')) : normalizeSources(state.enabledSources);
        const extras = sourceExtras();
        const result = await searchCatalog(keyword, Math.min(Number(url.searchParams.get('limit') || 30), 50), {
          ...extras,
          sources
        });
        result.list = (result.list || []).map(withBiliCover);
        return json(res, 200, result);
      }

      const audioMatch = url.pathname.match(/^\/api\/v1\/songs\/bili\/([^/]+)\/audio$/);
      if (audioMatch && (req.method === 'GET' || req.method === 'HEAD')) {
        return await proxyBiliAudio(req, res, decodeURIComponent(audioMatch[1]));
      }
      const coverMatch = url.pathname.match(/^\/api\/v1\/songs\/bili\/([^/]+)\/cover$/);
      if (coverMatch && (req.method === 'GET' || req.method === 'HEAD')) {
        return await proxyBiliCover(req, res, decodeURIComponent(coverMatch[1]));
      }

      const songMatch = url.pathname.match(/^\/api\/v1\/songs\/(?:(qq|cloud|migu|bili)\/)?([^/]+)\/(play-url|lyric)$/);
      if (songMatch && req.method === 'GET') {
        const platform = parseBvid(decodeURIComponent(songMatch[2])) ? 'bili' : (songMatch[1] || persistableSong(state.current)?.type || 'qq');
        const id = decodeURIComponent(songMatch[2]);
        if (songMatch[3] === 'play-url') {
          const extras = sourceExtras();
          const account = platform === 'qq' ? await ensureQqMusicAccount() : qqAccount();
          const current = persistableSong(state.current);
          const currentVip = Boolean(current?.id === id && current?.type === platform && current?.vip);
          const result = await playUrlFor(platform, id, {
            ...extras,
            uin: account?.uin || '0',
            cookie: platform === 'qq' ? (account?.cookie || '') : extras.cookie,
            loggedIn: platform === 'qq' ? Boolean(account?.cookie) : extras.qqLoggedIn,
            vip: currentVip,
            contentId: url.searchParams.get('contentId') || current?.contentId || current?.remark || ''
          });
          if (platform === 'bili') {
            const bvid = parseBvid(id) || id;
            const cover = `${publicApiBase()}/songs/bili/${encodeURIComponent(bvid)}/cover`;
            if (result?.url) result.url = `http://127.0.0.1:${port}/api/v1/songs/bili/${encodeURIComponent(bvid)}/audio`;
            result.image = cover;
            result.coverUrl = cover;
          }
          return json(res, 200, result);
        }
        return json(res, 200, await lyricFor(platform, id, {
          ...sourceExtras(),
          contentId: url.searchParams.get('contentId') || persistableSong(state.current)?.contentId || persistableSong(state.current)?.remark || ''
        }));
      }

      if (url.pathname === '/api/v1/queue' && req.method === 'GET') return json(res, 200, snapshot().queue);
      if (url.pathname === '/api/v1/queue' && req.method === 'POST') {
        const b = await body(req);
        const song = persistableSong(b.song);
        if (!song.origin) song.origin = 'request';
        const key = songKey(song);
        if (!key) return json(res, 400, { error: '歌曲数据缺失' });
        const exists = db.prepare("SELECT id FROM queue_items WHERE song_id=? AND status='queued' LIMIT 1").get(key);
        if (!exists) {
          const max = db.prepare("SELECT COALESCE(MAX(position),-1) n FROM queue_items WHERE status='queued'").get().n;
          db.prepare('INSERT INTO queue_items(song_id,song_json,requester,requested_by_uid,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
            .run(key, JSON.stringify(song), String(b.requester || song.requestedBy || ''), String(b.requestedByUid || song.requestedByUid || ''), max + 1, Date.now(), Date.now());
          state.consecutiveFailures = 0;
        }
        if (!startQueuedIfIdle()) broadcast('snapshot', snapshot());
        return json(res, 201, snapshot());
      }
      if (url.pathname === '/api/v1/queue/snapshot' && req.method === 'PUT') {
        const b = await body(req);
        const list = Array.isArray(b.queue) ? b.queue : [];
        db.exec('BEGIN');
        try {
          db.prepare("DELETE FROM queue_items WHERE status='queued'").run();
          const insert = db.prepare('INSERT INTO queue_items(song_id,song_json,requester,requested_by_uid,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
          list.filter(song => persistableSong(song)?.origin !== 'library').forEach((song, index) => {
            const item = persistableSong(song);
            insert.run(songKey(item) || item.id, JSON.stringify(item), String(item.requester || item.requestedBy || ''), String(item.requestedByUid || ''), index, Date.now(), Date.now());
          });
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
        broadcast('snapshot', snapshot());
        return json(res, 200, snapshot());
      }
      if (url.pathname === '/api/v1/history' && req.method === 'GET') return json(res, 200, snapshot().history);
      if (url.pathname === '/api/v1/history' && req.method === 'POST') {
        const b = await body(req);
        const song = persistableSong(b.song);
        if (!song?.id) return json(res, 400, { error: '歌曲数据缺失' });
        const now = Date.now();
        const key = songKey(song) || song.id;
        db.prepare('DELETE FROM play_history WHERE song_id=?').run(key);
        db.prepare('INSERT INTO play_history(song_id,song_json,requester,played_at,started_at,result) VALUES(?,?,?,?,?,?)')
          .run(key, JSON.stringify(song), String(b.requester || song.requestedBy || ''), now, now, 'played');
        db.prepare('DELETE FROM play_history WHERE id NOT IN (SELECT id FROM play_history ORDER BY played_at DESC LIMIT 200)').run();
        broadcast('history', snapshot().history);
        return json(res, 201, snapshot().history);
      }
      if (url.pathname === '/api/v1/history' && req.method === 'DELETE') {
        db.prepare('DELETE FROM play_history').run();
        broadcast('snapshot', snapshot());
        return json(res, 200, { ok: true, history: [] });
      }
      const qMatch = url.pathname.match(/^\/api\/v1\/queue\/(\d+)$/);
      if (qMatch && req.method === 'DELETE') {
        db.prepare('DELETE FROM queue_items WHERE id=?').run(Number(qMatch[1]));
        broadcast('snapshot', snapshot());
        return json(res, 200, snapshot());
      }

      if (url.pathname === '/api/v1/player/current' && req.method === 'POST') {
        const b = await body(req);
        if (!b.song?.id) return json(res, 400, { error: '歌曲数据缺失' });
        state.current = persistableSong(b.song);
        state.playing = b.playing !== false;
        state.loading = false;
        state.currentTime = 0;
        state.duration = Number(b.song.length || b.song.durationSec || 0);
        state.consecutiveFailures = 0;
        setPlayback({}, 'play');
        return json(res, 200, snapshot());
      }
      if (url.pathname === '/api/v1/player/progress' && req.method === 'POST') {
        const b = await body(req);
        const positionMs = Math.max(0, Number(b.positionMs ?? ((b.progress || 0) * 1000)) || 0);
        state.positionMs = positionMs;
        state.currentTime = positionMs / 1000;
        const durationMs = asMediaMs(b.durationMs || state.durationMs || state.duration);
        if (durationMs >= 1000) {
          state.durationMs = durationMs;
          state.duration = durationMs / 1000;
        }
        state.updatedAt = Date.now();
        broadcast('progress', {
          playing: state.playing,
          currentTime: state.currentTime,
          duration: state.duration,
          playback: {
            playing: state.playing,
            loading: state.loading,
            positionMs: state.positionMs,
            durationMs: state.durationMs,
            updatedAt: state.updatedAt
          }
        });
        return json(res, 200, snapshot().playback);
      }
      if (url.pathname === '/api/v1/player/next' && req.method === 'POST') {
        const next = queueNext(Boolean((await body(req)).auto));
        if (!next) {
          state.current = null;
          state.playing = false;
          setPlayback({}, 'pause');
          return json(res, 200, { ...snapshot(), next: null });
        }
        state.current = persistableSong(next);
        state.currentTime = 0;
        state.duration = Number(next.length || next.durationSec || 0);
        state.playing = true;
        state.consecutiveFailures = 0;
        setPlayback({}, 'play');
        return json(res, 200, { ...snapshot(), next: state.current });
      }
      if (url.pathname === '/api/v1/player/ended' && req.method === 'POST') {
        broadcast('ended', { id: state.current?.id || '' });
        if (state.mode === 'single' && state.current) {
          state.currentTime = 0;
          state.playing = true;
          setPlayback({}, 'play');
          return json(res, 200, { ...snapshot(), next: state.current });
        }
        consumeCurrentFromQueue();
        const next = queueNext(true);
        if (!next) {
          state.current = null;
          state.playing = false;
          setPlayback({}, 'pause');
          return json(res, 200, { ...snapshot(), next: null });
        }
        state.current = persistableSong(next);
        state.currentTime = 0;
        state.duration = Number(next.length || next.durationSec || 0);
        state.playing = true;
        setPlayback({}, 'play');
        return json(res, 200, { ...snapshot(), next: state.current });
      }
      if (url.pathname === '/api/v1/player/failure' && req.method === 'POST') {
        const b = await body(req);
        return json(res, 200, markPlaybackFailure(b.song || state.current, b.reason || '播放地址不可用'));
      }
      if (url.pathname === '/api/v1/player/play' && req.method === 'POST') {
        state.playing = true;
        setPlayback({}, 'play');
        return json(res, 200, snapshot());
      }
      if (url.pathname === '/api/v1/player/pause' && req.method === 'POST') {
        state.playing = false;
        setPlayback({}, 'pause');
        return json(res, 200, snapshot());
      }
      if (url.pathname === '/api/v1/player/mode' && req.method === 'POST') {
        const b = await body(req);
        const mode = b.mode || 'loop';
        if (!['loop', 'order', 'random', 'single'].includes(mode)) return json(res, 400, { error: '不支持的播放模式' });
        state.mode = mode;
        persistSetting('mode', state.mode);
        broadcast('snapshot', snapshot());
        return json(res, 200, snapshot());
      }
      if (url.pathname === '/api/v1/config' && req.method === 'GET') {
        const cfg = Object.fromEntries(db.prepare('SELECT key,value FROM app_settings').all().map(x => [x.key, JSON.parse(x.value)]));
        cfg.accepting = state.accepting;
        cfg.giftRequestEnabled = Boolean(state.giftRequestEnabled);
        cfg.giftRequest = normalizeGiftRequest(state.giftRequest);
        cfg.giftRequestQualifyMode = normalizeQualifyMode(state.giftRequestQualifyMode);
        cfg.giftRequestThreshold = normalizeThreshold(state.giftRequestThreshold);
        cfg.giftRequestCountMode = normalizeCountMode(state.giftRequestCountMode);
        cfg.giftSkipEnabled = Boolean(state.giftSkipEnabled);
        cfg.giftSkipAction = normalizeSkipAction(state.giftSkipAction);
        cfg.giftSkipExpireSec = normalizeExpireSec(state.giftSkipExpireSec);
        cfg.giftSkipQualifyMode = normalizeQualifyMode(state.giftSkipQualifyMode);
        cfg.giftSkipGift = normalizeGiftRequest(state.giftSkipGift);
        cfg.giftSkipThreshold = normalizeThreshold(state.giftSkipThreshold);
        cfg.songBlacklistEnabled = Boolean(state.songBlacklistEnabled);
        cfg.songBlacklist = normalizeSongBlacklist(state.songBlacklist);
        cfg.idlePlaylistEnabled = Boolean(state.idlePlaylistEnabled);
        cfg.idlePlaylist = normalizeIdlePlaylist(state.idlePlaylist);
        cfg.biliRoom = String(state.biliRoom || '');
        cfg.logRetentionDays = Number(state.logRetentionDays) || 14;
        cfg.logMaxMb = Number(state.logMaxMb) || 32;
        return json(res, 200, cfg);
      }
      if (url.pathname === '/api/v1/config' && req.method === 'POST') {
        const b = await body(req);
        for (const [k, v] of Object.entries(b)) {
          if (k === 'commandConfig' && v && typeof v === 'object') {
            Object.assign(commandCfg, v);
            persistSetting('commandConfig', commandCfg);
            continue;
          }
          if (['userCooldownSec', 'globalCooldownSec', 'playlistLimit'].includes(k)) {
            commandCfg[k] = Number(v);
            persistSetting('commandConfig', commandCfg);
          }
          if (k === 'enabledSources') {
            state.enabledSources = normalizeSources(v);
            persistSetting('enabledSources', state.enabledSources);
            continue;
          }
          if (k === 'accepting') {
            state.accepting = Boolean(v);
            persistSetting('accepting', state.accepting);
            log(`[系统] ${state.accepting ? '开启' : '关闭'}点歌`);
            continue;
          }
          if (k === 'giftRequestEnabled') {
            state.giftRequestEnabled = Boolean(v);
            persistSetting('giftRequestEnabled', state.giftRequestEnabled);
            log(`[系统] ${state.giftRequestEnabled ? '开启' : '关闭'}礼物点歌`);
            continue;
          }
          if (k === 'giftRequest') {
            state.giftRequest = normalizeGiftRequest(v);
            persistSetting('giftRequest', state.giftRequest);
            if (state.giftRequest.giftName) log(`[系统] 礼物点歌指定「${state.giftRequest.giftName}」`);
            continue;
          }
          if (k === 'giftRequestQualifyMode') {
            state.giftRequestQualifyMode = normalizeQualifyMode(v);
            persistSetting('giftRequestQualifyMode', state.giftRequestQualifyMode);
            continue;
          }
          if (k === 'giftRequestThreshold') {
            state.giftRequestThreshold = normalizeThreshold(v);
            persistSetting('giftRequestThreshold', state.giftRequestThreshold);
            continue;
          }
          if (k === 'giftRequestCountMode') {
            state.giftRequestCountMode = normalizeCountMode(v);
            persistSetting('giftRequestCountMode', state.giftRequestCountMode);
            continue;
          }
          if (k === 'giftSkipEnabled') {
            state.giftSkipEnabled = Boolean(v);
            persistSetting('giftSkipEnabled', state.giftSkipEnabled);
            log(`[系统] ${state.giftSkipEnabled ? '开启' : '关闭'}礼物切歌`);
            continue;
          }
          if (k === 'giftSkipAction') {
            state.giftSkipAction = normalizeSkipAction(v);
            persistSetting('giftSkipAction', state.giftSkipAction);
            continue;
          }
          if (k === 'giftSkipExpireSec') {
            state.giftSkipExpireSec = normalizeExpireSec(v);
            persistSetting('giftSkipExpireSec', state.giftSkipExpireSec);
            continue;
          }
          if (k === 'giftSkipQualifyMode') {
            state.giftSkipQualifyMode = normalizeQualifyMode(v);
            persistSetting('giftSkipQualifyMode', state.giftSkipQualifyMode);
            continue;
          }
          if (k === 'giftSkipGift') {
            state.giftSkipGift = normalizeGiftRequest(v);
            persistSetting('giftSkipGift', state.giftSkipGift);
            if (state.giftSkipGift.giftName) log(`[系统] 礼物切歌指定「${state.giftSkipGift.giftName}」`);
            continue;
          }
          if (k === 'giftSkipThreshold') {
            state.giftSkipThreshold = normalizeThreshold(v);
            persistSetting('giftSkipThreshold', state.giftSkipThreshold);
            continue;
          }
          if (k === 'songBlacklistEnabled') {
            state.songBlacklistEnabled = Boolean(v);
            persistSetting('songBlacklistEnabled', state.songBlacklistEnabled);
            log(`[系统] ${state.songBlacklistEnabled ? '开启' : '关闭'}点歌黑名单`);
            continue;
          }
          if (k === 'songBlacklist') {
            state.songBlacklist = normalizeSongBlacklist(v);
            persistSetting('songBlacklist', state.songBlacklist);
            log(`[系统] 点歌黑名单已更新（${state.songBlacklist.length} 条）`);
            continue;
          }
          if (k === 'idlePlaylistEnabled') {
            state.idlePlaylistEnabled = Boolean(v);
            persistSetting('idlePlaylistEnabled', state.idlePlaylistEnabled);
            log(`[系统] ${state.idlePlaylistEnabled ? '开启' : '关闭'}闲时歌单`);
            continue;
          }
          if (k === 'idlePlaylist') {
            state.idlePlaylist = normalizeIdlePlaylist(v);
            persistSetting('idlePlaylist', state.idlePlaylist);
            if (state.idlePlaylist?.name) log(`[系统] 闲时歌单设为「${state.idlePlaylist.name}」`);
            continue;
          }
          if (k === 'logRetentionDays' || k === 'logMaxMb') {
            const next = fileLog.setLimits({
              retentionDays: k === 'logRetentionDays' ? v : state.logRetentionDays,
              maxMb: k === 'logMaxMb' ? v : state.logMaxMb
            });
            state.logRetentionDays = next.retentionDays;
            state.logMaxMb = next.maxMb;
            persistSetting('logRetentionDays', state.logRetentionDays);
            persistSetting('logMaxMb', state.logMaxMb);
            continue;
          }
          if (k === 'connection' || k === 'current') continue;
          state[k] = v;
          persistSetting(k, v);
        }
        broadcast('snapshot', snapshot());
        return json(res, 200, { ok: true, settingsRevision: state.settingsRevision });
      }
      if (url.pathname === '/api/v1/bili/gifts' && req.method === 'GET') {
        try {
          const catalog = await refreshGiftCatalog({ force: true });
          return json(res, 200, {
            list: catalog.list,
            selected: normalizeGiftRequest(state.giftRequest),
            skipSelected: normalizeGiftRequest(state.giftSkipGift),
            enabled: Boolean(state.giftRequestEnabled),
            skipEnabled: Boolean(state.giftSkipEnabled),
            fetchedAt: catalog.fetchedAt,
            missing: Boolean(catalog.missing)
          });
        } catch (error) {
          return json(res, 502, { error: error?.message || '礼物列表获取失败' });
        }
      }
      if ((url.pathname === '/api/v1/bili/account' || url.pathname === '/api/v1/bili/qrstatus') && req.method === 'GET' && !url.searchParams.get('sessionId')) {
        return json(res, 200, { ...biliAccountStatus(), connection: state.connection });
      }
      if ((url.pathname === '/api/v1/bili/login/start' || url.pathname === '/api/v1/bili/qrstart') && req.method === 'POST') {
        const qr = await biliQrStart();
        const id = crypto.randomUUID();
        biliLoginSessions.set(id, { qrcodeKey: qr.qrcodeKey, createdAt: Date.now() });
        broadcast('qr', { kind: 'bili', status: 'waiting', expiresIn: 180 });
        return json(res, 200, { sessionId: id, image: qr.image, expiresIn: 180 });
      }
      if ((url.pathname === '/api/v1/bili/login/poll' || url.pathname === '/api/v1/bili/qrstatus') && req.method === 'POST') {
        const b = await body(req);
        const session = biliLoginSessions.get(String(b.sessionId || ''));
        if (!session || Date.now() - session.createdAt > 180000) return json(res, 410, { status: 'expired', message: 'B站二维码已过期' });
        const result = await biliQrPoll(session.qrcodeKey);
        if (result.status === 'success') {
          const now = Date.now();
          db.prepare('INSERT INTO bili_accounts(id,uid,cookie_ciphertext,remember_login,created_at,updated_at) VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET uid=excluded.uid,cookie_ciphertext=excluded.cookie_ciphertext,remember_login=excluded.remember_login,updated_at=excluded.updated_at')
            .run(result.uid || '', encryptSecret(result.cookie), 1, now, now);
          biliLoginSessions.delete(String(b.sessionId || ''));
          broadcast('qr', { kind: 'bili', status: 'success' });
          return json(res, 200, biliAccountStatus());
        }
        return json(res, 200, { status: result.status, message: result.message || '' });
      }
      if (url.pathname === '/api/v1/bili/account' && req.method === 'DELETE') {
        await danmaku.disconnect();
        db.prepare('DELETE FROM bili_accounts WHERE id=1').run();
        state.connection = { state: 'idle', roomId: 0, lastPacketAt: 0, retryCount: 0, detail: '已退出 B站登录' };
        broadcast('conn', state.connection);
        broadcast('snapshot', snapshot());
        return json(res, 200, biliAccountStatus());
      }
      if ((url.pathname === '/api/v1/bili/connect' || url.pathname === '/api/v1/room/connect') && req.method === 'POST') {
        const b = await body(req);
        const room = String(b.room || b.roomId || state.biliRoom || '');
        if (!biliAccount()?.cookie) return json(res, 403, { error: '未扫码登录 B站，拒绝连接弹幕（匿名弹幕不恢复）', connection: { ...state.connection, state: 'failed', detail: '未扫码登录 B站，拒绝连接弹幕（匿名弹幕不恢复）' } });
        const result = await connectBiliRoom(room);
        return json(res, result.ok ? 200 : 409, result);
      }
      if ((url.pathname === '/api/v1/bili/disconnect' || url.pathname === '/api/v1/room/disconnect') && req.method === 'POST') {
        await danmaku.disconnect();
        return json(res, 200, { ok: true, connection: state.connection });
      }
      if (serveWeb(req, res, url)) return;
      return json(res, 404, { error: '未找到 API' });
    } catch (error) {
      if (error instanceof HaltedError || error?.halt) {
        const status = error.status === 429 ? 429 : 403;
        log(error.message, 'error');
        broadcast('error', { code: `http_${status}`, message: error.message, recoverable: false });
        return json(res, status, { error: error.message });
      }
      log(error?.stack || String(error), 'error');
      return json(res, 500, { error: error?.message || String(error) });
    }
    });
    server.on('error', error => {
      console.error(error);
      process.exit(1);
    });
    const shutdown = () => {
      try { server.close(); } catch {}
      process.exit(0);
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    return server.listen(port, '127.0.0.1', () => {
      console.log(`新 API 已监听 127.0.0.1:${port}`);
      log(`新 API 已监听 127.0.0.1:${port}`);
      setInterval(() => {
        if (!state.giftRequestEnabled || !biliAccount()?.cookie) return;
        refreshGiftCatalog({ force: true }).catch(error => log(`礼物列表自动刷新失败：${error.message}`, 'error'));
      }, 15 * 60 * 1000);
      if (state.autoConnect && state.biliRoom && biliAccount()?.cookie) {
        connectBiliRoom(state.biliRoom).catch(error => log(error?.message || String(error), 'error'));
      } else if (!biliAccount()?.cookie) {
        log('未扫码登录 B站，不会自动连接弹幕');
      }
    });
  });
}

process.on('unhandledRejection', error => {
  console.error(error);
  try { log(error?.stack || String(error), 'error'); } catch {}
});
process.on('uncaughtException', error => {
  console.error(error);
  try { log(error?.stack || String(error), 'error'); } catch {}
});

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  createServer();
}
