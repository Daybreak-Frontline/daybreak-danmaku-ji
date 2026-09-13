import type { LoginStatus, LyricCue, Music, MusicQuality, UserInfo } from '../type';

function resolveDanmakuApi() {
  const fromEnv = import.meta.env.VITE_DANMAKU_API;
  if (fromEnv) return String(fromEnv).replace(/\/$/, '');
  if (typeof location !== 'undefined') {
    const host = location.hostname;
    const port = location.port;
    if ((host === '127.0.0.1' || host === 'localhost') && port && port !== '5178' && port !== '5179') {
      return `${location.origin}/api/v1`;
    }
  }
  return 'http://127.0.0.1:54821/api/v1';
}

export const DANMAKU_API = resolveDanmakuApi().replace(/\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${DANMAKU_API}${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `点歌姬 API ${res.status}`);
  return data as T;
}

export async function search(keywords: string, offset = 0, sources?: string[]) {
  const extra = sources?.length ? `&sources=${encodeURIComponent(sources.join(','))}` : '';
  const data = await request<{ total: number; list: Music[] }>(`/songs/search?q=${encodeURIComponent(keywords)}&limit=30&offset=${offset}${extra}`);
  return { total: data.total, list: data.list.map(normalize) };
}

function songApiPath(music: Music, kind: 'play-url' | 'lyric') {
  const platform = ['qq', 'cloud', 'migu', 'bili'].includes(String(music.type)) ? music.type : (music.platform || 'qq');
  const contentId = music.contentId || (platform === 'migu' ? music.remark : '');
  const extra = contentId ? `?contentId=${encodeURIComponent(String(contentId))}` : '';
  return `/songs/${platform}/${encodeURIComponent(music.id)}/${kind}${extra}`;
}

export async function musicDetail(music: Music): Promise<Music> {
  const data = await request<{ url: string; error?: string; trial?: boolean; playable?: boolean; image?: string; coverUrl?: string; cid?: string }>(songApiPath(music, 'play-url'));
  music.url = data.url || '';
  music.audition = Boolean(data.trial);
  const cover = data.image || data.coverUrl || '';
  if (cover) {
    music.image = cover;
    music.mediumImage = cover;
    music.largeImage = cover;
    music.coverUrl = cover;
  }
  if (data.cid) music.contentId = String(data.cid);
  if (!music.url && data.error) {
    music.remark = data.error;
    music.playable = false;
  } else {
    music.playable = data.playable !== false;
  }
  return music;
}

export async function lyric(music: Music): Promise<string | { lyric: string; cues?: LyricCue[] }> {
  const data = await request<{ lyric: string; cues?: LyricCue[] }>(songApiPath(music, 'lyric'));
  return {
    lyric: data.lyric || '',
    cues: Array.isArray(data.cues) ? data.cues : undefined
  };
}

export async function musicById(id: string): Promise<Music | null> {
  const result = await search(id, 0);
  return result.list.find(item => item.id === id) || null;
}

