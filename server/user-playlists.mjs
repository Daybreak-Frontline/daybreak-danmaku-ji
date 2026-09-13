import { weapiRequest, toMusic as cloudToMusic } from './cloud-provider.mjs';
import { toMusic as qqToMusic } from './qq-provider.mjs';
import { toMusic as miguToMusic } from './migu-provider.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const QQ_HEADERS = { 'User-Agent': UA, Referer: 'https://y.qq.com/' };
const MIGU_HEADERS = {
  by: '22210ca73bf1af2ec2eace74a96ee356',
  Referer: 'https://m.music.migu.cn/v4/playlist',
  appid: 'h5',
  'User-Agent': UA
};
const SOURCES = new Set(['qq', 'cloud', 'migu']);
const memo = new Map();
const inflight = new Map();

function cached(key, ttlMs, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.data);
  const pending = inflight.get(key);
  if (pending) return pending;
  const task = Promise.resolve()
    .then(fn)
    .then(data => {
      memo.set(key, { at: Date.now(), data });
      inflight.delete(key);
      return data;
    })
    .catch(error => {
      inflight.delete(key);
      throw error;
    });
  inflight.set(key, task);
  return task;
}

export function normalizeSource(value) {
  const source = String(value || '').toLowerCase();
  return SOURCES.has(source) ? source : '';
}

