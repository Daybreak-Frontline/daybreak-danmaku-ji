import crypto from 'node:crypto';
import { HaltedError } from './qq-provider.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const VIEW = 'https://api.bilibili.com/x/web-interface/view';
const PLAYURL = 'https://api.bilibili.com/x/player/wbi/playurl';
const PLAYER_V2 = 'https://api.bilibili.com/x/player/wbi/v2';
const PLAYER_V2_PLAIN = 'https://api.bilibili.com/x/player/v2';
const SEARCH = 'https://api.bilibili.com/x/web-interface/wbi/search/type';
const NAV = 'https://api.bilibili.com/x/web-interface/nav';
const MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
const BVID_RE = /BV[0-9A-Za-z]{10}/i;
const playUrlCache = new Map();
const viewCache = new Map();
const lyricCache = new Map();
let wbiCache = { at: 0, imgKey: '', subKey: '' };

export function parseBvid(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const urlHit = text.match(/bilibili\.com\/video\/(BV[0-9A-Za-z]{10})/i)
    || text.match(/[?&]bvid=(BV[0-9A-Za-z]{10})/i);
  if (urlHit) return normalizeBvid(urlHit[1]);
  const bare = text.match(BVID_RE);
  if (bare && (text === bare[0] || /(?:^|[^A-Za-z0-9])BV[0-9A-Za-z]{10}(?:[^A-Za-z0-9]|$)/i.test(text))) {
    return normalizeBvid(bare[0]);
  }
  return '';
}

function normalizeBvid(value) {
  const raw = String(value || '');
  const body = raw.replace(/^bv/i, '');
  return body ? `BV${body}` : '';
}

function isNumericSongId(value) {
  return /^\d{2,}$/.test(String(value || '').trim());
}

export function looksLikeBvid(value) {
  return Boolean(parseBvid(value)) && !isNumericSongId(value);
}

function biliHeaders(cookie = '', extra = {}) {
  return {
    'User-Agent': UA,
    Referer: 'https://www.bilibili.com',
    Origin: 'https://www.bilibili.com',
    ...(cookie ? { Cookie: cookie } : {}),
    ...extra
  };
}

function assertNotHalted(res) {
  if (res.status === 403 || res.status === 412 || res.status === 429) {
    throw new HaltedError(`B站接口 HTTP ${res.status}，已停止对应流程`, res.status);
  }
}

function durationClock(seconds) {
  const n = Number(seconds) || 0;
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
}

function extractKey(url) {
  const file = String(url || '').split('/').pop() || '';
  return file.split('.')[0] || '';
}

async function biliJson(url, cookie = '') {
  const res = await fetch(url, { headers: biliHeaders(cookie) });
  assertNotHalted(res);
  if (!res.ok) throw new Error(`B站接口 HTTP ${res.status}`);
  return res.json();
}

async function ensureWbi(cookie = '') {
  if (wbiCache.imgKey && Date.now() - wbiCache.at < 10 * 60 * 1000) return wbiCache;
  const json = await biliJson(NAV, cookie);
  const imgKey = extractKey(json?.data?.wbi_img?.img_url);
  const subKey = extractKey(json?.data?.wbi_img?.sub_url);
  if (!imgKey || !subKey) throw new Error('B站签名密钥获取失败');
  wbiCache = { at: Date.now(), imgKey, subKey };
  return wbiCache;
}

