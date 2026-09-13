const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const GUID = '1429839143';
const SIGN = 'zzannc1o6o9b4i971602f3554385022046ab796512b7012';
const MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const SEARCH_FALLBACK = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp';
const LYRIC = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg';
const QQ_HEADERS = { 'User-Agent': UA, Referer: 'https://y.qq.com/' };

export class HaltedError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'HaltedError';
    this.status = status;
    this.halt = true;
  }
}

function assertNotHalted(res) {
  if (res.status === 403 || res.status === 429) {
    throw new HaltedError(`QQ接口 HTTP ${res.status}，已停止对应流程`, res.status);
  }
}

function cover(mid) {
  return mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg?max_age=2592000` : '';
}

function durationClock(seconds) {
  const n = Number(seconds) || 0;
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
}

function albumMid(x) {
  return x?.album?.mid || x?.album?.pmid || x?.albummid || x?.albumMid || x?.albumpmid || '';
}

function trialFrom(x, durationSec = 0) {
  const file = x.file || {};
  const begin = Number(file.try_begin ?? x.try_begin ?? 0);
  const end = Number(file.try_end ?? x.try_end ?? 0);
  if (!(end > begin && end > 0)) return 0;
  let trial = end - begin;
  if (trial > 600 || (durationSec > 0 && trial > durationSec * 2)) {
    trial = Math.round(trial / 1000);
  }
  if (durationSec > 0) trial = Math.min(trial, durationSec);
  return trial > 0 ? trial : 0;
}

export function persistableSong(song) {
  if (!song || typeof song !== 'object') return song;
  const copy = { ...song, url: '' };
  delete copy.playUrl;
  copy.type = copy.type || copy.platform || 'qq';
  copy.platform = copy.platform || copy.type;
  return copy;
}

export function toMusic(x, extra = {}) {
  const id = String(x.songmid || x.mid || x.id || '');
  const seconds = Number(x.interval || x.duration || extra.durationSec || 0);
  const vip = Boolean(x.pay && (x.pay.payplay || x.pay.pay_play || x.pay.payalbum));
  const trialDurationSec = trialFrom(x, seconds);
  const playable = extra.playable ?? (!vip || extra.loggedIn);
  const image = cover(albumMid(x));
  const name = x.songname || x.name || extra.name || '';
  const singer = Array.isArray(x.singer) ? x.singer.map(s => s.name).filter(Boolean).join(' / ') : (x.singer || extra.artist || '');
  return {
    id,
    type: 'qq',
    platform: 'qq',
    name,
    rawName: name,
    artist: singer,
    singer,
    album: x.albumname || x.album?.name || extra.album || '',
    albumId: albumMid(x),
    durationSec: seconds,
    duration: durationClock(seconds),
    length: seconds,
    coverUrl: image,
    image,
    mediumImage: image,
    largeImage: image,
    vip,
    playable,
    audition: trialDurationSec > 0,
    trialDurationSec: trialDurationSec || undefined,
    url: '',
    lyricUrl: id ? `/api/v1/songs/qq/${encodeURIComponent(id)}/lyric` : '',
    requestedBy: extra.requestedBy || extra.requester || '',
    requestedByUid: extra.requestedByUid || '',
    remark: playable ? (trialDurationSec ? `试听 ${trialDurationSec} 秒` : '') : (vip ? 'VIP/付费，当前账号不可播' : '暂不可播')
  };
}

function extractSearchList(data) {
  const candidates = [
    data?.req_1?.data?.body?.item_song,
    data?.req_1?.data?.body?.song?.list,
    data?.req_0?.data?.body?.item_song,
    data?.req_0?.data?.body?.song?.list,
    data?.req?.data?.body?.item_song,
    data?.req?.data?.body?.song?.list,
    data?.data?.song?.list,
    data?.song?.list
  ];
  for (const list of candidates) {
    if (Array.isArray(list) && list.length) return list;
  }
  return [];
}

async function searchMusicu(keyword, limit, page) {
  const payload = {
    comm: { ct: 19, cv: 0, uin: '0', format: 'json', platform: 'yqq' },
    req_1: {
      method: 'DoSearchForQQMusicDesktop',
      module: 'music.search.SearchCgiService',
      param: {
        search_type: 0,
        query: keyword,
        page_num: page,
        num_per_page: Math.max(10, limit),
        grp: 1
      }
    }
  };
  const res = await fetch(MUSICU, {
    method: 'POST',
    headers: { ...QQ_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  assertNotHalted(res);
  if (!res.ok) throw new Error(`QQ musicu 搜索 HTTP ${res.status}`);
  return extractSearchList(await res.json());
}

async function searchClientCp(keyword, limit) {
  const p = new URLSearchParams({
    w: keyword,
    n: String(Math.max(10, limit)),
    p: '1',
    format: 'json',
    outCharset: 'utf-8',
    ct: '24',
    qqmusic_ver: '1298',
    remoteplace: 'txt.yqq.song',
    t: '0',
    aggr: '1',
    cr: '1',
    lossless: '0',
    flag_qc: '0',
    platform: 'yqq.json'
  });
  const res = await fetch(`${SEARCH_FALLBACK}?${p}`, { headers: QQ_HEADERS });
  assertNotHalted(res);
  if (!res.ok) throw new Error(`QQ client_search_cp HTTP ${res.status}`);
  return extractSearchList(await res.json());
}

export async function qqSearch(keyword, limit = 30, { loggedIn = false } = {}) {
  const page = 1;
  let list = [];
  try {
    list = await searchMusicu(keyword, limit, page);
  } catch (error) {
    if (error?.halt) throw error;
    list = [];
  }
  if (!list.length) list = await searchClientCp(keyword, limit);
  return list.map(item => toMusic(item, { loggedIn }));
}

export async function qqSongById(id, { loggedIn = false } = {}) {
  const sid = String(id || '').trim();
  if (!sid) return null;
  const numeric = /^\d+$/.test(sid);
  const payload = {
    comm: { ct: 24, cv: 0, uin: '0', format: 'json', platform: 'yqq.json' },
    req_1: {
      module: 'music.pf_song_detail_svr',
      method: 'get_song_detail_yqq',
      param: numeric ? { song_id: Number(sid), song_type: 0 } : { song_mid: sid, song_type: 0 }
    }
  };
  const res = await fetch(MUSICU, {
    method: 'POST',
    headers: { ...QQ_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  assertNotHalted(res);
  if (!res.ok) throw new Error(`QQ 歌曲详情 HTTP ${res.status}`);
  const json = await res.json().catch(() => ({}));
  const track = json?.req_1?.data?.track_info || json?.req_1?.data?.info || json?.data?.track_info;
  if (track?.mid || track?.songmid || track?.id) return toMusic(track, { loggedIn });
  const fallback = await qqSearch(sid, 8, { loggedIn });
  return fallback.find(item => item.id === sid) || null;
}

const playUrlCache = new Map();
const PLAY_URL_TTL_MS = 8 * 60 * 1000;

function normalizeUin(uin, cookie = '') {
  const fromCookie = String(cookie || '').match(/(?:^|;\s*)(?:uin|wxuin)=o?(\d+)/i);
  const raw = String(fromCookie?.[1] || uin || '0').replace(/^o/i, '');
  return /^\d+$/.test(raw) ? raw : '0';
}

async function requestVkey(songId, filename, { uin, cookie, via }) {
  const loginflag = cookie ? 1 : 0;
  const data = {
    comm: {
      cv: 4747474,
      ct: 24,
      format: 'json',
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'yqq.json',
      needNewCode: 1,
      uin,
      guid: GUID
    },
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param: {
        filename,
        guid: GUID,
        songmid: [songId],
        songtype: [0],
        uin,
        loginflag,
        platform: '20'
      }
    }
  };
  const headers = { ...QQ_HEADERS, ...(cookie ? { Cookie: cookie } : {}) };
  let res;
  if (via === 'urlget') {
    data.req_0 = {
      module: 'music.vkey.GetVkey',
      method: 'UrlGetVkey',
      param: { guid: GUID, songmid: [songId], songtype: [0], uin, loginflag, platform: '20' }
    };
  }
  if (via === 'post' || via === 'urlget') {
    res = await fetch(MUSICU, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } else {
    const p = new URLSearchParams({ format: 'json', sign: SIGN, data: JSON.stringify({
      req_0: data.req_0,
      loginUin: uin,
      comm: { uin, format: 'json', ct: 24, cv: 0 }
    }) });
    res = await fetch(`${MUSICU}?${p}`, { headers });
  }
  assertNotHalted(res);
  if (!res.ok) throw new Error(`QQ GetVkey HTTP ${res.status}`);
  return res.json();
}

function parseVkey(json) {
  const info = json?.req_0?.data;
  const item = info?.midurlinfo?.[0];
  if (!item?.purl) {
    return { url: '', code: json?.req_0?.code, emptyPurl: item ? item.purl === '' : null };
  }
  const domain = (info?.sip || []).find(x => !String(x).startsWith('http://ws')) || info?.sip?.[0] || 'https://dl.stream.qqmusic.qq.com/';
  return { url: `${String(domain).replace('http://', 'https://')}${item.purl}`, code: json?.req_0?.code, emptyPurl: false };
}

export async function qqPlayUrl(songId, { uin = '0', cookie = '', loggedIn = false, vip = false } = {}) {
  const loginUin = normalizeUin(uin, cookie);
  const cacheKey = `${songId}:${loginUin}:${cookie ? '1' : '0'}`;
  const cached = playUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { url: cached.url, error: '', trial: cached.trial, playable: true };
  }
  const filenames = cookie
    ? [[], [`C400${songId}${songId}.m4a`], [`M800${songId}${songId}.mp3`], [`M500${songId}${songId}.mp3`]]
    : [[`M500${songId}${songId}.mp3`], []];
  const vias = cookie ? ['post', 'urlget', 'get'] : ['get'];
  let last = null;
  for (const via of vias) {
    for (const filename of filenames) {
      const json = await requestVkey(songId, filename, { uin: loginUin, cookie, via });
      const parsed = parseVkey(json);
      last = parsed;
      if (!parsed.url) continue;
      playUrlCache.set(cacheKey, { url: parsed.url, expiresAt: Date.now() + PLAY_URL_TTL_MS, trial: false });
      return { url: parsed.url, error: '', playable: true, trial: false };
    }
  }
  const reason = cookie
    ? (vip
      ? '当前 QQ 登录态无法获取该 VIP/付费曲播放地址（账号可能未开通绿钻，或需重新扫码完成音乐登录）'
      : '暂无播放链接（无版权，或 QQ 音乐登录未完成）')
    : '暂无播放链接（可能需要 QQ 登录或该曲不可播）';
  return { url: '', error: reason, playable: false, trial: last?.emptyPurl === true };
}

export async function qqLyric(songId) {
  const res = await fetch(`${LYRIC}?format=json&nobase64=0&songmid=${encodeURIComponent(songId)}`, {
    headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/' }
  });
  assertNotHalted(res);
  if (!res.ok) throw new Error(`QQ歌词 HTTP ${res.status}`);
  const data = await res.json();
  const raw = data?.lyric || '';
  if (!raw) return { lyric: '' };
  if (String(raw).includes('[')) return { lyric: String(raw) };
  try {
    return { lyric: Buffer.from(raw, 'base64').toString('utf8') };
  } catch {
    return { lyric: String(raw) };
  }
}
