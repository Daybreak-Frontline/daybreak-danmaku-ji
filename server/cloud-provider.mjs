import crypto from 'node:crypto';
import { HaltedError } from './qq-provider.mjs';

const UA = 'Mozilla/5.0 (iPad; CPU OS 11_0 like Mac OS X) AppleWebKit/604.1.34 (KHTML, like Gecko) Version/11.0 Mobile/15A5341f Safari/604.1';
const SEARCH = 'https://interface.music.163.com/weapi/search/get';
const PLAY_URL = 'https://music.163.com/weapi/song/enhance/player/url?csrf_token=';
const LYRIC = id => `https://music.163.com/api/song/lyric?lv=-1&id=${encodeURIComponent(id)}`;
const ENC_SEC_KEY = '409afd10f2fa06173df57525287c4a1cdf6fa08bd542c6400da953704eb92dc1ad3c582e82f51a707ebfa0f6a25bcd185139fc1509d40dd97b180ed21641df55e90af4884a0b587bd25256141a9270b1b6f18908c6a626b74167e5a55a796c0f808a2eb12c33e63d34a7c4d358bab1dc661637dd1e888a1268b81a89f6136053';

function assertNotHalted(res) {
  if (res.status === 403 || res.status === 429) {
    throw new HaltedError(`网易云接口 HTTP ${res.status}，已停止对应流程`, res.status);
  }
}

function aesCbc(plain, key) {
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from('0102030405060708'));
  return Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]).toString('base64');
}

function weapi(data) {
  const payload = { ...data, csrf_token: '' };
  const first = aesCbc(JSON.stringify(payload), '0CoJUm6Qyw8W8jud');
  return {
    params: aesCbc(first, 't9Y0m4pdsoMznMlL'),
    encSecKey: ENC_SEC_KEY
  };
}

export async function weapiRequest(url, data = {}, { cookie = '', headers = {}, json = true } = {}) {
  const csrf = (String(cookie).match(/__csrf=([^;]+)/) || [])[1] || '';
  const body = weapi({ ...data, csrf_token: csrf });
  const cookieHeader = cookie
    ? (String(cookie).includes('os=') ? cookie : `os=ios; ${cookie}`)
    : 'os=ios';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Referer: 'https://music.163.com',
      Cookie: cookieHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers
    },
    body: new URLSearchParams(body)
  });
  assertNotHalted(res);
  if (!res.ok) throw new Error(`网易云 HTTP ${res.status}`);
  if (!json) return res;
  return res.json();
}

function durationClock(ms) {
  const seconds = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return {
    durationSec: seconds,
    duration: `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`,
    length: seconds
  };
}

function cover(url) {
  if (!url) return '';
  const https = String(url).replace(/^http:\/\//, 'https://').replace(/\?param=[\d]+y[\d]+/, '');
  return `${https}?param=200y200`;
}

export function toMusic(x, { loggedIn = false } = {}) {
  const album = x.al || x.album || {};
  const artists = x.ar || x.artists || [];
  const image = cover(album.picUrl);
  const clock = durationClock(x.dt || x.duration);
  const fee = Number(x.privilege?.fee ?? x.fee ?? 0);
  const vip = fee === 1 || fee === 4;
  const noRight = Boolean(x.noCopyrightRcmd);
  const playable = !noRight && (!vip || loggedIn);
  const singer = Array.isArray(artists) ? artists.map(item => item.name).filter(Boolean).join(' / ') : '';
  return {
    id: String(x.id || ''),
    type: 'cloud',
    platform: 'cloud',
    name: x.name || '',
    rawName: x.name || '',
    artist: singer,
    singer,
    album: album.name || '',
    albumId: String(album.id || ''),
    ...clock,
    coverUrl: image,
    image,
    mediumImage: image,
    largeImage: image.replace('200y200', '600y600'),
    vip,
    playable,
    audition: false,
    url: '',
    lyricUrl: x.id ? `/api/v1/songs/cloud/${encodeURIComponent(x.id)}/lyric` : '',
    requestedBy: '',
    requestedByUid: '',
    remark: noRight ? '无版权' : (vip && !loggedIn ? 'VIP/付费，当前未登录网易云' : '')
  };
}

export async function cloudSearch(keyword, limit = 15, { loggedIn = false, cookie = '' } = {}) {
  const json = await weapiRequest(SEARCH, {
    s: String(keyword || '').replace(/[\s]+/g, '+'),
    limit: Math.min(Number(limit) || 15, 30),
    offset: 0,
    type: 1,
    strategy: 5,
    queryCorrect: true
  }, { cookie });
  const songs = json?.result?.songs;
  if (!Array.isArray(songs)) return [];
  return songs.map(item => toMusic(item, { loggedIn })).filter(item => item.id);
}

export async function cloudSongById(id, { loggedIn = false, cookie = '' } = {}) {
  const sid = String(id || '').trim();
  if (!sid) return null;
  const res = await fetch(`https://music.163.com/api/song/detail?ids=[${encodeURIComponent(sid)}]`, {
    headers: { 'User-Agent': UA, Referer: 'https://music.163.com', ...(cookie ? { Cookie: cookie } : {}) }
  });
  assertNotHalted(res);
  if (!res.ok) throw new Error(`网易云歌曲详情 HTTP ${res.status}`);
  const json = await res.json().catch(() => ({}));
  const song = Array.isArray(json?.songs) ? json.songs.find(item => String(item.id) === sid) || json.songs[0] : null;
  return song ? toMusic(song, { loggedIn }) : null;
}

export async function cloudPlayUrl(id, { cookie = '' } = {}) {
  const json = await weapiRequest(PLAY_URL, { ids: [String(id)], br: 320000 }, { cookie });
  const row = json?.data?.[0];
  let url = row?.url || '';
  if (url.startsWith('http://')) url = url.replace('http://', 'https://');
  if (!url) return { url: '', error: '网易云暂无播放地址（可能需要登录或无版权）', playable: false };
  return { url, error: '', playable: true, trial: Boolean(row.freeTrialInfo) };
}

export async function cloudLyric(id) {
  const res = await fetch(LYRIC(id), { headers: { 'User-Agent': UA, Referer: 'https://music.163.com' } });
  assertNotHalted(res);
  if (!res.ok) throw new Error(`网易云歌词 HTTP ${res.status}`);
  const json = await res.json().catch(() => ({}));
  return { lyric: json?.lrc?.lyric || '' };
}
