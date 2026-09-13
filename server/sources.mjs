import { HaltedError, qqLyric, qqPlayUrl, qqSearch, qqSongById } from './qq-provider.mjs';
import { cloudLyric, cloudPlayUrl, cloudSearch, cloudSongById } from './cloud-provider.mjs';
import { miguLyric, miguPlayUrl, miguSearch, miguSongById } from './migu-provider.mjs';
import { biliLyric, biliPlayUrl, biliSearch, biliSongById, parseBvid } from './bili-provider.mjs';

export { parseBvid };

const registry = new Map();
export const SOURCE_IDS = [];
export const SOURCE_LABELS = {};
export const DEFAULT_ENABLED_SOURCES = ['qq'];
const SOURCE_ALIASES = {};

export function registerSource(source) {
  const id = String(source?.id || '').trim().toLowerCase();
  if (!id) throw new Error('registerSource: missing id');
  if (registry.has(id)) throw new Error(`registerSource: duplicate id ${id}`);
  registry.set(id, {
    id,
    label: source.label || id,
    aliases: [id, ...(source.aliases || []).map(item => String(item).trim().toLowerCase()).filter(Boolean)],
    search: source.search,
    lookup: source.lookup,
    playUrl: source.playUrl,
    lyric: source.lyric
  });
  SOURCE_IDS.push(id);
  SOURCE_LABELS[id] = source.label || id;
  SOURCE_ALIASES[id] = registry.get(id).aliases;
  return registry.get(id);
}

export function getRegisteredSource(id) {
  return registry.get(String(id || '').trim().toLowerCase()) || null;
}

function sourceIdPattern() {
  return SOURCE_IDS.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') || 'qq';
}

export function parseSourceAlias(token) {
  const t = String(token || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return '';
  for (const id of SOURCE_IDS) {
    if (t === id || SOURCE_ALIASES[id].includes(t)) return id;
  }
  return '';
}

export function splitOrderKeyword(raw) {
  const text = String(raw || '').trim();
  const bvid = parseBvid(text);
  if (bvid) {
    return { platform: 'bili', keyword: bvid, songId: bvid };
  }
  const colon = text.match(new RegExp(`^(${sourceIdPattern()})[:/]([A-Za-z0-9_\\-]{2,})$`, 'i'));
  if (colon) {
    return { platform: colon[1].toLowerCase(), keyword: colon[2], songId: colon[2] };
  }
  const bareId = text.match(/^id\s+([A-Za-z0-9_\-]{2,})$/i);
  if (bareId) {
    const id = bareId[1];
    const idBvid = parseBvid(id);
    if (idBvid) return { platform: 'bili', keyword: idBvid, songId: idBvid };
    return { platform: '', keyword: id, songId: id };
  }
  const idCmd = text.match(/^(.+?)\s*id\s+([A-Za-z0-9_\-]{2,})$/i);
  if (idCmd) {
    const platform = parseSourceAlias(idCmd[1].replace(/id$/i, '').trim());
    if (platform) return { platform, keyword: idCmd[2], songId: idCmd[2] };
  }
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const platform = parseSourceAlias(parts[0]);
    if (platform) return { platform, keyword: parts.slice(1).join(' '), songId: '' };
  }
  return { platform: '', keyword: text, songId: '' };
}

export function normalizeSources(input) {
  const list = (Array.isArray(input) ? input : String(input || '').split(','))
    .map(item => String(item || '').trim().toLowerCase())
    .filter(item => SOURCE_IDS.includes(item));
  const unique = [...new Set(list)];
  return unique.length ? unique : [...DEFAULT_ENABLED_SOURCES];
}

export function songKey(song) {
  if (!song?.id) return '';
  const type = SOURCE_IDS.includes(song.type) ? song.type : (SOURCE_IDS.includes(song.platform) ? song.platform : 'qq');
  return `${type}:${song.id}`;
}

export function parseSongRef(raw, fallbackType = 'qq') {
  const text = decodeURIComponent(String(raw || ''));
  const match = text.match(new RegExp(`^(${sourceIdPattern()})[:/](.+)$`, 'i'));
  if (match) return { platform: match[1].toLowerCase(), id: match[2] };
  return { platform: SOURCE_IDS.includes(fallbackType) ? fallbackType : 'qq', id: text };
}

async function searchOne(source, keyword, limit, extras) {
  const impl = getRegisteredSource(source);
  if (!impl?.search) return [];
  return impl.search(keyword, limit, extras || {});
}

