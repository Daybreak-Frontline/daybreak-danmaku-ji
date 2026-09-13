import { ElMessage } from 'element-plus/es/components/message/index';
import { ElMessageBox } from 'element-plus/es/components/message-box/index';
import { LyricLine, LyricOptionsKey, Music } from './type';
import * as api from './api/api';
import {
  clearArray,
  messageOption,
  parseLyric,
  parseSubtitleCues,
  musicLengthMs,
  isWindows,
  isSafari
} from './utils';
import { musicOperate } from './http';

export const DESKTOP_LYRIC_CHANNEL = 'danmaku-desktop-lyric';

export type DesktopLyricMessage = {
  type: 'request' | 'state' | 'line' | 'options' | 'hide' | 'closed';
  text?: string;
  index?: number;
  options?: Record<LyricOptionsKey, any>;
};

export function subscribeDesktopLyric(
  handler: (message: DesktopLyricMessage) => void
) {
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(DESKTOP_LYRIC_CHANNEL);
    channel.onmessage = event => handler((event.data || {}) as DesktopLyricMessage);
    channel.postMessage({ type: 'request' });
  } catch {}
  return () => {
    try {
      channel?.close();
    } catch {}
  };
}

function isElectronShell() {
  return /Electron/i.test(navigator.userAgent);
}

export type LyricChange = (lines: string[]) => void;
export type LyricLineChange = (
  index: number,
  text: string,
  duration?: number
) => void;

const devicePixelRatio = (window.devicePixelRatio || 1) * 2;
let defaultFont = '';
export class LyricManager {
  private static lyricOption = {} as Record<LyricOptionsKey, any>;
  private static lyricDesktopShow = false;
  private static lyricText = '';
  private index: number = -1;
  private title: string = '';
  private progress: number = 0;
  private id: string = '';
  private length: number = 0;
  private parsed: boolean = false;
  private parsing: boolean = false;
  private music: Music | null = null;
  private lyricList: LyricLine[] = [];
  private lyricChanges: LyricChange[] = [];
  private lyricLineChanges: LyricLineChange[] = [];
  private static canvasContext: CanvasRenderingContext2D | null = null;
  private static canvas: HTMLCanvasElement | null = null;
  private static video: HTMLVideoElement | null = null;
  private static remoteMode: boolean = false;
  private static channel: BroadcastChannel | null = null;
  private static closeCallback: (() => void) | null = null;

  constructor() {}

  public static setRemoteMode(remote: boolean) {
    this.remoteMode = remote;
  }

  public static setLyricOptions(options: Record<LyricOptionsKey, any>) {
    this.lyricOption = options;
    this.postDesktopLyric({ type: 'options', options });
    if (this.remoteMode) {
      musicOperate(
        '/lyric',
        JSON.stringify({ ...options, show: LyricManager.lyricDesktopShow })
      );
      return;
    }
    this.lyricText && this.drawCanvas(0, this.lyricText);
  }

  private static ensureChannel() {
    if (this.channel) return this.channel;
    try {
      this.channel = new BroadcastChannel(DESKTOP_LYRIC_CHANNEL);
      this.channel.onmessage = event => {
        const data = (event.data || {}) as DesktopLyricMessage;
        if (data.type === 'request') {
          this.postDesktopLyric({
            type: 'state',
            text: this.lyricText,
            options: this.lyricOption
          });
        }
        if (data.type === 'closed') {
          this.lyricDesktopShow = false;
          this.closeCallback?.();
        }
      };
    } catch {}
    return this.channel;
  }

  private static postDesktopLyric(message: DesktopLyricMessage) {
    try {
      this.ensureChannel()?.postMessage(message);
    } catch {}
  }

  private static desktopLyricUrl() {
    const topmost = this.lyricOption?.topmost !== false;
    const query = new URLSearchParams({
      w: '720',
      h: '96',
      title: '捕获窗 · 桌面歌词',
      top: topmost ? '1' : '0',
      clear: '1',
      bg: '#000000'
    });
    return `${location.origin}/overlay/lyric?${query.toString()}`;
  }

  private broadcastDesktopLine: LyricLineChange = (_index, text) => {
    LyricManager.lyricText = text;
    LyricManager.postDesktopLyric({
      type: 'line',
      text,
      index: _index,
      options: LyricManager.lyricOption
    });
  };

