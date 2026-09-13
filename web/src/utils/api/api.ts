import {
  Music,
  MusicType,
  PlatformAPI,
  Playlist,
  PlaylistSearchItem,
  UserInfo,
  LoginStatus,
  MusicQuality,
  LyricCue
} from '../type';
import * as danmakuQq from './danmaku-qq';
import * as local from './local';

const musicAPI: Map<MusicType, PlatformAPI> = new Map([
  ['cloud', danmakuQq as PlatformAPI],
  ['qq', danmakuQq as PlatformAPI],
  ['migu', danmakuQq as PlatformAPI],
  ['bili', danmakuQq as PlatformAPI],
  ['local', local as PlatformAPI]
]);

export async function search(
  type: MusicType,
  keywords: string,
  offset: number
): Promise<{
  total: number;
  list: Music[];
}> {
  const func = musicAPI.get(type)?.search;
  try {
    if (func) return await func(keywords, offset);
  } catch (e) {
    console.error(e);
  }
  return {
    total: 0,
    list: []
  };
}

export async function searchPlaylist(
  type: MusicType,
  keywords: string,
  offset: number
): Promise<{
  total: number;
  list: PlaylistSearchItem[];
}> {
  const func = musicAPI.get(type)?.searchPlaylist;
  try {
    if (func) return await func(keywords, offset);
  } catch (e) {
    console.error(e);
  }
  return {
    total: 0,
    list: []
  };
}

export async function playlistDetail(
  type: MusicType,
  id: string,
  offset: number
): Promise<{
  total: number;
  list: Music[];
  playlist: Playlist | null;
}> {
  const func = musicAPI.get(type)?.playlistDetail;
  try {
    if (func) return await func(id, offset);
  } catch (e) {
    console.error(e);
  }
  return {
    total: 0,
    list: [],
    playlist: null
  };
}

export async function albumDetail(
  type: MusicType,
  id: string,
  offset: number
): Promise<{
  total: number;
  list: Music[];
  playlist: Playlist | null;
}> {
  const func = musicAPI.get(type)?.albumDetail;
  try {
    if (func) return await func(id, offset);
  } catch (e) {
    console.error(e);
  }
  return {
    total: 0,
    list: [],
    playlist: null
  };
}

export async function musicDetail(music: Music): Promise<Music | null> {
  const func = musicAPI.get(music.type)?.musicDetail;
  try {
    if (func) return await func(music);
  } catch (e) {
    console.error(e);
  }
  return null;
}

export async function qrCodeKey(type: MusicType): Promise<{
  key: string;
  url: string;
} | null> {
  const func = musicAPI.get(type)?.qrCodeKey;
  try {
    if (func) return await func();
  } catch (e) {
    console.error(e);
  }
  return null;
}

export async function loginStatus(
  type: MusicType,
  key: string
): Promise<{
  status: LoginStatus;
  user?: UserInfo;
}> {
  const func = musicAPI.get(type)?.loginStatus;
  try {
    if (func) return await func(key);
  } catch (e) {
    console.error(e);
  }
  return { status: 'fail' };
}

export async function userInfo(
  type: MusicType,
  cookie: Record<string, string> | string
): Promise<UserInfo | null> {
  const func = musicAPI.get(type)?.userInfo;
  try {
    if (func) return await func(cookie);
  } catch (e) {
    console.error(e);
  }
  return null;
}

export async function yours(
  type: MusicType,
  offset: number
): Promise<{
  total: number;
  list: Playlist[];
}> {
  const func = musicAPI.get(type)?.yours;
  try {
    if (func) return await func(offset);
  } catch (e) {
    console.error(e);
  }
  return {
    total: 0,
    list: []
  };
}

export async function musicById(
  type: MusicType,
  id: string
): Promise<Music | null> {
  const func = musicAPI.get(type)?.musicById;
  try {
    if (func) return await func(id);
  } catch (e) {
    console.error(e);
  }
  return null;
}

export async function parseLink(link: string): Promise<{
  type: MusicType;
  linkType: 'playlist' | 'music';
  id: string;
} | null> {
  try {
    for (let key of musicAPI.keys()) {
      const func = musicAPI.get(key)?.parseLink;
      if (func) {
        const result = await func(link);
        if (result) {
          return {
            ...result,
            type: key
          };
        }
      }
    }
  } catch (e) {}
  return null;
}

type LyricMeta = { lyric: string; cues?: LyricCue[] };
const lyricCache = new Map<string, LyricMeta>();
function normalizeLyric(raw: unknown): LyricMeta {
  if (typeof raw === 'string') return { lyric: raw };
  if (raw && typeof raw === 'object' && 'lyric' in raw) {
    const data = raw as LyricMeta;
    return {
      lyric: data.lyric || '',
      cues: Array.isArray(data.cues) ? data.cues : undefined
    };
  }
  return { lyric: '' };
}
export async function lyricMeta(music: Music): Promise<LyricMeta> {
  const key = music.type + music.id;
  const cache = lyricCache.get(key);
  if (cache) return cache;
  let meta: LyricMeta = { lyric: '' };
  try {
    meta = normalizeLyric(await musicAPI.get(music.type)?.lyric?.call(null, music));
  } catch (e) {
    console.error('get lyric err', e);
  }
  if (!meta.lyric && music.type === 'local') {
    try {
      meta = normalizeLyric(await musicAPI.get('cloud')?.lyricFuzzyMatch?.call(null, music));
    } catch (e) {
      console.error('fuzzy match lyric err', e);
    }
  }
  if (meta.lyric || meta.cues?.length) {
    lyricCache.set(key, meta);
  }
  return meta;
}
export async function lyric(music: Music): Promise<string> {
  return (await lyricMeta(music)).lyric;
}

export function setDownloadQuality(quality: MusicQuality) {
  for (let key of musicAPI.keys()) {
    musicAPI.get(key)?.setDownloadQuality?.call(null, quality);
  }
}

export function setPlayQuality(quality: MusicQuality) {
  for (let key of musicAPI.keys()) {
    musicAPI.get(key)?.setPlayQuality?.call(null, quality);
  }
}

export async function downloadUrl(music: Music): Promise<string> {
  try {
    return (
      (await musicAPI.get(music.type)?.downloadUrl?.call(null, music)) || ''
    );
  } catch {}
  return '';
}

export function subscribeCookieChanged(
  type: MusicType,
  func: ((cookie: string | Record<string, string>) => void) | null
) {
  musicAPI.get(type)?.subscribeCookieChanged?.call(null, func);
}

export async function refreshCookie(
  type: MusicType,
  cookie: string | Record<string, string>
): Promise<string | Record<string, string>> {
  const result = await musicAPI.get(type)?.refreshCookie?.call(null, cookie);
  return result || cookie;
}

export function getCookie(_type: MusicType) {
  return danmakuQq.getCookie();
}
