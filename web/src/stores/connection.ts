import * as http from '../utils/http';
import { getLocalAudioElement } from '../utils/http';
import { StorageKey, storage } from '../utils/storage';
import { Config, ShortcutKey, ShortcutType } from '../utils/type';
import { usePlayStore } from './play';
import { useSettingStore } from './setting';
import { LyricManager } from '../utils/lyric';
import { DanmakuSse, type DanmakuSnapshot } from '../utils/danmaku-sse';
import * as local from '../utils/api/local';
import { ElMessage } from 'element-plus/es/components/message/index';
import { messageOption } from '../utils/utils';

export class MusicConnection {
  webSocketClient?: http.CommunicationClient;
  danmakuSse?: DanmakuSse;
  play = usePlayStore();
  setting = useSettingStore();
  public config: Config = {
    remote: false,
    storage: false,
    file: false,
    list: false,
    lyric: false,
    client: false,
    shortcut: false,
    gpu: false
  };

  constructor() {
    this.init();
    this.registerShortcut();
  }

  async init() {
    try {
      const res = await fetch(`//${http.httpAddress}/config`);
      const remoteConfig: Config = await res.json();
      this.config.remote = Boolean(remoteConfig.remote);
      this.config.storage = Boolean(remoteConfig.storage);
      this.config.file = Boolean(remoteConfig.file);
      this.config.list = Boolean(remoteConfig.list);
      this.config.client = Boolean(remoteConfig.client);
      this.config.shortcut = Boolean(remoteConfig.shortcut);
      this.config.gpu = Boolean(remoteConfig.gpu);
      this.config.lyric = Boolean(remoteConfig.lyric);
      this.config.platform = remoteConfig.platform || '';
    } catch {}

    this.config.remote && http.setRemoteMode(true);
    this.config.storage && storage.setRemoteMode(true);
    this.config.lyric && LyricManager.setRemoteMode(true);
    this.config.file && local.setRemoteMode(true);
    const cssReady = import('../style/main.css');
    const storages = await storage.getAll();
    storages[StorageKey.ProxyAddress] &&
      http.setProxyAddress(storages[StorageKey.ProxyAddress]);
    await Promise.all([
      this.play.initValue(this.config, storages),
      this.setting.initValue(this.config, storages),
      cssReady
    ]);
    document.documentElement.style.opacity = '1';
    console.log('musiche loaded');
    this.danmakuSse = new DanmakuSse(
      this.applyDanmakuSnapshot.bind(this),
      this.applyDanmakuPlayer.bind(this),
      () => console.warn('danmaku SSE disconnected'),
      conn => {
        if (conn) this.play.danmakuConnection = conn;
      },
      log => this.play.pushDanmakuLog(log)
    );
    this.danmakuSse.connect();
    this.webSocketClient = http.wsClient(
      this.wsMessage.bind(this),
      this.wsClose.bind(this)
    );
    if (this.setting.pageValue.savePlayProgress && this.play.music.id) {
      try {
        const progress = parseInt(
          localStorage.getItem(StorageKey.Progress) || '0'
        );
        if (progress > 0 && progress < 1000) {
          this.play.changeProgress(progress);
        }
      } catch {}
    }
    if (this.setting.pageValue.playAtRun) {
      this.play.play();
    }
  }

  registerShortcut() {
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
  }

  isTypingTarget(target: EventTarget | null) {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return Boolean(el.closest('input, textarea, select, [contenteditable="true"]'));
  }

  songDurationSec() {
    const length = Number(this.play.music.length);
    if (Number.isFinite(length) && length > 0) return length;
    const parts = String(this.play.music.duration || '')
      .split(':')
      .map(part => Number(part));
    if (parts.length === 2 && parts.every(Number.isFinite)) return parts[0] * 60 + parts[1];
    if (parts.length === 3 && parts.every(Number.isFinite)) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  }

  seekBySeconds(seconds: number) {
    const duration = this.songDurationSec();
    if (!duration) return;
    const next = Math.max(0, Math.min(1000, (this.play.playStatus.progress || 0) + (seconds / duration) * 1000));
    this.play.changeProgress(next);
  }