  public updateLyricLine(progress: number, positionMs?: number) {
    if (this.lyricList.length == 0) {
      this.progress = progress;
      return;
    }
    const hasCueTimes = this.lyricList.some(
      line => line.startMs != null && line.endMs != null
    );
    const nowMs = Number.isFinite(positionMs) && (positionMs as number) >= 0
      ? Number(positionMs)
      : this.length > 0
        ? (this.length * progress) / 1000
        : -1;
    if (hasCueTimes && nowMs >= 0) {
      const current = this.lyricList[this.index];
      if (
        this.index >= 0 &&
        current?.startMs != null &&
        current?.endMs != null &&
        nowMs >= current.startMs &&
        nowMs < current.endMs
      ) {
        this.progress = progress;
        return;
      }
      let found = -1;
      for (let i = 0; i < this.lyricList.length; i++) {
        const line = this.lyricList[i];
        const start = line.startMs ?? 0;
        const end = line.endMs ?? this.length;
        if (nowMs >= start && nowMs < end) found = i;
      }
      this.progress = progress;
      if (this.index != found) {
        this.index = found;
        this.lyricLineChanges.length > 0 && this.publishLyricLine();
      }
      return;
    }
    if (
      this.index >= 0 &&
      this.lyricList[this.index]?.progress <= progress &&
      this.lyricList[this.index]?.max > progress
    ) {
      this.progress = progress;
      return;
    }
    let i = this.progress > progress ? 0 : this.index < 0 ? 0 : this.index;
    this.progress = progress;
    const lineLength = this.lyricList.length;
    let publisher = false;
    for (; i < lineLength; i++) {
      const line = this.lyricList[i];
      const isLast = i === lineLength - 1;
      if (
        line.progress <= this.progress &&
        (line.max > this.progress || (isLast && line.max >= this.progress))
      ) {
        for (let j = i + 1; j < lineLength; j++) {
          if (this.lyricList[j].progress === line.progress) continue;
          else {
            i = j - 1;
            break;
          }
        }

        if (this.index != i) {
          this.index = i;
          publisher = true;
        }
        break;
      }
    }
    publisher && this.lyricLineChanges.length > 0 && this.publishLyricLine();
  }

  public updateLyric(music: Music) {
    const remoteId = `${music.type}${music.id}`;
    const lengthMs = musicLengthMs(music);
    if (
      (this.parsed || this.parsing) &&
      this.id == remoteId &&
      this.length == lengthMs
    ) {
      return;
    }
    const sameSong = this.id == remoteId;
    this.id = remoteId;
    this.index = -1;
    if (!sameSong) this.progress = 0;
    this.length = lengthMs;
    this.parsed = false;
    this.music = music;
    this.title = music.name;
    if (music.singer) {
      this.title += ' - ' + music.singer;
    }
    this.lyricLineChanges.forEach(m => m.call(this, this.index, this.title));
    clearArray(this.lyricList);
    if (this.lyricChanges.length > 0 || this.lyricLineChanges.length > 0) {
      this.parseLyric();
    }
  }

  public subscribeLyric(
    callback: LyricChange,
    cancel?: boolean,
    music?: Music
  ) {
    if (!callback) return;
    const index = this.lyricChanges.indexOf(callback);
    if (!cancel && index < 0) {
      this.lyricChanges.push(callback);
    } else if (cancel && index >= 0) {
      this.lyricChanges.splice(index, 1);
    }
    if (!this.parsed) {
      if (music) this.updateLyric(music);
      else this.parseLyric();
    } else callback(this.lyricList.map(m => m.text));
  }

  public subscribeLyricLine(
    callback: LyricLineChange,
    cancel?: boolean,
    music?: Music
  ) {
    if (!callback) return;
    const index = this.lyricLineChanges.indexOf(callback);
    if (!cancel && index < 0) {
      this.lyricLineChanges.push(callback);
    } else if (cancel && index >= 0) {
      this.lyricLineChanges.splice(index, 1);
    }
    if (!this.parsed) {
      if (music) this.updateLyric(music);
      else this.parseLyric();
    } else {
      this.updateLyricLine(this.progress);
      callback(this.index, this.lyricList[this.index]?.text || this.title);
    }
  }

