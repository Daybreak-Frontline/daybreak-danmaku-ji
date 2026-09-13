import type { Music } from './type';

/** 播放列表来源。第三种 origin（例如以后的 B 站 BV）走服务端音源注册表，不要在这里先加枚举。 */
export type ActiveListKind = 'request' | 'library';

export const REQUEST_ORIGIN = 'request' as const;
export const LIBRARY_ORIGIN = 'library' as const;

export function markRequestOrigin<T extends { origin?: string }>(song: T): T {
  if (!song.origin) song.origin = REQUEST_ORIGIN;
  return song;
}

export function markLibraryOrigin<T extends { origin?: string }>(song: T): T {
  song.origin = LIBRARY_ORIGIN;
  return song;
}

export function requestQueueKey(
  queue?: Array<{ type?: string; id?: string; queueId?: string | number }> | null
) {
  if (!queue?.length) return '';
  return queue.map(item => `${item.type || ''}:${item.id || ''}:${item.queueId || ''}`).join('|');
}

export function isRequestQueueSong(
  song?: Pick<Music, 'origin' | 'queueId'> | null,
  listKind: ActiveListKind = 'request'
): boolean {
  if (!song) return false;
  if (song.origin === LIBRARY_ORIGIN) return false;
  if (song.origin === REQUEST_ORIGIN || song.queueId) return true;
  return listKind === 'request';
}