function wbiQuery(params, imgKey, subKey) {
  const mixin = MIXIN.map(index => `${imgKey}${subKey}`[index] || '').join('').slice(0, 32);
  const next = { ...params, wts: Math.floor(Date.now() / 1000) };
  const query = Object.keys(next)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(next[key]).replace(/[!'()*]/g, ''))}`)
    .join('&');
  const w_rid = crypto.createHash('md5').update(query + mixin).digest('hex');
  return `${query}&w_rid=${w_rid}`;
}

async function signedGet(base, params, cookie = '') {
  const keys = await ensureWbi(cookie);
  return biliJson(`${base}?${wbiQuery(params, keys.imgKey, keys.subKey)}`, cookie);
}

async function resolveShortLink(url, cookie = '') {
  try {
    const res = await fetch(url, { redirect: 'manual', headers: biliHeaders(cookie) });
    const loc = res.headers.get('location') || '';
    return parseBvid(loc);
  } catch {
    return '';
  }
}

export async function resolveBiliInput(raw, extras = {}) {
  const text = String(raw || '').trim();
  const direct = parseBvid(text);
  if (direct) return direct;
  const short = text.match(/https?:\/\/b23\.tv\/[A-Za-z0-9]+/i);
  if (short) return resolveShortLink(short[0], extras.biliCookie || extras.cookie || '');
  return '';
}

function httpsUrl(url) {
  const text = String(url || '').trim();
  if (!text) return '';
  if (text.startsWith('//')) return `https:${text}`;
  return text.replace(/^http:\/\//, 'https://');
}

function coverOf(view, extra = {}) {
  return httpsUrl(view?.pic || extra.image || extra.coverUrl || '');
}

function numericCid(value) {
  const text = String(value || '').trim();
  return /^\d+$/.test(text) ? text : '';
}

function cidOf(view, extras = {}) {
  return numericCid(extras.contentId || extras.cid)
    || numericCid(view?.cid)
    || numericCid(view?.pages?.[0]?.cid);
}

function toMusic(view, extra = {}) {
  const bvid = normalizeBvid(view.bvid || extra.bvid || '');
  const page = Array.isArray(view.pages) ? (view.pages.find(item => String(item.cid) === String(extra.cid)) || view.pages[0]) : null;
  const seconds = Number(page?.duration || view.duration || extra.durationSec || 0);
  const image = coverOf(view, extra);
  const name = page && view.videos > 1 ? `${view.title} P${page.page} ${page.part || ''}`.trim() : (view.title || extra.name || bvid);
  const singer = view.owner?.name || extra.artist || '哔哩哔哩';
  const cid = String(page?.cid || extra.cid || view.cid || '');
  const vip = Boolean(view.rights?.pay || view.rights?.ugc_pay || view.is_upower_exclusive);
  return {
    id: bvid,
    type: 'bili',
    platform: 'bili',
    name,
    rawName: name,
    artist: singer,
    singer,
    album: '哔哩哔哩',
    albumId: String(view.aid || ''),
    durationSec: seconds,
    duration: durationClock(seconds),
    length: seconds,
    coverUrl: image,
    image,
    mediumImage: image,
    largeImage: image,
    vip,
    playable: extra.playable !== false,
    audition: false,
    url: '',
    contentId: cid,
    remark: bvid
  };
}

async function fetchView(bvid, extras = {}) {
  const hit = viewCache.get(bvid);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;
  const cookie = extras.biliCookie || extras.cookie || '';
  const json = await biliJson(`${VIEW}?bvid=${encodeURIComponent(bvid)}`, cookie);
  if (Number(json?.code) !== 0 || !json?.data) {
    throw new Error(json?.message || '稿件不存在或无法访问');
  }
  viewCache.set(bvid, { at: Date.now(), data: json.data });
  return json.data;
}

function pickAudio(dash) {
  const list = [
    ...(Array.isArray(dash?.flac?.audio) ? dash.flac.audio : dash?.flac?.audio ? [dash.flac.audio] : []),
    ...(Array.isArray(dash?.audio) ? dash.audio : [])
  ].filter(item => item?.baseUrl || item?.base_url);
  if (!list.length) return '';
  list.sort((a, b) => Number(b.bandwidth || 0) - Number(a.bandwidth || 0));
  return list[0].baseUrl || list[0].base_url || '';
}

export async function resolveBiliAudioUrl(id, extras = {}) {
  const bvid = await resolveBiliInput(id, extras);
  if (!bvid) return { url: '', error: '不是有效的 BV 号', cid: '' };
  const cacheKey = `${bvid}:${extras.contentId || ''}`;
  const hit = playUrlCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 8 * 60 * 1000) return hit.value;
  const cookie = extras.biliCookie || extras.cookie || '';
  const view = await fetchView(bvid, extras);
  const cid = cidOf(view, extras);
  if (!cid) return { url: '', error: '稿件没有可播放的分P', cid: '' };
  const json = await signedGet(PLAYURL, {
    bvid,
    cid,
    fnval: 16,
    fnver: 0,
    fourk: 1,
    qn: 0
  }, cookie);
  if (Number(json?.code) !== 0) {
    return { url: '', error: json?.message || '无法获取音频地址', cid };
  }
  const url = pickAudio(json?.data?.dash) || json?.data?.durl?.[0]?.url || '';
  const image = coverOf(view);
  const value = url
    ? { url, cid, error: '', image }
    : { url: '', cid, error: extras.biliLoggedIn || cookie ? '此稿件没有可提取的音频' : '需要登录 B站后才能获取此音频', image };
  playUrlCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

export async function biliCoverSource(id, extras = {}) {
  const bvid = await resolveBiliInput(id, extras);
  if (!bvid) return { url: '', error: '不是有效的 BV 号' };
  const view = await fetchView(bvid, extras);
  const url = coverOf(view);
  return { url, error: url ? '' : '稿件没有封面' };
}

export async function biliSongById(id, extras = {}) {
  const bvid = await resolveBiliInput(id, extras);
  if (!bvid) return null;
  const view = await fetchView(bvid, extras);
  return toMusic(view, { bvid, cid: extras.contentId || '' });
}

export async function biliSearch(keyword, limit = 10, extras = {}) {
  const bvid = await resolveBiliInput(keyword, extras);
  if (bvid) {
    const song = await biliSongById(bvid, extras);
    return song ? [song] : [];
  }
  const cookie = extras.biliCookie || extras.cookie || '';
  const json = await signedGet(SEARCH, {
    search_type: 'video',
    keyword: String(keyword || '').trim(),
    page: 1
  }, cookie);
  const list = json?.data?.result || [];
  return list.slice(0, Math.max(1, Number(limit) || 10)).map(item => {
    const id = normalizeBvid(item.bvid || parseBvid(item.arcurl || ''));
    const seconds = Number(item.duration?.includes?.(':')
      ? item.duration.split(':').reduce((sum, part) => sum * 60 + Number(part || 0), 0)
      : item.duration || 0);
    const image = httpsUrl(item.pic);
    const name = String(item.title || '').replace(/<[^>]+>/g, '');
    const singer = item.author || '哔哩哔哩';
    return {
      id,
      type: 'bili',
      platform: 'bili',
      name,
      rawName: name,
      artist: singer,
      singer,
      album: '哔哩哔哩',
      albumId: String(item.aid || ''),
      durationSec: seconds,
      duration: durationClock(seconds),
      length: seconds,
      coverUrl: image,
      image,
      mediumImage: image,
      largeImage: image,
      vip: false,
      playable: Boolean(id),
      audition: false,
      url: '',
      contentId: '',
      remark: id
    };
  }).filter(item => item.id);
}

export async function biliPlayUrl(id, extras = {}) {
  const resolved = await resolveBiliAudioUrl(id, extras);
  return {
    url: resolved.url,
    error: resolved.error || undefined,
    playable: Boolean(resolved.url),
    trial: false,
    cid: resolved.cid,
    image: resolved.image || ''
  };
}

function secondsToLrcTag(sec) {
  const totalMs = Math.max(0, Math.round(Number(sec) * 1000 || 0));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}]`;
}

function subtitleSeconds(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function subtitleJsonToCues(json) {
  const body = json?.body || json?.data?.body || [];
  if (!Array.isArray(body) || !body.length) return [];
  const cues = [];
  for (const item of body) {
    const text = String(item.content || item.line || '')
      .replace(/\r/g, '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .join(' / ');
    if (!text) continue;
    const from = subtitleSeconds(item.from ?? item.start);
    const to = subtitleSeconds(item.to ?? item.end);
    cues.push({ from, to: to > from ? to : from, text });
  }
  cues.sort((a, b) => a.from - b.from || a.to - b.to);
  return cues;
}

function subtitleJsonToLrc(cues) {
  return cues.map(item => `${secondsToLrcTag(item.from)}${item.text}`).join('\n');
}

function pickSubtitle(list) {
  const items = Array.isArray(list) ? list.filter(item => item?.subtitle_url) : [];
  if (!items.length) return null;
  const rank = lan => {
    const value = String(lan || '').toLowerCase();
    if (value === 'zh-cn' || value === 'zh-hans' || value === 'ai-zh') return 0;
    if (value.startsWith('zh')) return 1;
    return 2;
  };
  return items.sort((a, b) => rank(a.lan) - rank(b.lan))[0];
}

async function fetchSubtitleList(bvid, cid, cookie, aid = '') {
  const params = { bvid, cid, ...(aid ? { aid } : {}) };
  try {
    const json = await signedGet(PLAYER_V2, params, cookie);
    return json?.data?.subtitle?.subtitles || json?.data?.subtitle?.list || [];
  } catch {
    const query = new URLSearchParams(params);
    const json = await biliJson(`${PLAYER_V2_PLAIN}?${query}`, cookie);
    return json?.data?.subtitle?.subtitles || json?.data?.subtitle?.list || [];
  }
}

export async function biliLyric(id, extras = {}) {
  const bvid = await resolveBiliInput(id, extras);
  if (!bvid) return { lyric: '' };
  const cookie = extras.biliCookie || extras.cookie || '';
  const view = await fetchView(bvid, extras);
  const cid = cidOf(view, extras);
  const cacheKey = `v3:${bvid}:${cid}`;
  const hit = lyricCache.get(cacheKey);
  if (hit && Date.now() - hit.at < (hit.ttl || 30 * 60 * 1000)) return hit.value;
  let list = [];
  if (cid) {
    try { list = await fetchSubtitleList(bvid, cid, cookie, view.aid); }
    catch { list = []; }
  }
  if (!list.length) list = view.subtitle?.list || view.subtitle?.subtitles || [];
  const picked = pickSubtitle(list);
  if (!picked?.subtitle_url) {
    const empty = { lyric: '', cues: [] };
    lyricCache.set(cacheKey, { at: Date.now(), ttl: cookie ? 5 * 60 * 1000 : 20 * 1000, value: empty });
    return empty;
  }
  const sub = await biliJson(httpsUrl(picked.subtitle_url), cookie);
  const cues = subtitleJsonToCues(sub);
  const value = { lyric: subtitleJsonToLrc(cues), cues };
  lyricCache.set(cacheKey, { at: Date.now(), ttl: 30 * 60 * 1000, value });
  return value;
}

export function biliRequestHeaders(cookie = '') {
  return biliHeaders(cookie);
}