function cookieField(cookie, key) {
  const match = String(cookie || '').match(new RegExp(`(?:^|;\\s*)${key}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function httpsUrl(url) {
  if (!url) return '';
  let s = String(url);
  if (s.startsWith('//')) s = `https:${s}`;
  return s.replace(/^http:\/\//, 'https://');
}

function descHtml(text) {
  return text ? String(text).replace(/\n+/g, '<br />') : '';
}

async function fetchJson(url, { method = 'GET', headers = {}, body, cookie = '' } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...headers,
      ...(cookie ? { Cookie: cookie } : {})
    },
    ...(body != null ? { body } : {})
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function cloudProfile({ cookie, uid, name }) {
  const json = await weapiRequest('https://music.163.com/weapi/w/nuser/account/get?csrf_token=', {}, { cookie });
  const profile = json?.profile;
  if (!profile?.userId) {
    return { source: 'cloud', loggedIn: Boolean(cookie), uid: String(uid || cookieField(cookie, 'uid') || ''), name: name || '', image: '' };
  }
  return {
    source: 'cloud',
    loggedIn: true,
    uid: String(profile.userId),
    name: profile.nickname || name || '',
    image: httpsUrl(profile.avatarUrl || '')
  };
}

function qqHomepage(cookie) {
  return cached(`qq-home:${String(cookie).slice(0, 32)}`, 45 * 1000, () => fetchJson(
    'https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?cid=205360838&reqfrom=1',
    { headers: QQ_HEADERS, cookie }
  ));
}

async function qqProfile({ cookie, uid, name }) {
  const json = await qqHomepage(cookie);
  const creator = json?.data?.creator;
  if (!creator?.encrypt_uin && !creator?.nick) {
    return { source: 'qq', loggedIn: Boolean(cookie), uid: String(uid || cookieField(cookie, 'uin') || ''), name: name || '', image: '' };
  }
  return {
    source: 'qq',
    loggedIn: true,
    uid: String(creator.encrypt_uin || uid || cookieField(cookie, 'uin') || ''),
    name: creator.nick || name || '',
    image: httpsUrl(creator.headpic || '')
  };
}

async function miguProfile({ cookie, uid, name }) {
  const json = await fetchJson('https://app.c.nf.migu.cn/pc/user/h5/queryUserInfo/v1.0', { cookie });
  const item = json?.userInfoItem;
  if (!item?.userId) {
    return { source: 'migu', loggedIn: Boolean(cookie), uid: String(uid || ''), name: name || '', image: '' };
  }
  return {
    source: 'migu',
    loggedIn: true,
    uid: String(item.userId),
    name: item.nickName || name || '',
    image: httpsUrl(item.smallIcon || item.bigIcon || '')
  };
}

export async function accountProfile(source, account) {
  const loggedIn = Boolean(account?.cookie);
  const fallback = {
    source,
    loggedIn,
    uid: String(account?.uid || account?.uin || ''),
    name: account?.name || '',
    image: ''
  };
  if (!loggedIn) return fallback;
  try {
    if (source === 'cloud') return await cloudProfile(account);
    if (source === 'qq') return await qqProfile({ ...account, uid: account.uin || account.uid });
    if (source === 'migu') return await miguProfile(account);
  } catch {
    return fallback;
  }
  return fallback;
}

async function cloudPlaylists({ cookie, uid }, offset = 0) {
  const userId = String(uid || cookieField(cookie, 'uid') || '');
  if (!userId) throw new Error('未登录网易云，无法读取歌单');
  const json = await weapiRequest('https://music.163.com/weapi/user/playlist?csrf_token=', {
    uid: userId,
    wordwrap: '7',
    offset: String(offset),
    total: 'true',
    limit: '36',
    csrf_token: cookieField(cookie, '__csrf')
  }, { cookie });
  const rows = Array.isArray(json?.playlist) ? json.playlist : [];
  const list = rows.map(item => ({
    id: String(item.id || ''),
    name: item.name || '',
    description: descHtml(item.description || ''),
    image: httpsUrl(item.coverImgUrl || '') + (item.coverImgUrl ? '?param=200y200' : ''),
    type: 'cloud'
  })).filter(item => item.id);
  const pageFull = rows.length >= 36;
  return { total: pageFull ? offset + list.length + 1 : offset + list.length, list };
}

async function qqPlaylists({ cookie }) {
  const json = await qqHomepage(cookie);
  const list = [];
  const push = rows => {
    if (!Array.isArray(rows)) return;
    for (const item of rows) {
      const id = String(item.dissid || item.id || '');
      if (!id) continue;
      list.push({
        id,
        name: item.title || item.dissname || '',
        image: httpsUrl(item.picurl || item.pic || ''),
        type: 'qq'
      });
    }
  };
  push(json?.data?.mymusic);
  push(json?.data?.mydiss?.list);
  return { total: list.length, list };
}

async function miguPlaylists({ cookie }) {
  const json = await fetchJson('https://app.c.nf.migu.cn/pc/user/home-page/v2.0', { cookie });
  const list = [];
  const data = json?.data || {};
  for (const item of data.userPrivateItems || []) {
    const url = String(item.actionUrl || '');
    if (!url.includes('musicListId=')) continue;
    const id = url.includes('musicListId=') ? url.slice(url.indexOf('musicListId=') + 12) : '';
    if (!id) continue;
    list.push({ id: String(id), name: item.title || '', image: httpsUrl(item.picUrl || ''), type: 'migu' });
  }
  for (const item of data.myCollectedMusicLists?.collectMusicLists || []) {
    if (item.resourceType !== '2021') continue;
    list.push({
      id: String(item.musicListId || ''),
      name: item.title || '',
      image: httpsUrl(item.imgItem?.img || ''),
      type: 'migu'
    });
  }
  for (const item of data.myCreatedMusicLists?.createdMusicLists || []) {
    list.push({
      id: String(item.musicListId || ''),
      name: item.title || '',
      image: httpsUrl(item.imgItem?.img || ''),
      type: 'migu'
    });
  }
  return { total: list.length, list: list.filter(item => item.id) };
}

export async function listPlaylists(source, account, offset = 0) {
  if (!account?.cookie) throw new Error('未登录对应平台，无法读取歌单');
  const key = `pl:${source}:${account.uid || account.uin || ''}:${offset}`;
  return cached(key, 45 * 1000, () => {
    if (source === 'cloud') return cloudPlaylists(account, offset);
    if (source === 'qq') return qqPlaylists(account);
    if (source === 'migu') return miguPlaylists(account);
    throw new Error('不支持的音乐平台');
  });
}

async function cloudPlaylistDetail({ cookie }, id, offset = 0) {
  const json = await weapiRequest('https://music.163.com/weapi/v3/playlist/detail', {
    id: String(id),
    offset,
    total: false,
    limit: 1000,
    n: 1000
  }, { cookie });
  const pl = json?.playlist;
  if (!pl) throw new Error('未找到该网易云歌单');
  const tracks = Array.isArray(pl.tracks) ? pl.tracks : [];
  const list = tracks.map(item => cloudToMusic(item, { loggedIn: true })).filter(item => item.id);
  return {
    total: Number(pl.trackCount || list.length),
    list,
    playlist: {
      id: String(pl.id || id),
      name: pl.name || '',
      description: descHtml(pl.description || ''),
      image: httpsUrl(pl.coverImgUrl || ''),
      type: 'cloud'
    }
  };
}

async function qqPlaylistDetail({ cookie }, id, offset = 0) {
  const payload = {
    comm: {
      g_tk: 5381,
      uin: 0,
      format: 'json',
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      notice: 0,
      platform: 'h5',
      needNewCode: 1
    },
    req_0: {
      module: 'music.srfDissInfo.aiDissInfo',
      method: 'uniform_get_Dissinfo',
      param: {
        disstid: Number(id) || id,
        enc_host_uin: '',
        tag: 1,
        userinfo: 1,
        song_begin: Number(offset) || 0,
        song_num: 100
      }
    }
  };
  const json = await fetchJson('https://u.y.qq.com/cgi-bin/musicu.fcg?_webcgikey=uniform_get_Dissinfo', {
    method: 'POST',
    headers: { ...QQ_HEADERS, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(payload),
    cookie
  });
  const data = json?.req_0?.data;
  const info = data?.dirinfo;
  if (!info) throw new Error('未找到该 QQ 歌单');
  const songs = Array.isArray(data.songlist) ? data.songlist : [];
  return {
    total: Number(info.songnum || songs.length),
    list: songs.map(item => qqToMusic(item, { loggedIn: true })).filter(item => item.id),
    playlist: {
      id: String(info.id || id),
      name: info.title || '',
      description: descHtml(info.desc || ''),
      image: httpsUrl(info.picurl || ''),
      type: 'qq'
    }
  };
}

async function miguPlaylistInfo(id) {
  const json = await fetchJson(`https://app.c.nf.migu.cn/resource/playlist/v2.0?playlistId=${encodeURIComponent(id)}`, {
    headers: MIGU_HEADERS
  });
  const data = json?.data || {};
  return {
    id: String(data.musicListId || id),
    name: data.title || '',
    description: descHtml(data.summary || ''),
    image: httpsUrl(data.imgItem?.img || ''),
    type: 'migu'
  };
}

