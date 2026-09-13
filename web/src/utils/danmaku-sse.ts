import { DANMAKU_API } from './api/danmaku-qq';
import type { Music } from './type';

export interface DanmakuConnection {
  state: string;
  roomId: number;
  lastPacketAt: number;
  retryCount: number;
  detail: string;
}

export interface DanmakuLog {
  message: string;
  level?: string;
  at?: number;
}

export interface DanmakuSnapshot {
  version?: number;
  current: Music | null;
  queue: Music[];
  history: Music[];
  playing: boolean;
  loading?: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  mode: string;
  accepting?: boolean;
  giftRequestEnabled?: boolean;
  giftRequest?: {
    giftId: number;
    giftName: string;
    giftIcon: string;
    giftPrice: number;
    coinType: string;
    batteries: number;
  };
  giftRequestQualifyMode?: 'specific' | 'threshold';
  giftRequestThreshold?: number;
  giftRequestCountMode?: 'once' | 'accumulate';
  giftSkipEnabled?: boolean;
  giftSkipAction?: 'instant' | 'credit';
  giftSkipExpireSec?: number;
  giftSkipQualifyMode?: 'specific' | 'threshold';
  giftSkipGift?: DanmakuSnapshot['giftRequest'];
  giftSkipThreshold?: number;
  songBlacklistEnabled?: boolean;
  songBlacklist?: string[];
  connection?: DanmakuConnection;
  biliRoom?: string;
  idlePlaylistEnabled?: boolean;
  idlePlaylist?: {
    source: string;
    id: string;
    name?: string;
    image?: string;
  } | null;
  playback?: {
    playing: boolean;
    loading: boolean;
    positionMs: number;
    durationMs: number;
    updatedAt: number;
  };
  extensions?: Record<string, unknown>;
}

export class DanmakuSse {
  private source: EventSource | null = null;
  private closed = false;
  private reconnectTimer: number | null = null;
  constructor(
    private readonly onSnapshot: (data: DanmakuSnapshot) => void,
    private readonly onPlayer: (data: any) => void = () => {},
    private readonly onError: (error: Event) => void = () => {},
    private readonly onConn: (data: DanmakuConnection) => void = () => {},
    private readonly onLog: (data: DanmakuLog) => void = () => {}
  ) {}
  connect() {
    this.closed = false;
    this.source?.close();
    this.source = new EventSource(`${DANMAKU_API}/events`);
    this.source.addEventListener('snapshot', event => this.consume(event, this.onSnapshot));
    this.source.addEventListener('play', event => this.consume(event, this.onPlayer));
    this.source.addEventListener('pause', event => this.consume(event, this.onPlayer));
    this.source.addEventListener('progress', event => this.consume(event, this.onPlayer));
    this.source.addEventListener('ended', event => this.consume(event, this.onPlayer));
    this.source.addEventListener('error', event => this.consume(event, this.onPlayer));
    this.source.addEventListener('player', event => this.consume(event, this.onPlayer));
    this.source.addEventListener('conn', event => this.consume(event, this.onConn));
    this.source.addEventListener('log', event => this.consume(event, this.onLog));
    this.source.onerror = event => {
      this.onError(event);
      this.source?.close();
      if (!this.closed && this.reconnectTimer == null) {
        this.reconnectTimer = window.setTimeout(() => { this.reconnectTimer = null; this.connect(); }, 1500);
      }
    };
  }
  close() {
    this.closed = true;
    if (this.reconnectTimer != null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.source?.close(); this.source = null;
  }
  private consume<T>(event: Event, callback: (data: T) => void) {
    const data = (event as MessageEvent).data;
    if (data == null || data === '' || data === 'undefined') return;
    try { callback(JSON.parse(data)); } catch (error) { console.warn('danmaku SSE frame invalid', error); }
  }
}
