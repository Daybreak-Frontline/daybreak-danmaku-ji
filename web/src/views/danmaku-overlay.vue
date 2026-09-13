<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, onUpdated, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { danmakuState } from '../utils/api/danmaku-qq';
import { DanmakuSse, type DanmakuSnapshot } from '../utils/danmaku-sse';
import { LogoCircleImage } from '../utils/logo';
import type { Music } from '../utils/type';
import { getOverlayFormat, overlayBackgroundIsLight, readOverlayBackground, readOverlayBackgroundImage, subscribeOverlayTheme, type OverlayBackground } from '../utils/overlay-formats';

type ScrollItem = {
  key: string;
  status: string;
  title: string;
  meta: string;
  song: Music | null;
  tone: 'now' | 'next' | 'in' | 'idle';
};

const COMPACT_IDS = new Set(['ticker', 'scroll', 'scrollv', 'flip', 'flipv']);
const STREAM_IDS = new Set(['scroll', 'scrollv']);
const FLIP_IDS = new Set(['flip', 'flipv']);

const route = useRoute();
const format = computed(() => getOverlayFormat(String(route.params.format || '')));
const snapshot = ref<DanmakuSnapshot | null>(null);
const background = ref<OverlayBackground>(readOverlayBackground());
const backgroundImage = ref('');
let sse: DanmakuSse | null = null;
let stopTheme: (() => void) | null = null;
let raf = 0;
let cycleTimer = 0;
let lastFill = 'scaleX(0)';
const current = computed(() => snapshot.value?.current || null);
const accepting = computed(() => snapshot.value?.accepting !== false);
const giftHint = computed(() => {
  const data = snapshot.value;
  if (!data) return '';
  const parts: string[] = [];
  if (data.giftRequestEnabled) {
    if (data.giftRequestQualifyMode === 'threshold' && data.giftRequestThreshold) {
      parts.push(`礼物点歌 · 满 ${data.giftRequestThreshold} 电池`);
    } else if (data.giftRequest?.giftName) {
      parts.push(`礼物点歌 · 赠送「${data.giftRequest.giftName}」`);
    } else {
      parts.push('礼物点歌已开启');
    }
  }
  if (data.giftSkipEnabled) {
    parts.push(data.giftSkipAction === 'credit' ? '礼物切歌 · 发「切歌」消耗次数' : '礼物切歌 · 当场切歌');
  }
  return parts.join('  ·  ');
});
const playing = computed(() => Boolean(snapshot.value?.playing || snapshot.value?.playback?.playing));
const upcoming = computed(() => {
  const nowKey = songKey(current.value);
  return requestQueueItems(snapshot.value?.queue).filter(item => songKey(item) !== nowKey);
});
const queueCount = computed(() => upcoming.value.length);
const nextThree = computed(() => upcoming.value.slice(0, 3));
const enqueueNotice = ref<Music | null>(null);
const enqueueToken = ref(0);
const cycleIndex = ref(0);
const animKey = ref(0);
const marqueeTrack = ref<HTMLElement | null>(null);
const marqueeSeconds = ref(14);
const marqueePort = ref(520);
const pendingNotices: Music[] = [];
const knownQueueCounts = new Map<string, number>();
let queueKeysReady = false;
let suppressEnqueueUntil = 0;
const isCompact = computed(() => COMPACT_IDS.has(format.value.id));
const isStream = computed(() => STREAM_IDS.has(format.value.id));
const isFlip = computed(() => FLIP_IDS.has(format.value.id));
const isVertical = computed(() => format.value.id === 'scrollv' || format.value.id === 'flipv');

const playClock = {
  positionMs: 0,
  durationMs: 0,
  playing: false,
  songKey: '',
  anchorPerf: 0,
  primed: false
};

function asMediaMs(value: number) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 10000 ? n : n * 1000;
}

function interpolatedMs() {
  if (!playClock.playing) return playClock.positionMs;
  return playClock.positionMs + Math.max(0, performance.now() - playClock.anchorPerf);
}

function applyFill(transform = lastFill) {
  lastFill = transform;
  const nodes = document.querySelectorAll<HTMLElement>('.ov-fill');
  for (const node of nodes) {
    if (node.style.transform !== lastFill) node.style.transform = lastFill;
  }
}

function paintProgress() {
  const duration = playClock.durationMs;
  const ratio = duration ? Math.max(0, Math.min(1, interpolatedMs() / duration)) : 0;
  applyFill(`scaleX(${ratio})`);
  if (playClock.playing && duration) raf = window.requestAnimationFrame(paintProgress);
  else raf = 0;
}