export async function danmakuConfig() {
  return request<Record<string, unknown>>('/config');
}
export async function danmakuConfigSave(patch: Record<string, unknown>) {
  return request('/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
}
export interface DanmakuGift {
  id: number;
  name: string;
  icon: string;
  price: number;
  coinType: string;
  batteries: number;
}

export interface GiftRequestConfig {
  giftId: number;
  giftName: string;
  giftIcon: string;
  giftPrice: number;
  coinType: string;
  batteries: number;
}

export async function danmakuState() {
  return request<{
    current: Music | null;
    queue: Music[];
    history: Music[];
    playing: boolean;
    mode: string;
    accepting?: boolean;
    giftRequestEnabled?: boolean;
    giftRequest?: GiftRequestConfig;
    giftRequestQualifyMode?: 'specific' | 'threshold';
    giftRequestThreshold?: number;
    giftRequestCountMode?: 'once' | 'accumulate';
    giftSkipEnabled?: boolean;
    giftSkipAction?: 'instant' | 'credit';
    giftSkipExpireSec?: number;
    giftSkipQualifyMode?: 'specific' | 'threshold';
    giftSkipGift?: GiftRequestConfig;
    giftSkipThreshold?: number;
    songBlacklistEnabled?: boolean;
    songBlacklist?: string[];
  }>('/state');
}

export async function biliGifts() {
  return request<{
    list: DanmakuGift[];
    selected: GiftRequestConfig;
    skipSelected?: GiftRequestConfig;
    enabled: boolean;
    skipEnabled?: boolean;
    fetchedAt?: number;
    missing?: boolean;
  }>('/bili/gifts');
}
export async function danmakuQueueAdd(song: Music, requester = '') {
  return request('/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song, requester }) });
}
export async function danmakuQueueSnapshot(queue: Music[]) {
  return request('/queue/snapshot', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queue }) });
}
export async function danmakuQueueDelete(queueId: number) {
  return request(`/queue/${queueId}`, { method: 'DELETE' });
}
export async function danmakuHistoryAdd(song: Music, requester = '') {
  return request('/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song, requester }) });
}
export async function danmakuHistoryList() {
  return request<Music[]>('/history');
}
export async function danmakuHistoryClear() {
  return request<{ ok: boolean; history: Music[] }>('/history', { method: 'DELETE' });
}
export interface DanmakuLogItem {
  message: string;
  level?: string;
  at?: number;
}

export interface DanmakuLogFile {
  date: string;
  bytes: number;
}

export interface DanmakuLogArchive {
  date: string;
  items: DanmakuLogItem[];
  retentionDays: number;
  maxMb: number;
  usedBytes: number;
  files: DanmakuLogFile[];
}

export async function danmakuLogs(date?: string) {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  return request<DanmakuLogArchive>(`/logs${query}`);
}

export async function danmakuLogsSaveSettings(patch: { retentionDays?: number; maxMb?: number }) {
  return request<Omit<DanmakuLogArchive, 'date' | 'items'>>('/logs/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
}

export async function danmakuPlayerCurrent(song: Music, playing = true) {
  return request('/player/current', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song, playing }) });
}
export async function danmakuPlayerStatus(playing: boolean) {
  return request(playing ? '/player/play' : '/player/pause', { method: 'POST' });
}
export async function danmakuPlayerProgress(positionMs: number, durationMs = 0) {
  return request('/player/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ positionMs, durationMs }) });
}
export async function danmakuPlayerMode(mode: string) {
  return request('/player/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
}
export async function danmakuPlayerNext() {
  return request<{ next: Music | null; playing: boolean }>('/player/next', { method: 'POST' });
}
export async function danmakuPlayerFailure(song: Music | null, reason: string) {
  return request<{ skipped: boolean; paused: boolean; next: Music | null }>('/player/failure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song, reason }) });
}

export interface DanmakuAccount {
  source: Music['type'] | string;
  loggedIn: boolean;
  uid: string;
  name: string;
  image: string;
}

export interface IdlePlaylist {
  source: Music['type'] | string;
  id: string;
  name: string;
  image: string;
}

export async function danmakuMe(refresh = false) {
  return request<{ accounts: DanmakuAccount[]; idlePlaylistEnabled: boolean; idlePlaylist: IdlePlaylist | null }>(`/me${refresh ? '?refresh=1' : ''}`);
}

export async function danmakuPlaylists(source: string, offset = 0) {
  const data = await request<{ total: number; list: import('../type').Playlist[] }>(`/me/${encodeURIComponent(source)}/playlists?offset=${offset}`);
  return { total: data.total || 0, list: data.list || [] };
}

export async function danmakuPlaylistDetail(source: string, id: string, offset = 0) {
  const data = await request<{ total: number; list: Music[]; playlist: import('../type').Playlist | null }>(
    `/me/${encodeURIComponent(source)}/playlists/${encodeURIComponent(id)}?offset=${offset}`
  );
  return {
    total: data.total || 0,
    list: (data.list || []).map(normalize),
    playlist: data.playlist || null
  };
}

export async function qqAccountStatus() { return request<{ loggedIn: boolean; uin: string; rememberLogin: boolean; musicLogin?: boolean }>('/qq/account'); }
export async function qqLoginStart() { return request<{ sessionId: string; image: string; expiresIn: number }>('/qq/login/start', { method: 'POST' }); }
export async function qqLoginPoll(sessionId: string) { return request<{ loggedIn?: boolean; status?: string; message?: string; uin?: string; musicLogin?: boolean }>(`/qq/login/poll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) }); }
export async function qqLogout() { return request('/qq/account', { method: 'DELETE' }); }

export async function cloudAccountStatus() {
  return request<{ loggedIn: boolean; uid: string; name: string; rememberLogin: boolean }>('/cloud/account');
}
export async function cloudLoginStart() {
  return request<{ sessionId: string; image: string; expiresIn: number }>('/cloud/login/start', { method: 'POST' });
}
export async function cloudLoginPoll(sessionId: string) {
  return request<{ loggedIn?: boolean; status?: string; message?: string; uid?: string; name?: string }>('/cloud/login/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) });
}
export async function cloudLogout() { return request('/cloud/account', { method: 'DELETE' }); }

export async function miguAccountStatus() {
  return request<{ loggedIn: boolean; uid: string; name: string; rememberLogin: boolean }>('/migu/account');
}
export async function miguLoginStart() {
  return request<{ sessionId: string; image: string; expiresIn: number }>('/migu/login/start', { method: 'POST' });
}
export async function miguLoginPoll(sessionId: string) {
  return request<{ loggedIn?: boolean; status?: string; message?: string; uid?: string; name?: string }>('/migu/login/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) });
}
export async function miguLogout() { return request('/migu/account', { method: 'DELETE' }); }

export async function biliAccountStatus() {
  return request<{ loggedIn: boolean; uid: string; rememberLogin: boolean; connection?: { state: string; roomId: number; lastPacketAt: number; retryCount: number; detail: string } }>('/bili/account');
}
export async function biliLoginStart() {
  return request<{ sessionId: string; image: string; expiresIn: number }>('/bili/login/start', { method: 'POST' });
}
export async function biliLoginPoll(sessionId: string) {
  return request<{ loggedIn?: boolean; status?: string; message?: string; uid?: string }>('/bili/login/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) });
}
export async function biliLogout() { return request('/bili/account', { method: 'DELETE' }); }
export async function biliConnect(room: string) {
  return request<{ ok: boolean; error?: string; connection: { state: string; roomId: number; lastPacketAt: number; retryCount: number; detail: string } }>('/bili/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room }) });
}
export async function biliDisconnect() {
  return request<{ ok: boolean; connection: { state: string; detail: string } }>('/bili/disconnect', { method: 'POST' });
}

export function setPlayQuality(_quality: MusicQuality) {}
export function setDownloadQuality(_quality: MusicQuality) {}
export function getCookie() { return ''; }
export function subscribeCookieChanged(_func: ((cookie: string | Record<string, string>) => void) | null) {}
export async function userInfo(_cookie: string | Record<string, string>): Promise<UserInfo | null> { return null; }
export async function qrCodeKey(): Promise<{ key: string; url: string } | null> { return null; }
export async function loginStatus(_key: string): Promise<{ status: LoginStatus; user?: UserInfo }> { return { status: 'fail' }; }

function normalize(music: Music): Music {
  return {
    ...music,
    image: music.image || music.coverUrl || '',
    mediumImage: music.mediumImage || music.image || music.coverUrl || '',
    largeImage: music.largeImage || music.image || music.coverUrl || '',
    singer: music.singer || music.artist || '',
    album: music.album || '',
    albumId: music.albumId || '',
    duration: music.duration || '00:00',
    length: music.length || music.durationSec || 0,
    vip: Boolean(music.vip),
    playable: music.playable !== false,
    audition: Boolean(music.audition || music.trialDurationSec),
    type: (['qq', 'cloud', 'migu', 'bili'].includes(String(music.type)) ? music.type : music.platform || 'qq') as Music['type']
  };
}