export async function searchCatalog(keyword, limit = 30, extras = {}) {
  const bvid = parseBvid(keyword);
  if (bvid) {
    try {
      const song = await lookupCatalog('bili', bvid, extras);
      return { total: song ? 1 : 0, list: song ? [song] : [], sources: ['bili'], errors: [] };
    } catch (error) {
      if (error instanceof HaltedError || error?.halt) throw error;
      return { total: 0, list: [], sources: ['bili'], errors: [error?.message || String(error)] };
    }
  }
  const enabled = normalizeSources(extras.sources);
  const per = Math.max(5, Math.ceil(Math.min(Number(limit) || 30, 50) / enabled.length));
  const settled = await Promise.allSettled(enabled.map(async source => {
    try {
      return { source, list: await searchOne(source, keyword, per, extras) };
    } catch (error) {
      if (error instanceof HaltedError || error?.halt) throw error;
      return { source, list: [], error: error?.message || String(error) };
    }
  }));
  const lists = [];
  const errors = [];
  for (const item of settled) {
    if (item.status === 'rejected') {
      if (item.reason instanceof HaltedError || item.reason?.halt) throw item.reason;
      errors.push(item.reason?.message || String(item.reason));
      continue;
    }
    if (item.value.error) errors.push(`${item.value.source}: ${item.value.error}`);
    lists.push(item.value.list || []);
  }
  const list = lists.flat();
  return { total: list.length, list, sources: enabled, errors };
}

export function preferredSource(extras = {}) {
  return normalizeSources(extras.sources)[0] || DEFAULT_ENABLED_SOURCES[0];
}

export async function lookupCatalog(platform, id, extras = {}) {
  const bvid = parseBvid(id) || parseBvid(platform);
  if (bvid) {
    const impl = getRegisteredSource('bili');
    return impl?.lookup ? impl.lookup(bvid, extras || {}) : null;
  }
  const source = parseSourceAlias(platform)
    || (SOURCE_IDS.includes(platform) ? platform : '')
    || preferredSource(extras);
  const sid = String(id || '').trim();
  if (!source || !sid) return null;
  const impl = getRegisteredSource(source);
  if (!impl?.lookup) return null;
  return impl.lookup(sid, extras || {});
}

export async function playUrlFor(platform, id, extras = {}) {
  const impl = getRegisteredSource(platform) || getRegisteredSource('qq');
  return impl.playUrl(id, extras || {});
}

export async function lyricFor(platform, id, extras = {}) {
  const impl = getRegisteredSource(platform) || getRegisteredSource('qq');
  return impl.lyric(id, extras || {});
}

registerSource({
  id: 'qq',
  label: 'QQ音乐',
  aliases: ['qq音乐', 'qqmusic', 'q音'],
  search: (keyword, limit, extras) => qqSearch(keyword, limit, { loggedIn: extras.qqLoggedIn }),
  lookup: (id, extras) => qqSongById(id, { loggedIn: extras.qqLoggedIn }),
  playUrl: (id, extras) => qqPlayUrl(id, extras),
  lyric: id => qqLyric(id)
});

registerSource({
  id: 'cloud',
  label: '网易云音乐',
  aliases: ['网易', '网易云', '网易云音乐', 'netease', 'wyy'],
  search: (keyword, limit, extras) => cloudSearch(keyword, limit, { loggedIn: extras.cloudLoggedIn, cookie: extras.cloudCookie || '' }),
  lookup: (id, extras) => cloudSongById(id, { loggedIn: extras.cloudLoggedIn, cookie: extras.cloudCookie || '' }),
  playUrl: (id, extras) => cloudPlayUrl(id, { cookie: extras.cloudCookie || '' }),
  lyric: id => cloudLyric(id)
});

registerSource({
  id: 'bili',
  label: '哔哩哔哩',
  aliases: ['b站', 'bilibili', '哔哩哔哩'],
  search: (keyword, limit, extras) => biliSearch(keyword, limit, extras),
  lookup: (id, extras) => biliSongById(id, extras),
  playUrl: (id, extras) => biliPlayUrl(id, extras),
  lyric: (id, extras) => biliLyric(id, extras)
});

registerSource({
  id: 'migu',
  label: '咪咕音乐',
  aliases: ['咪咕', '咪咕音乐'],
  search: (keyword, limit, extras) => miguSearch(keyword, limit, { loggedIn: extras.miguLoggedIn }),
  lookup: (id, extras) => miguSongById(id, { loggedIn: extras.miguLoggedIn }),
  playUrl: (id, extras) => miguPlayUrl(id, {
    contentId: extras.contentId || '',
    cookie: extras.miguCookie || '',
    uid: extras.miguUid || ''
  }),
  lyric: (id, extras) => miguLyric(id, {
    contentId: extras.contentId || '',
    cookie: extras.miguCookie || '',
    uid: extras.miguUid || ''
  })
});