function ensurePaint() {
  if (!raf) raf = window.requestAnimationFrame(paintProgress);
}

function pickDurationMs(playback?: any, data?: DanmakuSnapshot | null) {
  const fromPlayback = asMediaMs(Number(playback?.durationMs || playback?.duration || 0));
  if (fromPlayback >= 1000) return fromPlayback;
  const fromSnap = asMediaMs(Number(data?.playback?.durationMs || data?.duration || 0));
  if (fromSnap >= 1000) return fromSnap;
  return asMediaMs(Number(data?.current?.length || 0));
}

function applyPlaybackSample(playback: any, opts?: { songChanged?: boolean; force?: boolean }) {
  if (!playback && !opts?.force) return;
  const durationMs = pickDurationMs(playback, snapshot.value);
  const durationChanged = Boolean(playClock.primed && durationMs >= 1000 && playClock.durationMs >= 1000 && Math.abs(durationMs - playClock.durationMs) > 2500);
  const positionMs = Math.max(0, typeof playback?.positionMs === 'number'
    ? playback.positionMs
    : Math.round(Number(playback?.currentTime ?? snapshot.value?.currentTime ?? 0) * 1000));
  const isPlaying = Boolean(playback?.playing ?? snapshot.value?.playing);
  const updatedAt = Number(playback?.updatedAt) || 0;
  const remoteAge = updatedAt > 0 ? Math.max(0, Date.now() - updatedAt) : 0;
  const remoteNow = positionMs + (isPlaying ? Math.min(remoteAge, 2500) : 0);
  const localNow = interpolatedMs();
  if (opts?.songChanged || opts?.force || durationChanged || !playClock.primed) {
    playClock.durationMs = durationMs || playClock.durationMs;
    playClock.positionMs = positionMs;
    playClock.anchorPerf = performance.now();
    playClock.playing = isPlaying;
    playClock.primed = true;
    if (isPlaying) ensurePaint();
    return;
  }
  if (durationMs > playClock.durationMs) playClock.durationMs = durationMs;
  playClock.playing = isPlaying;
  if (isPlaying) ensurePaint();
  if (!isPlaying) {
    playClock.positionMs = positionMs;
    playClock.anchorPerf = performance.now();
    return;
  }
  if (Math.abs(localNow - remoteNow) < 1500) return;
  playClock.positionMs = remoteNow;
  playClock.anchorPerf = performance.now();
}

function who(song?: Music | null) {
  return String(song?.requestedBy || song?.requester || '').trim();
}

function cover(song?: Music | null) {
  return song?.largeImage || song?.mediumImage || song?.image || song?.coverUrl || LogoCircleImage;
}

function songKey(item?: Music | null) {
  return item?.id ? `${item.type || ''}:${String(item.id)}` : '';
}

function isLibrarySong(item?: Music | null) {
  return item?.origin === 'library';
}

function requestQueueItems(list?: Music[] | null) {
  return (list || []).filter(item => item?.id && !isLibrarySong(item));
}

function queueItemKey(item?: Music | null, index = 0) {
  const key = songKey(item);
  return key ? `${key}#${index}` : `n-${index}`;
}