  private async parseLyric() {
    if (!this.music || this.parsed) return;
    this.parsing = true;
    const meta = await api.lyricMeta(this.music);
    this.parsing = false;
    if (!meta.lyric && !meta.cues?.length) {
      this.publishLyric();
      return;
    }
    const lengthMs = this.length || musicLengthMs(this.music);
    if (!lengthMs) {
      this.publishLyric();
      return;
    }
    this.length = lengthMs;
    clearArray(this.lyricList);
    const lines = meta.cues?.length
      ? parseSubtitleCues(meta.cues, lengthMs)
      : parseLyric(meta.lyric, lengthMs);
    lines.forEach(m => this.lyricList.push(m));
    if (
      this.lyricList[0]?.startMs == null &&
      this.lyricList.length < 5 &&
      this.lyricList[this.lyricList.length - 1].progress >= 1000
    ) {
      for (let i = 0; i < this.lyricList.length; i++) {
        if (i == this.lyricList.length - 1) {
          this.lyricList[i].max = 1000;
        } else {
          this.lyricList[i].max = 0;
        }
        this.lyricList[i].progress = 0;
      }
    }
    this.parsed = true;
    this.publishLyric();
    this.index = -1;
    this.updateLyricLine(this.progress);
  }

  private publishLyric() {
    const lines = this.lyricList.map(m => m.text);
    this.lyricChanges.forEach(m => m.call(this, lines));
    this.lyricLineChanges.forEach(m =>
      m.call(this, 0, lines[this.index] || this.title)
    );
  }

  private publishLyricLine() {
    const line = this.index >= 0 ? this.lyricList[this.index] : null;
    this.lyricLineChanges.forEach(m =>
      m.call(
        this,
        this.index,
        line?.text || '',
        line && LyricManager.remoteMode
          ? (this.length * (line.max - line.progress)) / 1000
          : undefined
      )
    );
  }

  private static drawCanvas = (_index: number, text: string) => {
    if (!this.canvas || !this.canvasContext) return;
    this.lyricText = text;
    let fontStyle = [];
    if (this.lyricOption) {
      if (this.lyricOption.fontBold) {
        fontStyle.push('bold');
      }
      if (this.lyricOption.fontSize) {
        fontStyle.push(
          `${Math.floor(
            this.lyricOption.fontSize *
              (isSafari ? Math.min(devicePixelRatio, 3) : devicePixelRatio)
          )}px`
        );
      }
      if (this.lyricOption.fontFamily) {
        let fontFamily = this.lyricOption.fontFamily;
        if (fontFamily.includes(' ')) fontFamily = `'${fontFamily}'`;
        fontStyle.push(fontFamily);
      } else {
        if (!defaultFont) {
          const [fontFamily = 'arial'] = window
            .getComputedStyle(document.body)
            .fontFamily.split(',');
          defaultFont = fontFamily.trim() || 'arial';
        }
        fontStyle.push(defaultFont);
      }
    }
    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;
    this.canvasContext.clearRect(0, 0, canvasWidth, canvasHeight);
    this.canvasContext.font = fontStyle.join(' ');
    this.canvasContext.fillStyle = this.lyricOption?.fontColor ?? 'white';
    const x = Math.floor(canvasWidth / 2);
    const y = Math.floor(canvasHeight / 2);
    if (this.lyricOption?.effect) {
      this.canvasContext.strokeStyle = this.lyricOption?.effectColor || '';
      this.canvasContext.strokeText(text || '', x, y, canvasWidth);
    }
    this.canvasContext.fillText(text || '', x, y, canvasWidth);
  };

  private setWebviewLine(_index: number, text: string, duration?: number) {
    musicOperate(
      '/lyricline?duration=' + ((isWindows && duration) || ''),
      text
    );
  }