async function miguPlaylistDetail(_account, id, offset = 0) {
  const pageNo = Math.floor(Number(offset || 0) / 50) + 1;
  const json = await fetchJson(
    `https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?pageNo=${pageNo}&pageSize=50&playlistId=${encodeURIComponent(id)}`,
    { headers: MIGU_HEADERS }
  );
  const rows = Array.isArray(json?.data?.songList) ? json.data.songList : [];
  const list = rows.map(item => miguToMusic(item, { loggedIn: true })).filter(item => item.id);
  let playlist = { id: String(id), name: '', image: '', type: 'migu' };
  if (!offset) {
    try { playlist = await miguPlaylistInfo(id); } catch {}
  }
  return {
    total: Number(json?.data?.totalCount || list.length),
    list,
    playlist
  };
}

export async function playlistDetail(source, account, id, offset = 0) {
  if (!id) throw new Error('缺少歌单 ID');
  if (source === 'cloud' && !account?.cookie) throw new Error('未登录网易云，无法读取歌单详情');
  if (source === 'qq' && !account?.cookie) throw new Error('未登录 QQ 音乐，无法读取歌单详情');
  if (source === 'cloud') return cloudPlaylistDetail(account, id, offset);
  if (source === 'qq') return qqPlaylistDetail(account, id, offset);
  if (source === 'migu') return miguPlaylistDetail(account, id, offset);
  throw new Error('不支持的音乐平台');
}