function countUpcomingKeys(list: Music[], skipKey = '') {
  const counts = new Map<string, number>();
  for (const item of list) {
    const key = songKey(item);
    if (!key || key === skipKey) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function songMeta(song?: Music | null) {
  if (!song) return '';
  return [song.singer, who(song) ? `点歌 ${who(song)}` : ''].filter(Boolean).join(' · ');
}

function pushEnqueueNotice(song: Music) {
  if (enqueueNotice.value) pendingNotices.push(song);
  else {
    enqueueNotice.value = song;
    enqueueToken.value += 1;
    animKey.value += 1;
  }
}

function noteNewQueueItems(data: DanmakuSnapshot) {
  const list = requestQueueItems(data.queue);
  const skipKey = songKey(data.current || snapshot.value?.current);
  const nextCounts = countUpcomingKeys(list, skipKey);
  if (!queueKeysReady) {
    knownQueueCounts.clear();
    for (const [key, count] of nextCounts) knownQueueCounts.set(key, count);
    queueKeysReady = true;
    suppressEnqueueUntil = Date.now() + 1200;
    return;
  }
  const added: Music[] = [];
  for (const [key, count] of nextCounts) {
    const extra = count - (knownQueueCounts.get(key) || 0);
    if (extra <= 0) continue;
    const copies = list.filter(item => songKey(item) === key);
    added.push(...copies.slice(-extra));
  }
  knownQueueCounts.clear();
  for (const [key, count] of nextCounts) knownQueueCounts.set(key, count);
  if (Date.now() < suppressEnqueueUntil) return;
  for (const item of added) {
    if (songKey(item) === skipKey) continue;
    pushEnqueueNotice(item);
  }
}

function finishNotice() {
  if (!enqueueNotice.value) return false;
  enqueueNotice.value = pendingNotices.shift() || null;
  if (enqueueNotice.value) enqueueToken.value += 1;
  animKey.value += 1;
  return true;
}

function onNoticeEnded(event: AnimationEvent) {
  if (event.target !== marqueeTrack.value || !enqueueNotice.value) return;
  finishNotice();
}

const scrollItems = computed<ScrollItem[]>(() => {
  const notice = enqueueNotice.value;
  if (notice) {
    return [{
      key: `in-${enqueueToken.value}`,
      status: '已入队',
      title: notice.name || '未知歌曲',
      meta: songMeta(notice),
      song: notice,
      tone: 'in'
    }];
  }
  const items: ScrollItem[] = [];
  const now = current.value;
  if (now) {
    items.push({
      key: `now-${songKey(now)}`,
      status: playing.value ? '播放中' : '已暂停',
      title: now.name || '未知歌曲',
      meta: songMeta(now),
      song: now,
      tone: 'now'
    });
  } else {
    items.push({
      key: 'idle',
      status: '等待点歌',
      title: '暂无歌曲',
      meta: '',
      song: null,
      tone: 'idle'
    });
  }
  nextThree.value.forEach((song, index) => {
    items.push({
      key: queueItemKey(song, index),
      status: index === 0 ? '下一首' : `第${index + 2}首`,
      title: song.name || '未知歌曲',
      meta: who(song) || song.singer || '',
      song,
      tone: 'next'
    });
  });
  return items;
});

const activeSlide = computed(() => {
  const items = scrollItems.value;
  if (enqueueNotice.value) return items[0];
  if (!items.length) return { key: 'idle', status: '等待点歌', title: '暂无歌曲', meta: '', song: null, tone: 'idle' } as ScrollItem;
  return items[cycleIndex.value % items.length];
});

function scheduleCycle() {
  window.clearTimeout(cycleTimer);
  cycleTimer = 0;
  if (!isFlip.value) return;
  const hold = enqueueNotice.value ? 5200 : 4200;
  cycleTimer = window.setTimeout(() => {
    if (finishNotice()) {
      scheduleCycle();
      return;
    }
    const items = scrollItems.value;
    if (items.length > 1) {
      cycleIndex.value = (cycleIndex.value + 1) % items.length;
      animKey.value += 1;
    }
    scheduleCycle();
  }, hold);
}

async function measureMarquee() {
  if (!isStream.value) return;
  const vertical = isVertical.value;
  const items = scrollItems.value;
  const chars = items.reduce((n, item) => n + item.status.length + item.title.length + item.meta.length, 2);
  marqueeSeconds.value = enqueueNotice.value
    ? Math.max(5.5, Math.min(16, chars / 3.2 + 2.8))
    : Math.max(8, Math.min(40, chars / 2.4));
  await nextTick();
  const el = marqueeTrack.value;
  if (!el) return;
  const copies = enqueueNotice.value ? 1 : 2;
  const size = (vertical ? el.scrollHeight : el.scrollWidth) / copies;
  const port = vertical ? (el.parentElement?.clientHeight || 240) : (el.parentElement?.clientWidth || 480);
  marqueePort.value = port;
  const distance = enqueueNotice.value ? port + size : Math.max(size, 1);
  const speed = enqueueNotice.value ? (vertical ? 72 : 96) : (vertical ? 48 : 72);
  marqueeSeconds.value = Math.max(enqueueNotice.value ? 5.5 : 8, distance / speed);
}

watch([scrollItems, enqueueToken, () => format.value.id], () => { measureMarquee(); });
watch([isFlip, enqueueNotice, () => scrollItems.value.map(item => item.key).join('|')], () => {
  if (cycleIndex.value >= scrollItems.value.length) cycleIndex.value = 0;
  scheduleCycle();
});

function applySnapshot(data: DanmakuSnapshot) {
  if (!data) return;
  noteNewQueueItems(data);
  const prevKey = songKey(snapshot.value?.current);
  snapshot.value = {
    ...data,
    current: 'current' in data ? data.current : (snapshot.value?.current || null),
    queue: Array.isArray(data.queue) ? data.queue : (snapshot.value?.queue || [])
  };
  const nextKey = songKey(snapshot.value.current);
  if (prevKey !== nextKey) {
    cycleIndex.value = 0;
    if (enqueueNotice.value && songKey(enqueueNotice.value) === nextKey) finishNotice();
  }
  applyPlaybackSample(data.playback, { songChanged: prevKey !== nextKey });
  playClock.songKey = nextKey;
}

function applyPlayer(data: any) {
  if (data && Array.isArray(data.queue) && 'current' in data) {
    applySnapshot(data as DanmakuSnapshot);
    return;
  }
  if (!data || !snapshot.value) {
    if (data?.current || typeof data?.playing === 'boolean') {
      snapshot.value = { ...(snapshot.value || { current: null, queue: [], history: [], playing: false, currentTime: 0, duration: 0, volume: 100, mode: 'loop' }), ...data };
    }
    applyPlaybackSample(data?.playback || data, { force: !playClock.primed });
    return;
  }
  const prevKey = songKey(snapshot.value.current);
  if (data.current) snapshot.value.current = data.current;
  if (typeof data.playing === 'boolean') snapshot.value.playing = data.playing;
  if (typeof data.currentTime === 'number') snapshot.value.currentTime = data.currentTime;
  if (typeof data.duration === 'number') snapshot.value.duration = data.duration;
  const incoming = data.playback || (
    typeof data.positionMs === 'number' || typeof data.currentTime === 'number' || typeof data.durationMs === 'number'
      ? data
      : null
  );
  if (incoming) {
    const nextKey = songKey(snapshot.value.current);
    applyPlaybackSample({
      ...incoming,
      playing: incoming.playing ?? data.playing ?? snapshot.value.playing ?? playClock.playing
    }, { songChanged: prevKey !== nextKey });
    snapshot.value.playback = {
      playing: playClock.playing,
      loading: Boolean(incoming.loading ?? snapshot.value.playback?.loading),
      positionMs: playClock.positionMs,
      durationMs: playClock.durationMs,
      updatedAt: Number(incoming.updatedAt || data.updatedAt) || Date.now()
    };
    snapshot.value.currentTime = interpolatedMs() / 1000;
    if (playClock.durationMs) snapshot.value.duration = playClock.durationMs / 1000;
  }
}

function hideBrokenImage(event: Event) {
  const img = event.target as HTMLImageElement;
  img.src = LogoCircleImage;
}

const overlayClass = computed(() => ({
  'is-light': overlayBackgroundIsLight(background.value),
  'is-clear': background.value.mode === 'transparent'
}));
const backgroundLayerStyle = computed(() => {
  const opacity = Math.max(0, Math.min(1, background.value.opacity / 100));
  if (background.value.mode === 'transparent') return { background: 'transparent', opacity: 1 };
  if (background.value.mode === 'image' && backgroundImage.value) {
    return {
      backgroundImage: `url(${backgroundImage.value})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundColor: background.value.color,
      opacity
    };
  }
  return { background: background.value.color, opacity };
});

async function loadTheme() {
  background.value = readOverlayBackground();
  if (background.value.mode === 'image') {
    backgroundImage.value = await readOverlayBackgroundImage();
  } else {
    backgroundImage.value = '';
  }
  applyDocumentBackground();
}

function applyDocumentBackground() {
  const bg = background.value;
  const fill = bg.mode === 'transparent' ? 'transparent' : bg.color;
  document.documentElement.style.opacity = '1';
  for (const el of [document.documentElement, document.body, document.getElementById('app')]) {
    if (el) {
      el.style.background = fill;
      el.style.backgroundColor = fill;
    }
  }
}

onUpdated(() => { applyFill(); });

onMounted(async () => {
  document.title = `捕获窗 · ${format.value.name}`;
  document.documentElement.style.opacity = '1';
  loadTheme();
  stopTheme = subscribeOverlayTheme(() => { loadTheme(); });
  try { applySnapshot((await danmakuState()) as DanmakuSnapshot); } catch {}
  sse = new DanmakuSse(applySnapshot, applyPlayer);
  sse.connect();
  ensurePaint();
  window.addEventListener('resize', measureMarquee);
  scheduleCycle();
});

onUnmounted(() => {
  sse?.close();
  stopTheme?.();
  window.removeEventListener('resize', measureMarquee);
  if (raf) window.cancelAnimationFrame(raf);
  window.clearTimeout(cycleTimer);
  backgroundImage.value = '';
});
</script>

<template>
  <div class="ov-shell" :class="overlayClass">
    <div class="ov-bg" :style="backgroundLayerStyle"></div>
    <div class="ov" :class="'ov-' + format.id" :data-format="format.id">
    <div v-if="!accepting" class="ov-closed">点歌已关闭</div>
    <div v-else-if="giftHint && !isCompact" class="ov-gift">{{ giftHint }}</div>

    <template v-if="isStream">
      <img v-if="!isVertical" class="ov-cover" :src="cover(enqueueNotice || current)" alt="" @error="hideBrokenImage" />
      <b class="ov-count">队列 {{ queueCount }}</b>
      <div class="ov-marquee" :class="{ 'is-vert': isVertical }">
        <div
          :key="'m-' + enqueueToken + (enqueueNotice ? '-n' : '-l-' + (current?.id || 'none'))"
          ref="marqueeTrack"
          class="ov-marquee-track"
          :class="{ 'is-once': Boolean(enqueueNotice), 'is-vert': isVertical }"
          :style="{ animationDuration: marqueeSeconds + 's', '--ov-port': marqueePort + 'px' }"
          @animationend="onNoticeEnded">
          <div class="ov-marquee-seq" :class="{ 'is-vert': isVertical }">
            <div v-for="item in scrollItems" :key="'a-' + item.key" class="ov-line" :class="'is-' + item.tone">
              <img v-if="isVertical" class="ov-cover" :src="cover(item.song)" alt="" @error="hideBrokenImage" />
              <em :class="{ 'is-in': item.tone === 'in' }">{{ item.status }}</em>
              <strong>{{ item.title }}</strong>
              <span v-if="item.meta">{{ item.meta }}</span>
            </div>
          </div>
          <div v-if="!enqueueNotice" class="ov-marquee-seq" :class="{ 'is-vert': isVertical }" aria-hidden="true">
            <div v-for="item in scrollItems" :key="'b-' + item.key" class="ov-line" :class="'is-' + item.tone">
              <img v-if="isVertical" class="ov-cover" :src="cover(item.song)" alt="" @error="hideBrokenImage" />
              <em :class="{ 'is-in': item.tone === 'in' }">{{ item.status }}</em>
              <strong>{{ item.title }}</strong>
              <span v-if="item.meta">{{ item.meta }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="ov-tick"><i class="ov-fill"></i></div>
    </template>

    <template v-else-if="isFlip">
      <b class="ov-count">队列 {{ queueCount }}</b>
      <div class="ov-flip-port">
        <div :key="activeSlide.key + '-' + animKey" class="ov-flip-card" :class="'is-' + activeSlide.tone">
          <img class="ov-cover" :src="cover(activeSlide.song)" alt="" @error="hideBrokenImage" />
          <div class="ov-copy">
            <em :class="{ 'is-in': activeSlide.tone === 'in' }">{{ activeSlide.status }}</em>
            <strong>{{ activeSlide.title }}</strong>
            <span>{{ activeSlide.meta || (activeSlide.tone === 'idle' ? '队列空闲' : '') }}</span>
          </div>
        </div>
      </div>
      <div class="ov-tick"><i class="ov-fill"></i></div>
    </template>

    <template v-else-if="format.id === 'ticker'">
      <img class="ov-cover" :src="cover(current)" alt="" @error="hideBrokenImage" />
      <div class="ov-copy">
        <em>{{ current ? (playing ? '播放中' : '已暂停') : '暂无歌曲' }}</em>
        <strong>{{ current?.name || '等待点歌' }}</strong>
        <span>{{ current ? [current.singer, who(current)].filter(Boolean).join(' · ') : '队列空闲' }}</span>
      </div>
      <b class="ov-count">队列 {{ queueCount }}</b>
      <div class="ov-tick"><i class="ov-fill"></i></div>
    </template>

    <template v-else-if="format.id === 'bar'">
      <div class="ov-now">
        <img class="ov-cover" :src="cover(current)" alt="" @error="hideBrokenImage" />
        <div class="ov-copy">
          <div class="ov-kicker">
            <em>{{ current ? (playing ? '播放中' : '已暂停') : '暂无歌曲' }}</em>
            <b class="ov-count">队列 {{ queueCount }}</b>
          </div>
          <strong>{{ current?.name || '等待点歌' }}</strong>
          <span>{{ current ? [current.singer, who(current)].filter(Boolean).join(' · ') : '队列空闲' }}</span>
          <div class="ov-meter"><i class="ov-fill"></i></div>
        </div>
      </div>
      <ol class="ov-next">
        <li v-for="(song, index) in nextThree" :key="queueItemKey(song, index)">
          <b>{{ String(index + 1).padStart(2, '0') }}</b>
          <div>
            <strong>{{ song.name }}</strong>
            <span>{{ who(song) || song.singer }}</span>
          </div>
        </li>
        <li v-if="!upcoming.length" class="is-empty">接下来没有歌曲</li>
      </ol>
    </template>

    <template v-else-if="format.id === 'card'">
      <b class="ov-count is-float">队列 {{ queueCount }}</b>
      <img class="ov-art" :src="cover(current)" alt="" @error="hideBrokenImage" />
      <div class="ov-shade">
        <em>{{ current ? (playing ? '播放中' : '已暂停') : '暂无歌曲' }}</em>
        <strong>{{ current?.name || '等待点歌' }}</strong>
        <span>{{ current?.singer || '队列空闲' }}</span>
        <small v-if="who(current)">点歌 · {{ who(current) }}</small>
        <div class="ov-meter"><i class="ov-fill"></i></div>
      </div>
    </template>

    <template v-else>
      <div v-if="format.id !== 'queue'" class="ov-now">
        <img class="ov-cover" :src="cover(current)" alt="" @error="hideBrokenImage" />
        <div class="ov-copy">
          <em>{{ current ? (playing ? '播放中' : '已暂停') : '暂无歌曲' }}</em>
          <strong>{{ current?.name || '等待点歌' }}</strong>
          <span>{{ current?.singer || '队列空闲' }}</span>
          <small v-if="who(current)">点歌 · {{ who(current) }}</small>
          <div class="ov-meter"><i class="ov-fill"></i></div>
        </div>
      </div>
      <div class="ov-pane">
        <div class="ov-head">
          <span>{{ format.id === 'queue' && current ? '正在播放 · ' + current.name : '待播名单' }}</span>
          <b class="ov-count">队列 {{ queueCount }}</b>
        </div>
        <ol class="ov-list">
          <li v-if="format.id === 'queue' && current" class="is-now">
            <b>●</b>
            <img :src="cover(current)" alt="" @error="hideBrokenImage" />
            <div>
              <strong>{{ current.name }}</strong>
              <span>{{ [current.singer, who(current)].filter(Boolean).join(' · ') }}</span>
            </div>
          </li>
          <li v-for="(song, index) in upcoming" :key="queueItemKey(song, index)">
            <b>{{ String(index + 1).padStart(2, '0') }}</b>
            <img :src="cover(song)" alt="" @error="hideBrokenImage" />
            <div>
              <strong>{{ song.name }}</strong>
              <span>{{ [song.singer, who(song)].filter(Boolean).join(' · ') }}</span>
            </div>
          </li>
          <li v-if="!upcoming.length && !(format.id === 'queue' && current)" class="is-empty">队列空闲</li>
        </ol>
      </div>
    </template>
  </div>
  </div>
</template>

<style scoped>
.ov-shell {
  --ov-bg: #0b0d12;
  --ov-card: rgba(21, 25, 34, 0.88);
  --ov-line: rgba(255, 255, 255, 0.12);
  --ov-text: #f4f6fb;
  --ov-muted: #c5ccd8;
  --ov-accent: #ff5a7a;
  position: relative;
  height: 100%;
  width: 100%;
  overflow: hidden;
  color: var(--ov-text);
  background: transparent;
}
.ov-shell.is-light {
  --ov-card: rgba(255, 255, 255, 0.86);
  --ov-line: rgba(0, 0, 0, 0.12);
  --ov-text: #16181d;
  --ov-muted: #5b616c;
  --ov-accent: #d63b5c;
}
.ov-shell.is-clear strong,
.ov-shell.is-clear span,
.ov-shell.is-clear em,
.ov-shell.is-clear small,
.ov-shell.is-clear .ov-count {
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
}
.ov-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.ov {
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  height: 100%;
  width: 100%;
  overflow: hidden;
  background: transparent;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  display: flex;
  flex-direction: column;
}
.ov-closed {
  flex: none;
  text-align: center;
  letter-spacing: 0.18em;
  font-size: 13px;
  font-weight: 700;
  padding: 8px 12px;
  background: #ff5a7a;
  color: #fff;
}
.ov-gift {
  flex: none;
  text-align: center;
  font-size: 12px;
  padding: 6px 12px;
  background: rgba(255, 90, 122, 0.16);
  color: #ff8aa3;
}
.ov-copy, .ov-list div, .ov-next div { min-width: 0; }
.ov-copy em, .ov-shade em {
  display: block;
  color: var(--ov-accent);
  font-size: 11px;
  font-style: normal;
  letter-spacing: 0.16em;
  margin-bottom: 6px;
}
.ov-kicker {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.ov-kicker em { margin: 0; }
.ov-count {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 52px;
  padding: 2px 8px;
  border-radius: 99px;
  background: color-mix(in srgb, var(--ov-accent) 22%, transparent);
  color: var(--ov-accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
  font-style: normal;
  line-height: 1.4;
}
.ov-count.is-float {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
  background: rgba(8, 10, 16, 0.62);
  color: #fff;
}
.ov-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 16px 4px 8px;
  color: var(--ov-accent);
  font-size: 11px;
  letter-spacing: 0.16em;
}
.ov strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ov span, .ov small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ov-muted); }
.ov-cover, .ov-list img, .ov-art { object-fit: cover; background: #1b202b; }
.ov-meter, .ov-tick { height: 4px; border-radius: 99px; background: #2a3140; overflow: hidden; }
.ov-fill {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--ov-accent);
  transform: scaleX(0);
  transform-origin: left center;
  will-change: transform;
  backface-visibility: hidden;
}
.ov-list, .ov-next { list-style: none; margin: 0; padding: 0; }
.ov-list li, .ov-next li { display: flex; align-items: center; gap: 10px; }
.ov-list b, .ov-next b { flex: none; color: var(--ov-muted); font-variant-numeric: tabular-nums; font-size: 12px; }
.is-empty { color: var(--ov-muted); justify-content: center; padding: 18px 0; }

.ov-sidebar, .ov-queue, .ov-poster { padding: 18px; }
.ov-sidebar .ov-now, .ov-queue .ov-now, .ov-poster .ov-now {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 14px;
  border-radius: 16px;
  background: var(--ov-card);
}
.ov-sidebar .ov-cover, .ov-queue .ov-cover { width: 92px; height: 92px; border-radius: 12px; }
.ov-sidebar .ov-copy strong, .ov-queue .ov-copy strong { font-size: 22px; }
.ov-sidebar .ov-meter, .ov-queue .ov-meter, .ov-poster .ov-meter { margin-top: 10px; }
.ov-pane { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.ov-list { flex: 1; overflow: hidden; }
.ov-list li { padding: 9px 4px; border-bottom: 1px solid var(--ov-line); }
.ov-list img { width: 42px; height: 42px; border-radius: 8px; flex: none; }
.ov-list strong { font-size: 15px; }

.ov-poster .ov-now { flex-direction: column; align-items: stretch; padding: 0; overflow: hidden; }
.ov-poster .ov-cover { width: 100%; height: 280px; border-radius: 16px 16px 0 0; }
.ov-poster .ov-copy { padding: 16px 16px 18px; }
.ov-poster .ov-copy strong { font-size: 28px; white-space: normal; line-height: 1.25; }

.ov-bar {
  flex-direction: row;
  align-items: center;
  gap: 18px;
  padding: 14px 18px;
}
.ov-bar .ov-now { display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1; }
.ov-bar .ov-cover { width: 108px; height: 108px; border-radius: 12px; flex: none; }
.ov-bar .ov-copy strong { font-size: 28px; }
.ov-bar .ov-next { display: flex; gap: 16px; flex: 1.1; }
.ov-bar .ov-next li { min-width: 0; flex: 1; padding: 10px 12px; border-radius: 12px; background: var(--ov-card); }
.ov-bar .ov-next strong { font-size: 15px; }

.ov-ticker {
  flex-direction: row;
  align-items: center;
  gap: 14px;
  padding: 0 16px;
  position: relative;
}
.ov-ticker .ov-cover { width: 48px; height: 48px; border-radius: 8px; }
.ov-ticker .ov-copy { display: flex; align-items: baseline; gap: 12px; flex: 1; min-width: 0; }
.ov-ticker .ov-copy em { margin: 0; }
.ov-ticker .ov-copy strong { font-size: 22px; }
.ov-ticker .ov-copy span { font-size: 14px; }
.ov-ticker .ov-tick { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; border-radius: 0; }

.ov-scroll, .ov-flip {
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 0 10px 0 8px;
  position: relative;
}
.ov-scroll .ov-cover, .ov-flip .ov-cover { width: 40px; height: 40px; border-radius: 8px; flex: none; }
.ov-scroll .ov-count, .ov-flip .ov-count, .ov-scrollv .ov-count, .ov-flipv .ov-count { min-width: 48px; }
.ov-marquee {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  mask-image: linear-gradient(90deg, transparent, #000 14px, #000 calc(100% - 16px), transparent);
}
.ov-marquee.is-vert {
  mask-image: linear-gradient(180deg, transparent, #000 16px, #000 calc(100% - 16px), transparent);
}
.ov-marquee-track {
  display: inline-flex;
  align-items: center;
  width: max-content;
  will-change: transform;
  animation: ov-marquee-loop linear infinite;
}
.ov-marquee-track.is-vert {
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  animation-name: ov-marquee-loop-y;
}
.ov-marquee-track.is-once { animation-name: ov-marquee-once; animation-iteration-count: 1; animation-fill-mode: forwards; }
.ov-marquee-track.is-once.is-vert { animation-name: ov-marquee-once-y; }
.ov-marquee-seq {
  display: inline-flex;
  align-items: baseline;
  gap: 16px;
  flex: none;
  padding-right: 72px;
  white-space: nowrap;
}
.ov-marquee-seq.is-vert {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding-right: 0;
  padding-bottom: 18px;
  white-space: normal;
  width: 100%;
}
.ov-line {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  flex: none;
}
.ov-marquee-seq.is-vert .ov-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 10px;
  background: var(--ov-card);
}
.ov-line em,
.ov-line strong,
.ov-line span {
  display: inline;
  overflow: visible;
  white-space: nowrap;
  text-overflow: clip;
}
.ov-marquee-seq.is-vert .ov-line strong,
.ov-marquee-seq.is-vert .ov-line span { display: block; overflow: hidden; text-overflow: ellipsis; }
.ov-line em, .ov-flip-card em {
  color: var(--ov-accent);
  font-size: 12px;
  font-style: normal;
  letter-spacing: 0.12em;
  font-weight: 700;
}
.ov-line em.is-in, .ov-flip-card em.is-in { color: #7dffb3; }
.ov-shell.is-light .ov-line em.is-in,
.ov-shell.is-light .ov-flip-card em.is-in { color: #128a4a; }
.ov-line strong { font-size: 18px; font-weight: 700; }
.ov-line span { font-size: 13px; color: var(--ov-muted); }
.ov-scrollv .ov-line .ov-cover { width: 36px; height: 36px; border-radius: 8px; }
.ov-scroll .ov-tick, .ov-flip .ov-tick, .ov-scrollv .ov-tick, .ov-flipv .ov-tick {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  border-radius: 0;
}
.ov-scrollv, .ov-flipv {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 10px 10px 8px;
  position: relative;
}
.ov-scrollv .ov-count, .ov-flipv .ov-count { align-self: flex-start; }
.ov-flip-port {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.ov-flip-card {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 100%;
  animation: ov-flip-x 0.48s ease-out;
}
.ov-flipv .ov-flip-card { animation-name: ov-flip-y; }
.ov-flip-card .ov-copy em { margin: 0 0 2px; }
.ov-flip-card .ov-copy strong { font-size: 18px; }
.ov-flipv .ov-cover { width: 56px; height: 56px; border-radius: 10px; }
.ov-flipv .ov-flip-card .ov-copy strong { font-size: 16px; }
.ov-scroll .ov-closed,
.ov-scrollv .ov-closed,
.ov-flip .ov-closed,
.ov-flipv .ov-closed,
.ov-ticker .ov-closed {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 4;
  padding: 3px 8px;
  font-size: 11px;
  letter-spacing: 0.12em;
}
@keyframes ov-marquee-loop {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
@keyframes ov-marquee-loop-y {
  from { transform: translateY(0); }
  to { transform: translateY(-50%); }
}
@keyframes ov-marquee-once {
  from { transform: translateX(var(--ov-port, 520px)); }
  to { transform: translateX(-100%); }
}
@keyframes ov-marquee-once-y {
  from { transform: translateY(var(--ov-port, 240px)); }
  to { transform: translateY(-100%); }
}
@keyframes ov-flip-x {
  from { transform: translateX(42%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
@keyframes ov-flip-y {
  from { transform: translateY(70%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.ov-card { position: relative; padding: 0; }
.ov-art { width: 100%; height: 100%; }
.ov-shade {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  padding: 28px 24px 20px;
  background: linear-gradient(transparent, rgba(8, 10, 16, 0.92) 55%);
}
.ov-shade strong { font-size: 32px; white-space: normal; line-height: 1.2; margin: 4px 0 6px; }
.ov-shade .ov-meter { margin-top: 14px; }

.ov-list li.is-now { background: color-mix(in srgb, var(--ov-accent) 16%, transparent); border-radius: 10px; padding: 8px; border-bottom: 0; margin-bottom: 6px; }
.ov-queue .ov-pane { flex: 1; }
</style>
