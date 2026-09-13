import { defineStore } from 'pinia';
import { ElMessage } from 'element-plus/es/components/message/index';
import * as api from '../utils/api/api';
import {
  Config,
  Music,
  MusicType,
  PlayDetailMode,
  PlayStatus,
  Playlist,
  SortType
} from '../utils/type';
import { musicOperate, getOrCreateLocalAudio } from '../utils/http';
import { danmakuQueueAdd, danmakuQueueSnapshot, danmakuHistoryAdd, danmakuLogs, danmakuState, danmakuPlayerCurrent, danmakuPlayerStatus, danmakuPlayerProgress, danmakuPlayerMode, danmakuPlayerFailure, danmakuConfig, danmakuConfigSave, danmakuPlaylistDetail, type DanmakuAccount, type IdlePlaylist } from '../utils/api/danmaku-qq';
import { StorageKey, storage } from '../utils/storage';
import {
  duration2Millisecond,
  generateGuid,
  getRandomInt,
  isInStandaloneMode,
  isSafari,
  messageOption,
  millisecond2Duration,
  musicLengthMs
} from '../utils/utils';
import { isIOS, useTitle } from '@vueuse/core';
import { LyricChange, LyricLineChange, LyricManager } from '../utils/lyric';
import {
  type ActiveListKind,
  isRequestQueueSong,
  markLibraryOrigin,
  markRequestOrigin,
  requestQueueKey
} from '../utils/request-queue';

const title = useTitle();

const lyricManager = new LyricManager();
let lastDanmakuProgressAt = 0;