  togglePlay() {
    if (this.play.playStatus.playing) this.play.pause();
    else this.play.play();
  }

  onKeyDown(event: KeyboardEvent) {
    if (event.repeat) return;
    if (this.isTypingTarget(event.target)) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const focused = event.target as HTMLElement | null;
    if (event.code === 'Space' && focused?.closest('button, [role="button"], a')) return;
    switch (event.code) {
      case 'Space':
        event.preventDefault();
        this.togglePlay();
        return;
      case 'ArrowLeft':
        event.preventDefault();
        if (event.shiftKey) this.play.last();
        else this.seekBySeconds(-5);
        return;
      case 'ArrowRight':
        event.preventDefault();
        if (event.shiftKey) this.play.next();
        else this.seekBySeconds(5);
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.play.changeVolume(this.play.playStatus.volume + 5);
        return;
      case 'ArrowDown':
        event.preventDefault();
        this.play.changeVolume(this.play.playStatus.volume - 5);
        return;
      case 'KeyM':
        event.preventDefault();
        this.play.mute();
        return;
    }
  }

  onKeyUp(event: KeyboardEvent) {
    if (this.isTypingTarget(event.target)) return;
    if (
      !this.config.shortcut &&
      this.setting.pageValue.systemMediaShortcutUsed
    ) {
      switch (event.key) {
        case 'MediaPlayPause':
          if (this.play.playStatus.playing) this.play.pause();
          else this.play.play();
          return;
        case 'MediaTrackPrevious':
          this.play.last();
          return;
        case 'MediaTrackNext':
          this.play.next();
          return;
        case 'MediaStop':
          this.play.pause();
          return;
        // case 'AudioVolumeMute':
        // case 'AudioVolumeUp':
        // case 'AudioVolumeDown':
      }
    }
    const shortcutTypes = Object.keys(this.setting.pageValue.shortcut);
    for (let i = 0; i < shortcutTypes.length; i++) {
      const shortcut = (this.setting.pageValue.shortcut as any)[
        shortcutTypes[i]
      ] as ShortcutKey;
      if (shortcut.ctrlKey && !event.ctrlKey) continue;
      if (shortcut.shiftKey && !event.shiftKey) continue;
      if (shortcut.altKey && !event.altKey) continue;
      if (shortcut.metaKey && !event.metaKey) continue;
      if (shortcut.key !== event.code) continue;
      switch (shortcutTypes[i] as ShortcutType) {
        case 'play':
          if (this.play.playStatus.playing) this.play.pause();
          else this.play.play();
          break;
        case 'last':
          this.play.last();
          break;
        case 'next':
          this.play.next();
          break;
        case 'plus':
          this.play.changeVolume(this.play.playStatus.volume + 10);
          break;
        case 'minus':
          this.play.changeVolume(this.play.playStatus.volume - 10);
          break;
        case 'love':
          this.play.addMyLove([this.play.music]);
          break;
        case 'lover':
          if (this.play.music.id && this.play.music.type) {
            let exist =
              this.play.myLover[this.play.music.type + this.play.music.id];
            this.play.addMyLove([this.play.music], exist);
          }
          break;
      }
    }
  }

  sendWsMessage(message: string) {
    if (!this.webSocketClient) return;
    this.webSocketClient.readyState == WebSocket.OPEN &&
      this.webSocketClient.send(message);
  }

  sendWsStatus() {
    if (this.play.checkingStatus) return;
    this.sendWsMessage('/status\n');
  }

  localAudioPlaying() {
    const audio = getLocalAudioElement();
    return Boolean(audio && audio.src && !audio.paused);
  }

