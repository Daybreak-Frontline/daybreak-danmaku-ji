import { second2Duration } from './utils';

function sliderToGain(slider: number) {
  const n = Math.max(0, Math.min(100, slider)) / 100;
  return n * n;
}

export class AudioPlayer {
  audio: HTMLAudioElement;
  liveAudio: HTMLAudioElement | null = null;
  outputId = '';
  liveId = '';
  onMessage?: (data: any) => void;
  progressTemp?: number;
  fadeIn: boolean = false;
  fadeInVolume?: number;
  lastProgress?: number;
  proxyAddress: string = '';
  sliderVolume = 100;
  private mediaActionsReady = false;
  constructor() {
    this.audio = new Audio();
    this.audio.addEventListener('play', this.audioPlay.bind(this));
    this.audio.addEventListener(
      'pause',
      this.statusChange.bind(this, undefined)
    );
    this.audio.addEventListener('ended', this.audioEnded.bind(this));
    this.audio.addEventListener(
      'volumechange',
      this.statusChange.bind(this, undefined)
    );
    this.audio.addEventListener('timeupdate', this.timeUpdate.bind(this));
  }
  setProxyAddress(proxyAddress: string) {
    this.proxyAddress = proxyAddress;
  }
  initMediaAction() {
    if (!('mediaSession' in navigator) || this.mediaActionsReady) return;
    this.mediaActionsReady = true;
    navigator.mediaSession.setActionHandler('seekbackward', null);
    navigator.mediaSession.setActionHandler('seekforward', null);
    navigator.mediaSession.setActionHandler(
      'play',
      this.sendMessage.bind(this, 'playOrPause')
    );
    navigator.mediaSession.setActionHandler(
      'pause',
      this.sendMessage.bind(this, 'playOrPause')
    );
    navigator.mediaSession.setActionHandler(
      'stop',
      this.sendMessage.bind(this, 'pause')
    );
    navigator.mediaSession.setActionHandler(
      'previoustrack',
      this.sendMessage.bind(this, 'last', true)
    );
    navigator.mediaSession.setActionHandler(
      'nexttrack',
      this.sendMessage.bind(this, 'next', true)
    );
  }
  setFadeIn(fadeIn: boolean) {
    this.fadeIn = fadeIn;
  }