export const usePlayStore = defineStore('play', {
  state: () => {
    return {
      config: {
        remote: false,
        storage: false,
        file: false,
        list: false,
        client: false,
        shortcut: false,
        lyric: false
      } as Config,
      music: {} as Music,
      musicList: [] as Music[],
      myLoves: [] as Music[],
      myLover: {} as Record<string, boolean>,
      myFavorites: [] as Playlist[],
      myFavorite: {} as any,
      myPlaylists: [] as Playlist[],
      myPlaylistsPreMusics: undefined as Music[] | undefined,
      sortType: SortType.Loop as SortType,
      musicHistory: [] as Music[],
      currentListShow: false,
      playDetailShow: false,
      selectPlaylistShow: false,
      desktopLyricShow: false,
      playerMode: 'default' as PlayDetailMode,
      playStatus: {
        currentTime: '00:00',
        loading: false,
        playing: false,
        stopped: true,
        totalTime: '',
        progress: 0,
        volume: 0,
        volumeCache: 100
      } as PlayStatus,
      currentListPopover: {
        show: false,
        timer: null as any
      },
      checkingStatus: false,
      nextPlay: null as Music | null,
      preparePlay: false,
      volumeDisableTimeout: null as any,
      danmakuConnection: {
        state: 'idle',
        roomId: 0,
        lastPacketAt: 0,
        retryCount: 0,
        detail: 'B站弹幕尚未接入，未扫码不可连接'
      },
      danmakuLogs: [] as Array<{ message: string; level?: string; at?: number }>,
      danmakuBiliRoom: '',
      danmakuAccepting: true,
      danmakuGiftRequest: false,
      danmakuGiftRequestQualifyMode: 'specific' as 'specific' | 'threshold',
      danmakuGiftRequestThreshold: 0,
      danmakuGiftRequestCountMode: 'once' as 'once' | 'accumulate',
      danmakuGiftSkip: false,
      danmakuGiftSkipAction: 'instant' as 'instant' | 'credit',
      danmakuGiftSkipExpireSec: 300,
      danmakuGiftSkipQualifyMode: 'specific' as 'specific' | 'threshold',
      danmakuGiftSkipThreshold: 0,
      danmakuSongBlacklist: false,
      danmakuSongBlacklistItems: [] as string[],
      danmakuGift: {
        giftId: 0,
        giftName: '',
        giftIcon: '',
        giftPrice: 0,
        coinType: 'gold',
        batteries: 0
      },
      danmakuGiftSkipGift: {
        giftId: 0,
        giftName: '',
        giftIcon: '',
        giftPrice: 0,
        coinType: 'gold',
        batteries: 0
      },
      danmakuIdlePlaylistEnabled: false,
      danmakuIdlePlaylist: null as IdlePlaylist | null,
      danmakuAccounts: [] as DanmakuAccount[],
      idleTracks: [] as Music[],
      idleTracksKey: '',
      idleTracksPromise: null as Promise<void> | null,
      activeListKind: 'request' as ActiveListKind,
      lastRequestQueueKey: '',
      suppressRequestQueueKey: ''
    };
  },
  actions: {
    applyDanmakuGiftConfig(data: Record<string, any> | null | undefined) {
      if (!data) return;
      if (typeof data.giftRequestEnabled === 'boolean') this.danmakuGiftRequest = data.giftRequestEnabled;
      if (data.giftRequest && typeof data.giftRequest === 'object') this.danmakuGift = data.giftRequest;
      if (data.giftRequestQualifyMode === 'specific' || data.giftRequestQualifyMode === 'threshold') {
        this.danmakuGiftRequestQualifyMode = data.giftRequestQualifyMode;
      }
      if (typeof data.giftRequestThreshold === 'number') this.danmakuGiftRequestThreshold = data.giftRequestThreshold;
      if (data.giftRequestCountMode === 'once' || data.giftRequestCountMode === 'accumulate') {
        this.danmakuGiftRequestCountMode = data.giftRequestCountMode;
      }
      if (typeof data.giftSkipEnabled === 'boolean') this.danmakuGiftSkip = data.giftSkipEnabled;
      if (data.giftSkipAction === 'instant' || data.giftSkipAction === 'credit') {
        this.danmakuGiftSkipAction = data.giftSkipAction;
      }
      if (typeof data.giftSkipExpireSec === 'number') this.danmakuGiftSkipExpireSec = data.giftSkipExpireSec;
      if (data.giftSkipQualifyMode === 'specific' || data.giftSkipQualifyMode === 'threshold') {
        this.danmakuGiftSkipQualifyMode = data.giftSkipQualifyMode;
      }
      if (data.giftSkipGift && typeof data.giftSkipGift === 'object') this.danmakuGiftSkipGift = data.giftSkipGift;
      if (typeof data.giftSkipThreshold === 'number') this.danmakuGiftSkipThreshold = data.giftSkipThreshold;
      this.applyDanmakuIdleConfig(data);
    },
    applyDanmakuIdleConfig(data: Record<string, any> | null | undefined) {
      if (!data) return;
      if (typeof data.idlePlaylistEnabled === 'boolean') this.danmakuIdlePlaylistEnabled = data.idlePlaylistEnabled;
      if (data.idlePlaylist === null) {
        this.danmakuIdlePlaylist = null;
        this.idleTracks = [];
        this.idleTracksKey = '';
        return;
      }
      if (data.idlePlaylist && typeof data.idlePlaylist === 'object' && data.idlePlaylist.id) {
        const next: IdlePlaylist = {
          source: String(data.idlePlaylist.source || data.idlePlaylist.type || ''),
          id: String(data.idlePlaylist.id),
          name: String(data.idlePlaylist.name || ''),
          image: String(data.idlePlaylist.image || '')
        };
        const key = `${next.source}:${next.id}`;
        this.danmakuIdlePlaylist = next;
        if (key !== this.idleTracksKey) {
          this.idleTracks = [];
          this.idleTracksKey = '';
        }
      }
    },
    setIdleTracks(tracks: Music[]) {
      this.idleTracks = (tracks || []).filter(item => item?.id).map(item => markLibraryOrigin({ ...item }));
    },
    replaceLibraryPlaylist(tracks: Music[]) {
      this.setActiveListKind('library');
      this.setIdleTracks(tracks);
      this.musicList.splice(0, this.musicList.length, ...this.idleTracks);
      storage.setValue(StorageKey.CurrentMusicList, this.musicList);
    },
    async playLibraryPlaylist(tracks: Music[], start?: Music) {
      const list = (tracks || []).filter(item => item?.id);
      if (!list.length) {
        ElMessage(messageOption('歌单是空的'));
        return;
      }
      this.preparePlay = false;
      this.nextPlay = null;
      this.suppressRequestQueueKey =
        this.lastRequestQueueKey ||
        (this.activeListKind === 'request' ? requestQueueKey(this.musicList) : '');
      await this.play(start, list, false, 'library');
    },
    async loadIdleTracks() {
      const selected = this.danmakuIdlePlaylist;
      if (!selected?.source || !selected.id) {
        this.idleTracks = [];
        this.idleTracksKey = '';
        this.idleTracksPromise = null;
        return;
      }
      const key = `${selected.source}:${selected.id}`;
      if (this.idleTracksKey === key && this.idleTracks.length) return;
      if (this.idleTracksPromise && this.idleTracksKey === key) return this.idleTracksPromise;
      this.idleTracksKey = key;
      this.idleTracksPromise = (async () => {
        const tracks: Music[] = [];
        try {
          for (let i = 0; i < 40; i++) {
            const result = await danmakuPlaylistDetail(selected.source, selected.id, tracks.length);
            const page = (result.list || []).filter(item => item?.id);
            if (!page.length) break;
            tracks.push(...page);
            if (tracks.length && !this.idleTracks.length) this.setIdleTracks(tracks);
            if (tracks.length >= (result.total || tracks.length)) break;
          }
        } catch (error) {
          console.warn('idle playlist load failed', error);
        }
        this.setIdleTracks(tracks);
      })();
      try {
        await this.idleTracksPromise;
      } finally {
        if (this.idleTracksKey === key) this.idleTracksPromise = null;
      }
    },
    async setIdlePlaylist(playlist: IdlePlaylist | null, tracks?: Music[]) {
      this.danmakuIdlePlaylist = playlist;
      if (playlist && tracks?.length) {
        this.setIdleTracks(tracks);
        this.idleTracksKey = `${playlist.source}:${playlist.id}`;
        const requestBusy =
          this.activeListKind === 'request' &&
          this.musicList.length > 0 &&
          this.playStatus.playing;
        if (!requestBusy) this.replaceLibraryPlaylist(tracks);
      } else if (!playlist) {
        this.idleTracks = [];
        this.idleTracksKey = '';
      } else {
        await this.loadIdleTracks();
      }
      await danmakuConfigSave({
        idlePlaylist: playlist,
        idlePlaylistEnabled: playlist ? true : this.danmakuIdlePlaylistEnabled
      });
      if (playlist) this.danmakuIdlePlaylistEnabled = true;
    },
    async startIdleIfNeeded() {
      if (!this.danmakuIdlePlaylistEnabled) return false;
      if (!this.idleTracks.length) await this.loadIdleTracks();
      if (!this.idleTracks.length) return false;
      const first = this.sortType === SortType.Random
        ? this.idleTracks[getRandomInt(0, this.idleTracks.length)]
        : this.idleTracks[0];
      await this.playLibraryPlaylist(this.idleTracks, first);
      return true;
    },
    rememberRequestQueue(queue?: Music[] | null) {
      this.lastRequestQueueKey = requestQueueKey(queue);
    },
    interruptIdleForRequests(queue: Music[]) {
      if (!queue?.length) return false;
      const key = requestQueueKey(queue);
      this.lastRequestQueueKey = key;
      if (this.suppressRequestQueueKey && key === this.suppressRequestQueueKey) {
        return false;
      }
      this.suppressRequestQueueKey = '';
      this.setActiveListKind('request');
      this.musicList.splice(0, this.musicList.length, ...queue);
      if (!this.preparePlay && queue[0]) this.play(queue[0], undefined, false, 'request');
      return true;
    },
    pushDanmakuLog(item: { message: string; level?: string; at?: number }) {
      if (!item?.message) return;
      const next = { message: item.message, level: item.level || 'info', at: item.at || Date.now() };
      const last = this.danmakuLogs[this.danmakuLogs.length - 1];
      if (last && last.message === next.message && Math.abs((last.at || 0) - next.at) < 400) return;
      this.danmakuLogs.push(next);
      if (this.danmakuLogs.length > 200) this.danmakuLogs.splice(0, this.danmakuLogs.length - 200);
    },
    replaceDanmakuLogs(items: Array<{ message: string; level?: string; at?: number }>) {
      this.danmakuLogs.splice(0, this.danmakuLogs.length, ...(items || []).slice(-200));
    },
    subscribeLyric(callback: LyricChange, cancel?: boolean) {
      lyricManager.subscribeLyric(callback, cancel, this.music);
    },
    subscribeLyricLine(callback: LyricLineChange, cancel?: boolean) {
      lyricManager.subscribeLyricLine(callback, cancel, this.music);
    },
    closeDesktopLyric() {
      this.desktopLyricShow = false;
      lyricManager.showInDesktop('', false);
    },
    showDesktopLyric(show: boolean) {
      if (isInStandaloneMode && isIOS && isSafari) {
        this.desktopLyricShow = false;
        ElMessage(messageOption('暂不支持'));
        return;
      }
      if (this.desktopLyricShow != show) this.desktopLyricShow = show;
      let title = this.music.name;
      if (this.music.singer) {
        title += ' - ' + this.music.singer;
      }
      lyricManager.showInDesktop(
        title,
        this.desktopLyricShow,
        this.closeDesktopLyric,
        this.music
      );
    },
    async clearMusicList() {
      this.musicList.splice(0, this.musicList.length);
      await this.pause();
      this.setCurrentMusic();
      storage.setValue(StorageKey.CurrentMusicList, this.musicList);
      Object.keys(this.music).map(k => {
        delete (this.music as any)[k];
      });
      this.updateRemoteList();
      if (this.activeListKind === 'request') {
        danmakuQueueSnapshot([]).catch(error => console.warn('queue clear persist failed', error));
      }
    },
    setActiveListKind(kind: ActiveListKind) {
      this.activeListKind = kind === 'library' ? 'library' : 'request';
    },
    persistRequestQueue() {
      if (this.activeListKind !== 'request') return Promise.resolve();
      const queue = this.musicList.filter(item => isRequestQueueSong(item, 'request'));
      return danmakuQueueSnapshot(queue).catch(error =>
        console.warn('queue persist failed', error)
      );
    },
    removeFinishedRequestSong() {
      if (!isRequestQueueSong(this.music, this.activeListKind)) return -1;
      const finishedIndex = this.musicList.findIndex(
        m => m.id == this.music.id && m.type == this.music.type
      );
      if (finishedIndex < 0) return -1;
      this.musicList.splice(finishedIndex, 1);
      storage.setValue(StorageKey.CurrentMusicList, this.musicList);
      return finishedIndex;
    },
    async replayCurrent() {
      if (!this.music?.id) return;
      this.playStatus.progress = 0;
      this.playStatus.stopped = true;
      try {
        await musicOperate('/progress', '0');
      } catch {}
      await this.play({ ...this.music });
    },
    setCurrentMusic(music?: Music, noSave?: boolean) {
      this.music.id = music?.id || '';
      this.music.name = music?.name || '';
      this.music.rawName = music?.rawName || '';
      this.music.image = music?.image || music?.coverUrl || '';
      this.music.mediumImage = music?.mediumImage || this.music.image;
      this.music.largeImage = music?.largeImage || this.music.image;
      this.music.coverUrl = music?.coverUrl || this.music.image;
      this.music.contentId = music?.contentId || '';
      this.music.singer = music?.singer || '';
      this.music.album = music?.album || '';
      this.music.albumId = music?.albumId || '';
      this.music.duration = music?.duration || '';
      this.music.length = music?.length || 0;
      this.music.vip = music?.vip || false;
      this.music.remark = music?.remark || '';
      this.music.type = music?.type || 'local';
      this.music.url = music?.url || '';
      this.music.lyricUrl = music?.lyricUrl || '';
      this.music.audition = music?.audition || false;
      this.music.playable = music?.playable;
      this.music.requestedBy = music?.requestedBy || '';
      this.music.origin = music?.origin;
      this.music.queueId = music?.queueId;
      !noSave && storage.setValue(StorageKey.CurrentMusic, this.music);
    },
    setSortType(type: SortType) {
      if (!type) return;
      this.sortType = type;
      musicOperate('/loop', this.sortType.toString());
      danmakuPlayerMode(this.sortType.toString()).catch(error => console.warn('mode persist failed', error));
      storage.setValue(StorageKey.SortType, this.sortType);
    },
    insertAfterCurrent(music: Music) {
      const keyOf = (item?: Music | null) => (item?.id ? `${item.type}:${item.id}` : '');
      const target = keyOf(music);
      if (!target) return;
      if (keyOf(this.music) === target) return;
      const existing = this.musicList.findIndex(item => keyOf(item) === target);
      if (existing >= 0) this.musicList.splice(existing, 1);
      const currentIndex = this.musicList.findIndex(item => keyOf(item) === keyOf(this.music));
      const item = this.activeListKind === 'request' ? markRequestOrigin({ ...music }) : { ...music };
      this.musicList.splice(currentIndex >= 0 ? currentIndex + 1 : 0, 0, item);
      storage.setValue(StorageKey.CurrentMusicList, this.musicList);
      this.persistRequestQueue();
    },
    setNextPlay(music: Music) {
      this.insertAfterCurrent(music);
      this.showCurrentListPopover();
      this.nextPlay = music;
      if (!this.playStatus.playing) {
        this.next();
      }
    },
    addHistory(musics: Music[], remove?: boolean, init?: boolean) {
      if (!Array.isArray(musics)) return;
      if (musics.length == this.musicHistory.length && remove) {
        this.musicHistory.splice(0, musics.length);
      } else
        musics.map(music => {
          var index = this.musicHistory.findIndex(
            m => m.id == music.id && m.type == music.type
          );
          if (index >= 0) this.musicHistory.splice(index, 1);
          if (!remove) {
            if (init) this.musicHistory.push({ ...music });
            else this.musicHistory.unshift({ ...music });
          }
        });
      if (!init)
        storage.setValue(StorageKey.CurrentMusicHistory, this.musicHistory);
    },
    async addMyLove(musics: Music[], remove?: boolean) {
      if (!Array.isArray(musics)) return;
      musics.map(music => {
        var index = this.myLoves.findIndex(
          m => m.id == music.id && m.type == music.type
        );
        if (remove) {
          if (index >= 0) this.myLoves.splice(index, 1);
        } else {
          if (index < 0) this.myLoves.push(music);
        }
      });
      Object.keys(this.myLover).map(m => {
        delete this.myLover[m];
      });
      this.myLoves.map(m => (this.myLover[m.type + m.id] = true));
      storage.setValue(StorageKey.MyLoves, this.myLoves);
      if (
        musics.length > 0 &&
        musics[0].type == this.music.type &&
        musics[0].id == this.music.id
      ) {
        this.setTitle();
      }
    },
    async addMyFavorite(playlists: Playlist[], remove?: boolean) {
      if (!Array.isArray(playlists)) return;
      playlists.map(playlist => {
        var index = this.myFavorites.findIndex(
          m => m.id == playlist.id && m.type == playlist.type
        );
        if (remove) {
          if (index >= 0) this.myFavorites.splice(index, 1);
        } else {
          if (index < 0) this.myFavorites.push(playlist);
        }
      });
      Object.keys(this.myFavorite).map(m => {
        delete this.myFavorite[m];
      });
      this.myFavorites.map(m => (this.myFavorite[m.type + m.id] = true));
      storage.setValue(StorageKey.MyFavorites, this.myFavorites);
    },
    showCurrentListPopover() {
      clearTimeout(this.currentListPopover.timer);
      this.currentListPopover.show = true;
      this.currentListPopover.timer = setTimeout(() => {
        this.currentListPopover.show = false;
      }, 3000);
    },
    beforeAddMyPlaylistsMusic(musics: Music[]) {
      this.myPlaylistsPreMusics = musics;
      this.selectPlaylistShow = true;
    },
    addMyPlaylistsMusic(
      playlistId: string,
      musics?: Music[],
      remove?: boolean
    ) {
      if (!musics || !Array.isArray(musics) || !playlistId) return;
      const playlist = this.myPlaylists.find(
        m => m.id == playlistId && m.type == 'local'
      );
      if (!playlist) return;
      if (!playlist.musicList) playlist.musicList = [];
      musics.map(music => {
        var index = playlist.musicList?.findIndex(
          m => m.id == music.id && m.type == music.type
        );
        if (index == null) index = -1;
        if (remove) {
          if (index >= 0) playlist.musicList?.splice(index, 1);
        } else {
          if (index < 0) playlist.musicList?.push(music);
        }
      });
      storage.setValue(StorageKey.MyPlaylists, this.myPlaylists);
      if (this.selectPlaylistShow) this.selectPlaylistShow = false;
    },
    createMyPlaylists(name: string) {
      this.myPlaylists.unshift({
        id: generateGuid(),
        name: name,
        image: '',
        type: 'local',
        musicList: []
      });
      storage.setValue(StorageKey.MyPlaylists, this.myPlaylists);
    },
    addMyPlaylists(playlists: Playlist[], remove?: boolean) {
      if (!Array.isArray(playlists)) return;
      playlists.map(playlist => {
        var index = this.myPlaylists.findIndex(
          m => m.id == playlist.id && m.type == playlist.type
        );
        if (remove) {
          if (index >= 0) this.myPlaylists.splice(index, 1);
        } else {
          if (index < 0) this.myPlaylists.push(playlist);
        }
      });
      storage.setValue(StorageKey.MyPlaylists, this.myPlaylists);
    },
    add(musics: Music[], noSet?: boolean, saved = true, update = true) {
      if (!musics || !Array.isArray(musics)) return;
      const lastLength = this.musicList.length;
      const added: Music[] = [];
      musics.map(music => {
        var index = this.musicList.findIndex(
          m => m.id == music.id && m.type == music.type
        );
        if (index < 0) {
          const item = this.activeListKind === 'request' ? markRequestOrigin(music) : music;
          this.musicList.push(item);
          added.push(item);
        }
      });
      saved &&
        lastLength != this.musicList.length &&
        storage.setValue(StorageKey.CurrentMusicList, this.musicList);
      if (!noSet && !this.music.id && this.musicList.length > 0) {
        this.setCurrentMusic(this.musicList[0]);
      }
      update && this.updateRemoteList();
      if (saved && this.activeListKind === 'request') {
        added.forEach(item => {
          danmakuQueueAdd(item).catch(error => console.warn('queue persist failed', error));
        });
      }
    },
    async isMusicUrlAvailable(url?: string) {
      if (!url || url.startsWith('blob:') || url.startsWith('data:')) {
        return true;
      }
      try {
        let res = await fetch(url, {
          method: 'HEAD'
        });
        if (res.ok || (res.status >= 200 && res.status < 400)) {
          return true;
        }
        res = await fetch(url, {
          method: 'GET',
          headers: {
            Range: 'bytes=0-1'
          }
        });
        return res.ok || (res.status >= 200 && res.status < 400);
      } catch {
        return true;
      }
    },
    async refreshMusicUrl(music: Music) {
      if (!music || music.type === 'local') return music;
      music.url = '';
      music.audition = false;
      await api.musicDetail(music);
      if (music.id == this.music.id && music.type == this.music.type) {
        this.music.url = music.url || '';
        this.music.lyricUrl = music.lyricUrl || '';
        this.music.audition = music.audition || false;
        if (music.image) {
          this.music.image = music.image;
          this.music.mediumImage = music.mediumImage || music.image;
          this.music.largeImage = music.largeImage || music.image;
          this.music.coverUrl = music.coverUrl || music.image;
        }
        if (music.contentId) this.music.contentId = music.contentId;
      }
      const musicInList = this.musicList.find(
        m => m.id == music.id && m.type == music.type
      );
      if (musicInList) {
        musicInList.url = music.url;
        musicInList.lyricUrl = music.lyricUrl;
        musicInList.audition = music.audition;
        if (music.image) {
          musicInList.image = music.image;
          musicInList.mediumImage = music.mediumImage || music.image;
          musicInList.largeImage = music.largeImage || music.image;
          musicInList.coverUrl = music.coverUrl || music.image;
        }
        if (music.contentId) musicInList.contentId = music.contentId;
      }
      return music;
    },
    async updateRemoteList() {
      if (!this.config.list) return;
      const data: any = {
        music: this.music,
        playlist: this.musicList.map(m => ({
          ...m,
          cookie: api.getCookie(m.type),
          url: '',
          lover: !!this.myLover[m.type + m.id]
        }))
      };
      data.music = data.playlist.find(
        (m: Music) => m.type == this.music.type && m.id == this.music.id
      );
      await musicOperate('/updatelist', JSON.stringify(data), {
        'content-type': 'application/json'
      });
    },
    async play(music?: Music, musicList?: Music[], playOnly = false, listKind?: ActiveListKind) {
      const replacingLibrary = listKind === 'library' && Array.isArray(musicList) && !playOnly;
      if (this.preparePlay && !replacingLibrary) {
        return;
      }
      const idleShouldTakeOver =
        this.danmakuIdlePlaylistEnabled &&
        !replacingLibrary &&
        listKind !== 'request' &&
        !playOnly &&
        !(musicList && musicList.length) &&
        this.musicList.length === 0;
      if (idleShouldTakeOver) {
        this.preparePlay = false;
        this.playStatus.loading = false;
        if (await this.startIdleIfNeeded()) return;
      }
      if (listKind) this.setActiveListKind(listKind);
      if (replacingLibrary) {
        this.replaceLibraryPlaylist(musicList);
        this.nextPlay = null;
        this.playStatus.progress = 0;
        this.playStatus.currentTime = '00:00';
        this.playStatus.stopped = true;
        try { await musicOperate('/progress', '0'); } catch {}
      }
      this.playStatus.loading = true;
      this.preparePlay = true;
      if (!music && musicList && musicList[0]) {
        music =
          musicList[
            this.sortType == SortType.Random
              ? getRandomInt(0, musicList.length)
              : 0
          ];
      }
      if (!music && this.playStatus.stopped && this.music.id) music = this.music;
      const sameSong = Boolean(
        music && this.music.id && music.id == this.music.id && music.type == this.music.type
      );
      if (
        !music ||
        (!replacingLibrary && !this.playStatus.stopped && sameSong)
      ) {
        const currentMusic = this.music;
        if (currentMusic.url) {
          const progress = this.playStatus.progress;
          const audio = getOrCreateLocalAudio()?.audio;
          const alreadyPlayingThis =
            audio &&
            !audio.paused &&
            audio.src &&
            currentMusic.url &&
            audio.src.includes(currentMusic.url);
          const available = alreadyPlayingThis || (await this.isMusicUrlAvailable(currentMusic.url));
          if (!available) {
            await this.refreshMusicUrl(currentMusic);
            if (!currentMusic.url) {
              console.log('fail', currentMusic);
              ElMessage(
                messageOption(`当前音乐[${this.music.name}]无法播放`)
              );
              this.preparePlay = false;
              return;
            }
            await this.updateRemoteList();
            this.checkingStatus = true;
            let playRes = await musicOperate('/play', currentMusic.url);
            if (!replacingLibrary && progress > 0 && progress < 1000) {
              playRes = await musicOperate('/progress', progress.toString());
            }
            this.checkingStatus = false;
            this.setStatus(playRes.data);
            this.setTitle();
            this.preparePlay = false;
            return;
          }
        }
        this.checkingStatus = true;
        const res = await musicOperate('/play');
        this.checkingStatus = false;
        this.setStatus(res.data);
        this.setTitle();
        this.preparePlay = false;
        return;
      }
      if (Array.isArray(musicList) && !playOnly && this.activeListKind !== 'library') {
        this.musicList.splice(0, this.musicList.length);
        this.add(musicList);
      }
      const lastMusic = { ...this.music };
      if (music) {
        if (this.activeListKind === 'library') {
          this.setCurrentMusic(markLibraryOrigin({ ...music }));
        } else {
          if (
            this.musicList.findIndex(
              m => m.id == music!.id && m.type == music!.type
            ) < 0
          ) {
            this.add([music]);
          }
          this.setCurrentMusic(music);
        }
      }
      if (this.config.list && this.config.remote) {
        this.checkingStatus = true;
        await this.updateRemoteList();
        const res = await musicOperate('/play');
        this.checkingStatus = false;
        this.setStatus(res.data);
        this.preparePlay = false;
        lyricManager.updateLyric(this.music);
        return;
      }
      await api.musicDetail(music);
      this.music.audition = music.audition;
      if (music.image) {
        this.music.image = music.image;
        this.music.mediumImage = music.mediumImage || music.image;
        this.music.largeImage = music.largeImage || music.image;
        this.music.coverUrl = music.coverUrl || music.image;
      }
      if (music.contentId) this.music.contentId = music.contentId;
      if (!music.url) {
        console.log('fail', music);
        ElMessage(messageOption(`当前音乐[${this.music.name}]无法播放`));
        this.preparePlay = false;
        const result = await danmakuPlayerFailure(
          music,
          music.remark || '暂无播放链接'
        ).catch(() => ({ paused: false, skipped: false, next: null }));
        if (isRequestQueueSong(music, this.activeListKind)) {
          const musicIndex = this.musicList.findIndex(
            n => music && music.id == n.id && music.type == n.type
          );
          if (musicIndex >= 0) {
            this.musicList.splice(musicIndex, 1);
            storage.setValue(StorageKey.CurrentMusicList, this.musicList);
            this.persistRequestQueue();
          }
        }
        if (result?.paused) {
          ElMessage(messageOption('连续多首歌无法播放，已暂停自动跳过。点下一首或等新点歌即可继续'));
          if (this.activeListKind === 'library') {
            await this.markRequestQueueIdle();
            return;
          }
          if (this.musicList.length > 0) {
            this.next(true);
            return;
          }
          if (await this.startIdleIfNeeded()) return;
          await this.markRequestQueueIdle();
          return;
        }
        this.musicList.length > 0 && this.next(true);
        return;
      }
      if (
        (music.id != lastMusic.id || music.type != lastMusic.type) &&
        this.playStatus.stopped &&
        this.playStatus.progress > 0
      ) {
        await musicOperate('/progress', '0');
      }
      this.checkingStatus = true;
      await this.updateRemoteList();
      const res = await musicOperate('/play', music.url);
      this.checkingStatus = false;
      this.setStatus(res.data);
      if (res?.data?.playing) this.playStatus.stopped = false;
      await danmakuPlayerCurrent(music, true).catch(error => console.warn('player current sync failed', error));
      this.addHistory([music]);
      danmakuHistoryAdd(music).catch(error => console.warn('history persist failed', error));
      this.setTitle();
      this.preparePlay = false;
      lyricManager.updateLyric(music);
    },
    syncDanmakuProgress(force = false) {
      const audio = getOrCreateLocalAudio()?.audio;
      const audioDuration = Number(audio?.duration);
      const audioPosition = Number(audio?.currentTime);
      const length = Number(this.music?.length || 0);
      const durationMs = Number.isFinite(audioDuration) && audioDuration > 0
        ? Math.round(audioDuration * 1000)
        : (length > 10000 ? Math.round(length) : Math.round(length * 1000));
      const positionMs = Number.isFinite(audioPosition) && audioPosition >= 0
        ? Math.round(audioPosition * 1000)
        : (durationMs ? Math.round(durationMs * (this.playStatus.progress || 0) / 1000) : 0);
      if (durationMs < 1000 && positionMs <= 0) return;
      const now = Date.now();
      if (!force && now - lastDanmakuProgressAt < 1000) return;
      lastDanmakuProgressAt = now;
      danmakuPlayerProgress(positionMs, durationMs).catch(() => {});
    },
    async markRequestQueueIdle() {
      this.playStatus.playing = false;
      this.playStatus.stopped = true;
      danmakuPlayerStatus(false).catch(error => console.warn('player idle sync failed', error));
    },
    async pause() {
      this.checkingStatus = true;
      var res = await musicOperate('/pause');
      this.checkingStatus = false;
      this.setStatus(res.data);
      this.syncDanmakuProgress(true);
      danmakuPlayerStatus(false).catch(error => console.warn('player pause sync failed', error));
    },
    async remove(item: Music) {
      const index = this.musicList.findIndex(
        m => m.type == item!.type && m.id == item!.id
      );
      if (index >= 0) {
        this.musicList.splice(index, 1);
        storage.setValue(StorageKey.CurrentMusicList, this.musicList);
        if (this.activeListKind === 'library') {
          const idleIndex = this.idleTracks.findIndex(
            m => m.type == item!.type && m.id == item!.id
          );
          if (idleIndex >= 0) this.idleTracks.splice(idleIndex, 1);
        } else if (this.activeListKind === 'request') {
          try {
            await danmakuQueueSnapshot(this.musicList.filter(item => isRequestQueueSong(item, 'request')));
          } catch (error) {
            console.warn('queue delete persist failed', error);
            ElMessage(messageOption('删除未能同步到服务端，歌曲可能会再次出现'));
          }
        }
      }
      if (item.type == this.music.type && item.id == this.music.id) {
        this.next();
      }
    },
    async next(auto?: boolean) {
      if (typeof auto !== 'boolean') auto = false;
      if (this.activeListKind === 'library') {
        await this.nextIdle(auto);
        return;
      }
      if (this.nextPlay) {
        const pending = this.nextPlay;
        this.nextPlay = null;
        const consumed = auto ? this.removeFinishedRequestSong() : -1;
        await this.play(pending);
        if (consumed >= 0) await this.persistRequestQueue();
        return;
      }
      if (auto && this.sortType === SortType.Single) {
        const stillInList = this.musicList.some(
          item => item.id == this.music.id && item.type == this.music.type
        );
        if (stillInList) {
          await this.replayCurrent();
          return;
        }
      }
      let currentIndex = this.musicList.findIndex(
        m => m.id == this.music.id && m.type == this.music.type
      );
      let consumed = -1;
      if (auto) {
        consumed = this.removeFinishedRequestSong();
        if (consumed >= 0) {
          currentIndex = consumed;
        } else if (this.sortType === SortType.Random) {
          currentIndex = getRandomInt(0, this.musicList.length);
        } else {
          currentIndex++;
        }
      } else {
        switch (this.sortType) {
          case SortType.Loop:
          case SortType.Single:
            currentIndex++;
            break;
          case SortType.Order:
            if (currentIndex == this.musicList.length - 1) return;
            currentIndex++;
            break;
          case SortType.Random:
            currentIndex = getRandomInt(0, this.musicList.length);
            break;
        }
      }
      if (this.musicList.length === 0) {
        if (consumed >= 0) await this.persistRequestQueue();
        if (await this.startIdleIfNeeded()) return;
        await this.markRequestQueueIdle();
        return;
      }
      if (this.sortType === SortType.Order && currentIndex >= this.musicList.length) {
        if (consumed >= 0) await this.persistRequestQueue();
        if (await this.startIdleIfNeeded()) return;
        await this.markRequestQueueIdle();
        return;
      }
      if (currentIndex < 0 || currentIndex >= this.musicList.length) currentIndex = 0;
      await this.play(this.musicList[currentIndex]);
      if (consumed >= 0) await this.persistRequestQueue();
    },
    async nextIdle(auto?: boolean) {
      const list = this.idleTracks;
      if (!list.length) {
        this.setActiveListKind('request');
        await this.markRequestQueueIdle();
        return;
      }
      if (auto && this.sortType === SortType.Single) {
        await this.replayCurrent();
        return;
      }
      let currentIndex = list.findIndex(
        m => m.id == this.music.id && m.type == this.music.type
      );
      if (auto) {
        currentIndex = this.sortType === SortType.Random
          ? getRandomInt(0, list.length)
          : currentIndex + 1;
      } else {
        switch (this.sortType) {
          case SortType.Loop:
          case SortType.Single:
            currentIndex++;
            break;
          case SortType.Order:
            if (currentIndex == list.length - 1) return;
            currentIndex++;
            break;
          case SortType.Random:
            currentIndex = getRandomInt(0, list.length);
            break;
        }
      }
      if (this.sortType === SortType.Order && currentIndex >= list.length) {
        this.setActiveListKind('request');
        await this.markRequestQueueIdle();
        return;
      }
      if (currentIndex < 0 || currentIndex >= list.length) currentIndex = 0;
      await this.play(list[currentIndex], undefined, true, 'library');
    },
    async last() {
      this.nextPlay = null;
      const musicH = this.musicHistory[this.musicHistory.length - 2];
      this.addHistory(
        this.musicHistory.slice(this.musicHistory.length - 2),
        true
      );
      // this.musicHistory.splice(this.musicHistory.length - 1, 1);
      // const musicH = this.musicHistory.splice(
      //   this.musicHistory.length - 1,
      //   1
      // )[0];
      var ok = false;
      if (musicH) {
        const music = this.musicList.find(
          m => m.id == musicH.id && m.type == musicH.type
        );
        if (music) {
          this.play(music);
          ok = true;
        }
      }
      if (!ok) {
        let currentIndex = this.musicList.findIndex(
          m => m.id == this.music.id && m.type == this.music.type
        );
        if (currentIndex == 0) currentIndex = this.musicList.length - 1;
        else if (--currentIndex < 0) currentIndex = 0;
        this.play(this.musicList[currentIndex]);
      }
    },
    async changeProgress(value: number) {
      this.checkingStatus = true;
      this.playStatus.disableUpdateProgress = false;
      var res = await musicOperate('/progress', value.toString());
      this.checkingStatus = false;
      this.setStatus(res.data);
    },
    async changeVolume(value: number, saved = true) {
      if (value == null || isNaN(value) || value < 0 || value > 100) return;
      clearTimeout(this.volumeDisableTimeout);
      this.checkingStatus = true;
      var res = await musicOperate('/volume', value.toString());
      this.checkingStatus = false;
      this.setStatus(res.data);
      saved && storage.setValue(StorageKey.Volume, this.playStatus.volume);
      this.volumeDisableTimeout = setTimeout(() => {
        this.playStatus.disableUpdateVolume = false;
      }, 300);
    },
    async mute() {
      if (this.playStatus.volume === 0) {
        await this.changeVolume(this.playStatus.volumeCache || 100);
      } else {
        this.playStatus.volumeCache = this.playStatus.volume || 100;
        storage.setValue(StorageKey.VolumeCache, this.playStatus.volumeCache);
        await this.changeVolume(0);
      }
      storage.setValue(StorageKey.Volume, this.playStatus.volume);
    },
    async setCurrentMusicById(id: string, type: MusicType) {
      let music: Music | null | undefined = this.musicList.find(
        item => item.id == id && item.type == type
      );
      let noSave = false;
      if (!music) {
        music = await api.musicById(type, id);
        noSave = true;
      }
      if (music) {
        this.setCurrentMusic(music, noSave);
        lyricManager.updateLyric(this.music);
        this.setTitle();
        return;
      }
    },
    async setStatus(data: PlayStatus) {
      if (this.checkingStatus || !data) return;
      try {
        if (this.playStatus.playing != data.playing) {
          this.playStatus.playing = data.playing;
          this.playStatus.loading = false;
        }
        if (this.playStatus.stopped != data.stopped) {
          this.playStatus.stopped = data.stopped;
          this.playStatus.loading = false;
        }
        if (this.playStatus.loading && data.playing) {
          this.playStatus.loading = false;
        }
        if (
          !this.preparePlay &&
          data.id &&
          data.type &&
          (data.id != this.music?.id || data.type != this.music?.type)
        ) {
          this.music.id = data.id;
          this.music.type = data.type;
          this.setCurrentMusicById(data.id, data.type);
        }
        if (
          this.playStatus.currentTime != data.currentTime &&
          data.currentTime
        ) {
          this.playStatus.currentTime = data.currentTime || '00:00';
        }
        if (data.totalTime && this.playStatus.totalTime != data.totalTime) {
          if (this.music.audition && this.music.duration) {
            data.totalTime = this.music.duration;
          }
          this.playStatus.totalTime = data.totalTime;
          if (!this.music.duration) {
            this.music.duration = data.totalTime;
          }
          const audioMs = Math.round(Number(getOrCreateLocalAudio()?.audio?.duration) * 1000);
          const actualMs = audioMs > 1000 ? audioMs : duration2Millisecond(data.totalTime);
          if (actualMs > 1000) {
            const catalogMs = musicLengthMs(this.music);
            if (!this.music.length || Math.abs(actualMs - catalogMs) > 400) {
              this.music.length = actualMs;
              this.music.durationSec = actualMs / 1000;
              lyricManager.updateLyric(this.music);
            }
          }
        }
        if (
          !this.playStatus.disableUpdateVolume &&
          this.playStatus.volume != data.volume
        ) {
          this.playStatus.volume = data.volume;
          storage.setValue(StorageKey.Volume, data.volume);
          if (this.playStatus.volumeCache != data.volume && data.volume > 0) {
            this.playStatus.volumeCache = data.volume;
            storage.setValue(StorageKey.VolumeCache, data.volume);
          }
        }
        if (
          !this.playStatus.disableUpdateProgress &&
          this.playStatus.progress != data.progress
        ) {
          if (this.music.audition && this.music.length) {
            data.progress = (60000 * data.progress) / this.music.length;
          } else {
            localStorage.setItem(StorageKey.Progress, data.progress as any);
          }
          this.playStatus.progress = data.progress || 0;
          if (
            data.progress &&
            !data.currentTime &&
            this.music.length &&
            this.playStatus.currentTime == '00:00'
          ) {
            this.playStatus.currentTime = millisecond2Duration(
              (this.music.length * data.progress) / 1000
            );
          }
          if (this.playStatus.playing) this.syncDanmakuProgress();
        }
        const audioNow = Number(getOrCreateLocalAudio()?.audio?.currentTime);
        const positionMs = Number.isFinite(audioNow) && audioNow >= 0
          ? Math.round(audioNow * 1000)
          : undefined;
        lyricManager.updateLyricLine(this.playStatus.progress, positionMs);
      } catch {}
    },
    setTitle() {
      // 点歌姬新路由的页面标题不应被 Musiche 旧播放标题副作用覆盖。
      if (location.pathname.startsWith('/player')) {
        title.value = this.music?.name
          ? `${this.music.name}${this.music.singer ? ' - ' : ''}${this.music.singer || ''}`
          : '播放 · 弹幕点歌姬';
        return;
      }
      if (location.pathname.startsWith('/history')) {
        title.value = '播放历史 · 弹幕点歌姬';
        return;
      }
      if (location.pathname.startsWith('/setting')) {
        title.value = '设置 · 弹幕点歌姬';
        return;
      }
      if (location.pathname.startsWith('/search/')) {
        title.value = '搜索 · 弹幕点歌姬';
        return;
      }
      if (this.music && this.music.name) {
        title.value = `${this.music.name}${(this.music.singer && ' - ') || ''}${
          this.music.singer || ''
        }`;
      } else {
        title.value = '音乐和';
      }
      if (this.config.list) return;
      musicOperate('/title', title.value);
      musicOperate(
        '/media',
        JSON.stringify({
          album: this.music.album || undefined,
          artist: this.music.singer || undefined,
          artwork: this.music.image
            ? [
                {
                  src:
                    this.music.largeImage ||
                    this.music.mediumImage ||
                    this.music.image
                }
              ]
            : [],
          title: this.music.name || title.value,
          lover: this.myLover[this.music.type + this.music.id] || false
        } as MediaMetadataInit)
      );
    },
    changePlayerMode(mode: PlayDetailMode) {
      this.playerMode = mode;
      storage.setValue(StorageKey.PlayerMode, mode);
    },
    setRemoteConfig(config: Config) {
      for (const key in config) {
        if (config.hasOwnProperty(key)) {
          (this.config as any)[key] = (config as any)[key];
        }
      }
    },
    async initValue(remoteConfig: Config, storages: Record<string, any>) {
      this.setRemoteConfig(remoteConfig);
      let restoredRemote = false;
      try {
        const remote = await danmakuState();
        const queue = Array.isArray(remote.queue) ? remote.queue : [];
        if (queue.length) {
          this.add(queue, true, false, false);
          if (remote.current?.id && remote.current.origin !== 'library') {
            this.setCurrentMusic(remote.current, true);
          }
          this.setActiveListKind('request');
        } else {
          this.setCurrentMusic(undefined, true);
          this.setActiveListKind('request');
        }
        if (remote.history?.length) this.addHistory(remote.history, false, true);
        if (typeof remote.accepting === 'boolean') this.danmakuAccepting = remote.accepting;
        this.applyDanmakuGiftConfig(remote);
        if (typeof remote.songBlacklistEnabled === 'boolean') this.danmakuSongBlacklist = remote.songBlacklistEnabled;
        if (Array.isArray(remote.songBlacklist)) this.danmakuSongBlacklistItems = remote.songBlacklist.map(String);
        restoredRemote = true;
      } catch (error) {
        console.warn('danmaku state restore failed, using local storage', error);
      }
      if (!restoredRemote) {
        this.addHistory(storages[StorageKey.CurrentMusicHistory], false, true);
      }
      this.addMyLove(storages[StorageKey.MyLoves]);
      this.addMyFavorite(storages[StorageKey.MyFavorites]);
      this.addMyPlaylists(storages[StorageKey.MyPlaylists]);
      this.sortType = storages[StorageKey.SortType] || SortType.Loop;
      this.playerMode = storages[StorageKey.PlayerMode] || 'default';
      this.playStatus.volumeCache = storages[StorageKey.VolumeCache] || 0;
      this.changeVolume(storages[StorageKey.Volume] || 0, false);
      musicOperate('/loop', this.sortType.toString());
      try {
        const cfg = await danmakuConfig();
        if (typeof cfg.accepting === 'boolean') this.danmakuAccepting = cfg.accepting;
        if (typeof cfg.biliRoom === 'string') this.danmakuBiliRoom = cfg.biliRoom;
        this.applyDanmakuGiftConfig(cfg);
        if (typeof cfg.songBlacklistEnabled === 'boolean') this.danmakuSongBlacklist = cfg.songBlacklistEnabled;
        if (Array.isArray(cfg.songBlacklist)) this.danmakuSongBlacklistItems = cfg.songBlacklist.map(String);
        const player = getOrCreateLocalAudio();
        await player.setOutputDevice(String(cfg.audioOutputId || ''));
        await player.setLiveDevice(String(cfg.virtualOutputId || ''));
      } catch (error) {
        console.warn('audio output restore failed', error);
      }
      danmakuLogs().then(data => this.replaceDanmakuLogs(data.items || [])).catch(error => console.warn('danmaku logs restore failed', error));
      this.setTitle();
      (window as any).isPlayDetailShow = () => this.playDetailShow;
      (window as any).hidePlayDetail = () => {
        if (this.playDetailShow) {
          this.playDetailShow = false;
          return true;
        }
      };
    },
  }
});