  applyDanmakuSnapshot(snapshot: DanmakuSnapshot) {
    if (!snapshot) return;
    const songKey = (item?: { type?: string; id?: string } | null) =>
      item?.id ? `${item.type}:${item.id}` : '';
    const localKey = songKey(this.play.music);
    const queue = Array.isArray(snapshot.queue)
      ? snapshot.queue.filter(item => item?.origin !== 'library')
      : null;
    this.play.applyDanmakuGiftConfig(snapshot);
    if (queue) this.play.rememberRequestQueue(queue);
    if (queue?.length && this.play.activeListKind === 'library' && !this.play.preparePlay) {
      this.play.interruptIdleForRequests(queue);
    } else if (queue && !this.play.preparePlay && this.play.activeListKind === 'request') {
      const localStillQueued = Boolean(localKey && queue.some(item => songKey(item) === localKey));
      this.play.musicList.splice(0, this.play.musicList.length, ...queue);
      const idle =
        !this.localAudioPlaying() &&
        (!this.play.playStatus.playing || this.play.playStatus.stopped);
      if (idle && !localStillQueued && queue[0] && !this.play.preparePlay) {
        this.play.play(queue[0]);
      }
    }
    if (Array.isArray(snapshot.history) && this.play.musicHistory.length === 0) {
      this.play.addHistory(snapshot.history, false, true);
    }
    if (snapshot.connection) this.play.danmakuConnection = snapshot.connection;
    if (typeof snapshot.biliRoom === 'string') this.play.danmakuBiliRoom = snapshot.biliRoom;
    if (snapshot.mode) this.play.sortType = snapshot.mode as any;
    if (typeof snapshot.accepting === 'boolean') this.play.danmakuAccepting = snapshot.accepting;
    if (typeof snapshot.songBlacklistEnabled === 'boolean') this.play.danmakuSongBlacklist = snapshot.songBlacklistEnabled;
    if (Array.isArray(snapshot.songBlacklist)) this.play.danmakuSongBlacklistItems = snapshot.songBlacklist.map(String);
  }

  applyDanmakuPlayer(data: any) {
    if (!data) return;
    const queue = Array.isArray(data.queue)
      ? data.queue.filter((item: { origin?: string }) => item?.origin !== 'library')
      : null;
    if (queue) this.play.rememberRequestQueue(queue);
    if (queue?.length && !this.play.preparePlay && this.play.activeListKind === 'library') {
      this.play.interruptIdleForRequests(queue);
    }
  }

  wsMessage(result: any) {
    if (!result) return;
    try {
      switch (result.type) {
        case 'status':
          this.play.setStatus(result.data);
          break;
        case 'maximized':
          this.setting.setMaximized(result.data);
          break;
        case 'playOrPause':
          if (this.play.playStatus.playing) this.play.pause();
          else this.play.play();
          break;
        case 'play':
          this.play.play();
          break;
        case 'pause':
          this.play.pause();
          break;
        case 'remove':
          const musicIndex = this.play.musicList.findIndex(
            m => m.id == result.data.id && m.type == result.data.type
          );
          if (musicIndex >= 0) {
            ElMessage(
              messageOption(
                `当前音乐[${this.play.musicList[musicIndex].name}]无法播放`
              )
            );
            this.play.musicList.splice(musicIndex, 1);
          }
          break;
        case 'next':
          this.play.next(result.data);
          break;
        case 'last':
          this.play.last();
          break;
        case 'loop':
          this.play.setSortType(result.data);
          break;
        case 'lyric':
          this.play.showDesktopLyric(Boolean(result.data));
          break;
        case 'show':
          if (this.play.music.id && this.play.musicList.length > 0)
            this.play.playDetailShow = true;
          break;
        case 'lover':
          if (
            (this.play.music.type && this.play.music.id) ||
            (result.data.type && result.data.id)
          ) {
            const type = result.data.type || this.play.music.type;
            const id = result.data.id || this.play.music.id;
            let exist = this.play.myLover[type + id];
            const music = this.play.musicList.find(
              m => m.id == id && m.type == type
            );
            this.play.addMyLove([music || this.play.music], exist);
          }
          break;
      }
    } catch {}
  }
  wsClose() {
    setTimeout(() => {
      this.webSocketClient = http.wsClient(
        this.wsMessage.bind(this),
        this.wsClose.bind(this)
      );
    }, 1000);
  }
}
