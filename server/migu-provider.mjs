import { HaltedError } from './qq-provider.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36';
const BY = '22210ca73bf1af2ec2eace74a96ee356';
const MIGU_KEY = 'Jk8qzuePiJ1qE3mDYhLQ3T73DtDoAhLP';
const SEARCH = 'https://app.u.nf.migu.cn/pc/resource/song/item/search/v1.0';
const LISTEN = 'https://app.c.nf.migu.cn/strategy/pc/listen/v2.0';

function assertNotHalted(res) {
  if (res.status === 403 || res.status === 429) {
    throw new HaltedError(`咪咕接口 HTTP ${res.status}，已停止对应流程`, res.status);
  }
}

function decryptListen(buf) {
  const e = Buffer.from(buf);
  if (e.length <= 4) return '';
  const t = e[3];
  const a = Buffer.from(MIGU_KEY);
  const o = Buffer.alloc(e.length - 4);
  for (let c = 4, s = 0; c < e.length; c++, s++) o[s] = (e[c] + t - a[s % a.length]) & 0xff;
  return o.toString('utf8');
}

function durationClock(seconds) {
  const n = Math.max(0, Math.round(Number(seconds) || 0));
  return {
    durationSec: n,
    duration: `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`,
    length: n
  };
}

function padHttps(url) {
  if (!url) return '';
  let s = String(url);
  if (s.startsWith('//')) s = `https:${s}`;
  return s.replace(/^http:\/\//, 'https://');
}

function imageOf(x) {
  const prefix = 'https://d.musicapp.migu.cn';
  const pick = x.img2 || x.img1 || x.img3 || x.albumImgs?.find(item => item.imgSizeType === '02')?.img || '';
  if (!pick) return '';
  return pick.startsWith('http') ? padHttps(pick) : prefix + pick;
}

export function toMusic(x, { loggedIn = false } = {}) {
  const id = String(x.copyrightId || x.id || '');
  const contentId = String(x.contentId || x.songId || '');
  const singer = Array.isArray(x.singerList) ? x.singerList.map(item => item.name).filter(Boolean).join(' / ') : '';
  const image = imageOf(x);
  const vip = Boolean(x.downloadTags?.includes('vip') || x.vipFlag === 1);
  return {
    id,
    type: 'migu',
    platform: 'migu',
    name: x.name || x.songName || '',
    rawName: x.name || x.songName || '',
    artist: singer,
    singer,
    album: x.album || '',
    albumId: String(x.albumId || ''),
    ...durationClock(x.duration || 0),
    coverUrl: image,
    image,
    mediumImage: image,
    largeImage: image,
    vip,
    playable: !vip || loggedIn,
    audition: false,
    url: '',
    contentId,
    lyricUrl: id ? `/api/v1/songs/migu/${encodeURIComponent(id)}/lyric` : '',
    requestedBy: '',
    requestedByUid: '',
    remark: contentId
  };
}

export async function miguSearch(keyword, limit = 15, { loggedIn = false } = {}) {
  const url = `${SEARCH}?text=${encodeURIComponent(keyword).replace(/%20/g, '+')}&pageNo=1&pageSize=${Math.min(Number(limit) || 15, 30)}`;
  const res = await fetch(url, {
    headers: { by: BY, Referer: 'https://music.migu.cn/', 'User-Agent': UA }
  });
  assertNotHalted(res);
  if (!res.ok) throw new Error(`咪咕搜索 HTTP ${res.status}`);
  const json = await res.json().catch(() => []);
  const rows = Array.isArray(json) ? json : (json?.data || []);
  return rows.map(item => toMusic(item, { loggedIn })).filter(item => item.id);
}

export async function miguSongById(id, { loggedIn = false } = {}) {
  const sid = String(id || '').trim();
  if (!sid) return null;
  const list = await miguSearch(sid, 15, { loggedIn });
  return list.find(item => item.id === sid || item.contentId === sid || item.remark === sid) || null;
}

async function listen(id, contentId, quality = 'PQ', { cookie = '', uid = '' } = {}) {
  const url = `${LISTEN}?contentId=${encodeURIComponent(contentId || '')}&copyrightId=${encodeURIComponent(id)}&scene=&netType=01&resourceType=2&toneFlag=${quality}`;
  const res = await fetch(url, {
    headers: {
      channel: '014X031',
      appid: 'h5',
      birth: 'h5page',
      signature: '1',
      referer: 'https://music.migu.cn/',
      'User-Agent': UA,
      ...(cookie ? { cookie } : {}),
      ...(uid ? { uid } : {})
    }
  });
  assertNotHalted(res);
  if (!res.ok) throw new Error(`咪咕播放地址 HTTP ${res.status}`);
  const text = decryptListen(await res.arrayBuffer());
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export async function miguPlayUrl(id, { contentId = '', cookie = '', uid = '' } = {}) {
  const auth = { cookie, uid };
  let json = await listen(id, contentId, 'PQ', auth);
  if (json?.data?.cannotCode === '440018') json = await listen(id, contentId, 'SQ', auth);
  const url = padHttps(json?.data?.url || '');
  const lyricUrl = json?.data?.lrcUrl || '';
  if (!url) return { url: '', error: '咪咕暂无播放地址（可能需要登录或缺少 contentId）', playable: false, lyricUrl };
  return { url, error: '', playable: true, trial: false, lyricUrl };
}

export async function miguLyric(id, extras = {}) {
  const play = await miguPlayUrl(id, extras);
  if (!play.lyricUrl) return { lyric: '' };
  const res = await fetch(play.lyricUrl, { headers: { 'User-Agent': UA } });
  assertNotHalted(res);
  if (!res.ok) return { lyric: '' };
  return { lyric: await res.text().catch(() => '') };
}
