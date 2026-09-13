import { persistableSong } from './qq-provider.mjs';
import { songKey } from './sources.mjs';
import { runHooks } from './command-hooks.mjs';

export function createQueue({ db, getState, snapshot, broadcast, setPlayback, log }) {
  function mapQueueRow(row) {
    const song = persistableSong(JSON.parse(row.song_json));
    return {
      ...song,
      queueId: row.id,
      requester: row.requester,
      requestedBy: song.requestedBy || row.requester || '',
      requestedByUid: row.requested_by_uid || song.requestedByUid || '',
      origin: song.origin || 'request',
      status: row.status
    };
  }

  function isRequestQueueSong(song) {
    if (!song) return false;
    return song.origin !== 'library';
  }

  function consumeCurrentFromQueue() {
    const state = getState();
    const song = state.current;
    if (!isRequestQueueSong(song)) return;
    if (song.queueId) {
      db.prepare('DELETE FROM queue_items WHERE id=?').run(Number(song.queueId));
      return;
    }
    const key = songKey(song);
    if (key) db.prepare("DELETE FROM queue_items WHERE song_id=? AND status='queued'").run(key);
  }

  function queueNext(auto = false) {
    const state = getState();
    const list = snapshot().queue;
    if (state.mode === 'single' && state.current) return persistableSong(state.current);
    if (!list.length) return null;
    if (state.mode === 'random') return list[Math.floor(Math.random() * list.length)];
    const currentId = songKey(state.current);
    const currentIndex = list.findIndex(item => songKey(item) === currentId);
    if (state.mode === 'order') {
      const nextIndex = currentIndex < 0 ? 0 : currentIndex + 1;
      if (auto && nextIndex >= list.length) return null;
      return list[Math.min(nextIndex, list.length - 1)] || null;
    }
    const nextIndex = currentIndex < 0 ? 0 : currentIndex + 1;
    return list[nextIndex] || list[0];
  }

  function currentStillQueued(list = snapshot().queue) {
    const currentKey = songKey(getState().current);
    return Boolean(currentKey && list.some(item => songKey(item) === currentKey));
  }

  function startQueuedIfIdle() {
    const state = getState();
    const list = snapshot().queue;
    if (!list.length || currentStillQueued(list)) return false;
    const next = list[0];
    state.current = persistableSong(next);
    state.currentTime = 0;
    state.positionMs = 0;
    state.duration = Number(next.length || next.durationSec || 0);
    state.playing = true;
    state.loading = false;
    state.consecutiveFailures = 0;
    setPlayback({}, 'play');
    return true;
  }

  function enqueueSong(song, mode = 'normal') {
    const state = getState();
    const item = persistableSong(song);
    const key = songKey(item);
    if (!key) return;
    if (mode === 'playNow' || mode === 'top') {
      const max = db.prepare("SELECT COALESCE(MIN(position),0) n FROM queue_items WHERE status='queued'").get().n;
      db.prepare('INSERT INTO queue_items(song_id,song_json,requester,requested_by_uid,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
        .run(key, JSON.stringify(item), String(item.requestedBy || ''), String(item.requestedByUid || ''), max - 1, Date.now(), Date.now());
    } else {
      const exists = db.prepare("SELECT id FROM queue_items WHERE song_id=? AND status='queued' LIMIT 1").get(key);
      if (!exists) {
        const max = db.prepare("SELECT COALESCE(MAX(position),-1) n FROM queue_items WHERE status='queued'").get().n;
        db.prepare('INSERT INTO queue_items(song_id,song_json,requester,requested_by_uid,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
          .run(key, JSON.stringify(item), String(item.requestedBy || ''), String(item.requestedByUid || ''), max + 1, Date.now(), Date.now());
      }
    }
    state.consecutiveFailures = 0;
    if (!startQueuedIfIdle()) broadcast('snapshot', snapshot());
  }

  function matchQueueItem(keyword, user) {
    const list = snapshot().queue;
    const kw = String(keyword || '').trim().toLowerCase();
    if (kw) return list.find(item => String(item.name || '').toLowerCase().includes(kw) || String(item.id) === kw);
    if (user?.uid) return [...list].reverse().find(item => item.requestedByUid === user.uid);
    return list[0];
  }

  function topQueue(keyword, user) {
    const item = matchQueueItem(keyword, user);
    if (!item?.queueId) return;
    const min = db.prepare("SELECT COALESCE(MIN(position),0) n FROM queue_items WHERE status='queued'").get().n;
    db.prepare('UPDATE queue_items SET position=?, updated_at=? WHERE id=?').run(min - 1, Date.now(), item.queueId);
    log(`[置顶] ${item.name}${user?.name ? ` · ${user.name}` : ''}`);
    broadcast('snapshot', snapshot());
  }

  function removeQueue(keyword, user) {
    const item = matchQueueItem(keyword, user);
    if (!item?.queueId) return;
    db.prepare('DELETE FROM queue_items WHERE id=?').run(item.queueId);
    log(`[移除] ${item.name}${user?.name ? ` · ${user.name}` : ''}`);
    broadcast('snapshot', snapshot());
  }

  function skipQueue(user) {
    const state = getState();
    log(`[切歌]${user?.name ? ` ${user.name}` : ''}`);
    runHooks('onSkip', { user });
    consumeCurrentFromQueue();
    const next = snapshot().queue[0] || null;
    if (!next) {
      state.current = null;
      state.playing = false;
      setPlayback({}, 'pause');
      return;
    }
    state.current = persistableSong(next);
    state.currentTime = 0;
    state.duration = Number(next.length || next.durationSec || 0);
    state.playing = true;
    setPlayback({}, 'play');
  }

  return {
    mapQueueRow,
    consumeCurrentFromQueue,
    queueNext,
    startQueuedIfIdle,
    enqueueSong,
    topQueue,
    removeQueue,
    skipQueue
  };
}