  mediaMeta(meta: MediaMetadataInit) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      ...meta,
      title: meta.title || document.title
    });
  }

  async applySink(el: HTMLAudioElement, id: string) {
    if (typeof el.setSinkId !== 'function') {
      return { ok: false, error: '当前环境不支持指定输出设备，已使用系统默认' };
    }
    const sink = !id || id === 'default' || id === '__default__' ? '' : id;
    try {
      await el.setSinkId(sink);
      return { ok: true, error: '' };
    } catch (error) {
      try { await el.setSinkId(''); } catch {}
      return {
        ok: false,
        error: error instanceof Error ? `${error.message}，已回退系统默认输出` : 'setSinkId 失败，已回退系统默认输出'
      };
    }
  }

  destroyLive() {
    if (!this.liveAudio) return;
    this.liveAudio.pause();
    this.liveAudio.removeAttribute('src');
    this.liveAudio = null;
  }

  syncLive() {
    if (!this.liveAudio) return;
    if (this.audio.src && this.liveAudio.src !== this.audio.src) this.liveAudio.src = this.audio.src;
    try { this.liveAudio.currentTime = this.audio.currentTime; } catch {}
    this.liveAudio.volume = this.audio.volume;
  }

  async setOutputDevice(id: string) {
    this.outputId = id || '';
    const result = await this.applySink(this.audio, this.outputId);
    if (this.liveId && this.liveId === this.outputId) this.destroyLive();
    return result;
  }

  async setLiveDevice(id: string) {
    this.liveId = id || '';
    if (!this.liveId || this.liveId === this.outputId) {
      this.destroyLive();
      return { ok: true, error: '' };
    }
    if (!this.liveAudio) {
      this.liveAudio = new Audio();
      this.liveAudio.preload = 'auto';
    }
    const result = await this.applySink(this.liveAudio, this.liveId);
    this.syncLive();
    if (!this.audio.paused && this.audio.src) this.liveAudio.play().catch(() => {});
    return result;
  }

  async process(type: string, data?: string) {
    switch (type) {
      case 'play':
        return this.play(data);
      case 'fadein':
        return this.setFadeIn(Boolean(data));
      case 'pause':
        return this.pause();
      case 'progress':
        return this.progress(parseInt(data || '0'));
      case 'volume':
        return this.volume(parseInt(data || '0'));
      case 'status':
        return this.status();
      case 'media':
        return this.mediaMeta(JSON.parse(data || '{}'));
    }
    return {};
  }

  async play(url?: string) {
    if (url && this.audio.src != url) {
      if (this.proxyAddress) {
        const audioUrl = this.proxyAddress + '?url=' + encodeURIComponent(url);
        this.audio.src = audioUrl;
      } else {
        this.audio.src = url;
      }
    }
    if (!this.audio.src) {
      return this.status();
    }
    try {
      if (this.fadeIn) {
        this.fadeInVolume = sliderToGain(this.sliderVolume);
        this.applyElementVolume(0);
      } else {
        this.fadeInVolume = undefined;
        this.applyElementVolume(sliderToGain(this.sliderVolume));
      }
      await this.audio.play();
      this.syncLive();
      if (this.liveAudio) this.liveAudio.play().catch(() => {});
    } catch {}

    if (this.progressTemp && !isNaN(this.audio.duration)) {
      this.audio.currentTime =
        (this.audio.duration * this.progressTemp) / 1000;
      this.progressTemp = 0;
    }
    return this.status();
  }
  pause() {
    this.audio.pause();
    this.liveAudio?.pause();
    return this.status();
  }
  progress(progress: number) {
    if (isNaN(this.audio.duration)) {
      this.progressTemp = progress;
      return this.status();
    }
    this.audio.currentTime = isNaN(this.audio.duration)
      ? 0
      : (this.audio.duration * progress) / 1000;
    try { if (this.liveAudio) this.liveAudio.currentTime = this.audio.currentTime; } catch {}
    return this.status();
  }
  applyElementVolume(gain: number) {
    const value = Math.max(0, Math.min(1, gain));
    this.audio.volume = value;
    if (this.liveAudio) this.liveAudio.volume = value;
  }
  volume(volume: number) {
    const slider = Math.max(0, Math.min(100, Number.isFinite(volume) ? volume : 0));
    this.sliderVolume = slider;
    this.applyElementVolume(sliderToGain(slider));
    return this.status();
  }
  status(progress?: number) {
    if (typeof progress !== 'number') progress = undefined;
    this.lastProgress =
      this.progressTemp ||
      progress ||
      Math.round(
        (1000 * (this.audio.currentTime || 0)) / (this.audio.duration || 1)
      );
    return {
      data: {
        volume: Math.round(this.sliderVolume),
        currentTime: second2Duration(this.audio.currentTime),
        totalTime: second2Duration(this.audio.duration),
        playing: !this.audio.paused,
        stopped: this.audio.ended || !this.audio.src,
        progress: this.lastProgress
      },
      type: 'status'
    };
  }
  setOnMessage(onMessage: (status: any) => void) {
    this.onMessage = onMessage;
  }
  statusChange(progress?: number) {
    this.onMessage && this.onMessage(this.status(progress));
  }
  timeUpdate() {
    if (
      this.fadeInVolume &&
      this.fadeInVolume > this.audio.volume &&
      this.fadeInVolume <= 1
    ) {
      this.applyElementVolume(Math.min(this.audio.volume + 0.1, this.fadeInVolume));
    } else if (this.fadeInVolume != null) {
      this.fadeInVolume = undefined;
    }
    const progress = Math.round(
      (1000 * (this.audio.currentTime || 0)) / (this.audio.duration || 1)
    );
    this.lastProgress = progress;
    this.statusChange(progress);
  }
  sendMessage(type: string, body?: any) {
    this.onMessage &&
      this.onMessage({
        type: type,
        data: body ?? true
      });
  }
  audioEnded() {
    if (this.audio.src?.startsWith('blob')) {
      URL.revokeObjectURL(this.audio.src);
    }
    this.sendMessage('next', true);
  }
  audioPlay() {
    this.initMediaAction();
    this.statusChange();
  }
}