  public showInDesktop(
    title: string,
    show: boolean = true,
    callback: (() => void) | null = null,
    music?: Music
  ) {
    if (LyricManager.remoteMode) {
      LyricManager.lyricDesktopShow = show;
      musicOperate(
        '/lyric',
        JSON.stringify({ ...LyricManager.lyricOption, show, title })
      );
      this.subscribeLyricLine(this.setWebviewLine, !show);
      return;
    }
    LyricManager.closeCallback = callback;
    LyricManager.ensureChannel();
    if (!show) {
      LyricManager.lyricDesktopShow = false;
      this.subscribeLyricLine(this.broadcastDesktopLine, true);
      this.subscribeLyricLine(LyricManager.drawCanvas, true);
      LyricManager.postDesktopLyric({ type: 'hide' });
      this.stopPictureInPicture();
      return;
    }
    const alreadyOpen = LyricManager.lyricDesktopShow;
    LyricManager.lyricDesktopShow = true;
    LyricManager.lyricText = title;
    const popup = alreadyOpen
      ? null
      : window.open(
          LyricManager.desktopLyricUrl(),
          'danmaku-desktop-lyric',
          'width=720,height=96,menubar=no,toolbar=no,location=no,status=no,resizable=yes'
        );
    this.subscribeLyricLine(this.broadcastDesktopLine, false, music);
    LyricManager.postDesktopLyric({
      type: 'state',
      text: title,
      options: LyricManager.lyricOption
    });
    if (!alreadyOpen && !popup && !isElectronShell()) {
      this.showInPictureInPicture(title, callback, music);
    }
  }

  private stopPictureInPicture() {
    if (document.pictureInPictureElement) document.exitPictureInPicture();
    LyricManager.video?.pause();
    if (LyricManager.video) {
      const track = (LyricManager.video?.srcObject as any)?.getVideoTracks();
      track && LyricManager.canvas?.captureStream().removeTrack(track[0]);
      LyricManager.video.srcObject = null;
      LyricManager.video.src = '';
    }
    LyricManager.video?.remove();
    LyricManager.canvas?.remove();
    LyricManager.video = null;
    LyricManager.canvas = null;
    LyricManager.canvasContext = null;
  }

  private showInPictureInPicture(
    title: string,
    callback: (() => void) | null,
    music?: Music
  ) {
    LyricManager.canvas = document.createElement('canvas');
    (LyricManager.canvas as any).style['-webkit-font-smoothing'] =
      'antialiased';
    (LyricManager.canvas as any).style['-moz-osx-font-smoothing'] = 'grayscale';
    const width = 300;
    const height = 40;
    LyricManager.canvas.width = width * devicePixelRatio;
    LyricManager.canvas.height = height * devicePixelRatio;
    LyricManager.canvas.style.width = width + 'px';
    LyricManager.canvas.style.height = height + 'px';
    LyricManager.canvasContext = LyricManager.canvas.getContext('2d');
    if (!LyricManager.canvasContext) {
      LyricManager.canvas.remove();
      LyricManager.canvas = null;
      return;
    }
    LyricManager.canvasContext.imageSmoothingEnabled = true;
    LyricManager.canvasContext.lineWidth = Math.floor(1.5 * devicePixelRatio);
    LyricManager.canvasContext.textAlign = 'center';
    LyricManager.canvasContext.textBaseline = 'middle';
    LyricManager.drawCanvas(0, title);
    LyricManager.video = document.createElement('video');
    LyricManager.video.addEventListener('loadedmetadata', () => {
      if (!LyricManager.video?.requestPictureInPicture) {
        ElMessage(messageOption('暂不支持桌面歌词'));
        callback && callback();
        return;
      }
      try {
        LyricManager.video?.play();
      } catch {}
      if (document.pictureInPictureElement) return;
      LyricManager.video?.requestPictureInPicture().catch(_e => {
        ElMessageBox.confirm('', '开启桌面歌词', {
          closeOnClickModal: false,
          showCancelButton: false,
          showClose: false,
          confirmButtonText: '确定'
        })
          .then(() => {
            LyricManager.video
              ?.requestPictureInPicture()
              .then(() => {
                try {
                  LyricManager.video?.play();
                } catch {}
              })
              .catch(() => {
                ElMessage(messageOption('开启桌面歌词失败'));
                callback && callback();
              });
          })
          .catch(callback);
      });
    });
    callback &&
      LyricManager.video.addEventListener('leavepictureinpicture', callback);
    LyricManager.video.style.position = 'fixed';
    LyricManager.video.style.left = '0';
    LyricManager.video.style.top = '0';
    LyricManager.video.style.opacity = '0';
    LyricManager.video.style.zIndex = '-123';
    LyricManager.video.muted = true;
    LyricManager.video.autoplay = true;
    LyricManager.video.controls = false;
    LyricManager.video.playsInline = true;
    LyricManager.video.width = width;
    LyricManager.video.height = height;
    LyricManager.video.srcObject = LyricManager.canvas.captureStream(25);
    document.body.appendChild(LyricManager.video);
    this.subscribeLyricLine(LyricManager.drawCanvas, false, music);
  }
}
