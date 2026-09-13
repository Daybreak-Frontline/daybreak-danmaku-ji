<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Vue3Menus } from 'vue3-menus';
import { usePlayStore } from '../stores/play';
import type { Music } from '../utils/type';
import { ElMessage } from 'element-plus/es/components/message/index';
import { biliConnect, biliDisconnect } from '../utils/api/danmaku-qq';
import TipIcon from '../components/TipIcon.vue';
import OverlayPicker from '../components/OverlayPicker.vue';

type QueueListMode = 'scroll' | 'page';
const QUEUE_LIST_MODE_KEY = 'danmaku-player-list-mode';
const QUEUE_PAGE_SIZE = 10;

function readQueueListMode(): QueueListMode {
  try {
    return localStorage.getItem(QUEUE_LIST_MODE_KEY) === 'page' ? 'page' : 'scroll';
  } catch {
    return 'scroll';
  }
}

const play = usePlayStore();
const router = useRouter();
const selected = ref<Music | null>(null);
const listMode = ref<QueueListMode>(readQueueListMode());
const listPage = ref(1);
const queueListBox = ref<HTMLElement | null>(null);
const connectBusy = ref(false);
const queueTotalPages = computed(() => Math.max(1, Math.ceil(play.musicList.length / QUEUE_PAGE_SIZE)));
const visibleSongs = computed(() => {
  if (listMode.value !== 'page') return play.musicList;
  const start = (listPage.value - 1) * QUEUE_PAGE_SIZE;
  return play.musicList.slice(start, start + QUEUE_PAGE_SIZE);
});
const pagerPages = computed(() => {
  const total = queueTotalPages.value;
  const current = listPage.value;
  const pages: number[] = [];
  let start = Math.max(1, current - 2);
  let end = Math.min(total, start + 4);
  start = Math.max(1, end - 4);
  for (let n = start; n <= end; n += 1) pages.push(n);
  return pages;
});

function songIndex(index: number) {
  if (listMode.value !== 'page') return index + 1;
  return (listPage.value - 1) * QUEUE_PAGE_SIZE + index + 1;
}

function setListMode(mode: QueueListMode) {
  listMode.value = mode;
  try { localStorage.setItem(QUEUE_LIST_MODE_KEY, mode); } catch {}
  if (mode === 'page') jumpToCurrentPage();
}

function jumpToCurrentPage() {
  const idx = play.musicList.findIndex(song => song.id === play.music.id && song.type === play.music.type);
  listPage.value = idx >= 0 ? Math.floor(idx / QUEUE_PAGE_SIZE) + 1 : 1;
}

function goListPage(next: number) {
  listPage.value = Math.min(queueTotalPages.value, Math.max(1, next));
}

async function scrollCurrentIntoView() {
  if (listMode.value !== 'scroll') return;
  await nextTick();
  const row = queueListBox.value?.querySelector('.danmaku-song-row.is-current') as HTMLElement | null;
  row?.scrollIntoView({ block: 'nearest' });
}
function extractRoomId(input: string) {
  const text = String(input || '').trim();
  const live = text.match(/live\.bilibili\.com\/(\d+)/);
  if (live) return Number(live[1]);
  if (/^\d+$/.test(text)) return Number(text);
  return 0;
}

const configuredRoomId = computed(() => {
  return extractRoomId(play.danmakuBiliRoom) || Number(play.danmakuConnection?.roomId) || 0;
});
const roomConfigured = computed(() => configuredRoomId.value > 0);
const roomCapsule = computed(() => roomConfigured.value ? `房间 ${configuredRoomId.value}` : '');
const connectState = computed(() => play.danmakuConnection?.state || 'idle');
const connecting = computed(() => ['connecting', 'connecting_room', 'authenticating', 'reconnecting'].includes(connectState.value));
const connected = computed(() => connectState.value === 'connected');
const connectButtonText = computed(() => {
  if (!roomConfigured.value) return '未配置，现在去配置';
  if (connecting.value) return '连接中';
  if (connected.value) return '断开弹幕';
  return '连接弹幕';
});

async function onConnectDanmaku() {
  if (!roomConfigured.value) {
    router.push('/setting/accounts');
    return;
  }
  connectBusy.value = true;
  try {
    if (connected.value) {
      await biliDisconnect();
      ElMessage.success('已断开弹幕');
      return;
    }
    const result = await biliConnect(play.danmakuBiliRoom || String(configuredRoomId.value));
    if (result.connection) play.danmakuConnection = result.connection;
    if (!result.ok) ElMessage.error(result.error || '连接失败');
    else ElMessage.success('已连接弹幕');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '连接失败');
  } finally {
    connectBusy.value = false;
  }
}

function openPlayerDetail() {
  if (!play.music.id && play.musicList[0]) play.setCurrentMusic(play.musicList[0]);
  play.playDetailShow = true;
}

function selectSong(song: Music) {
  selected.value = song;
  ElMessage.success(`已选中：${song.name}`);
}

function playSong(song: Music) {
  play.play(song);
}

const menuOpened = ref(false);
const menuEvent = ref({} as MouseEvent);
let menuSong: Music | null = null;
const songMenus = [
  { icon: '播', label: '播放', click: () => { if (menuSong) play.play(menuSong); } },
  { icon: '待', label: '下一首播放', click: () => { if (menuSong) play.setNextPlay(menuSong); } },
  { icon: '删', label: '从列表中删除', click: () => { if (menuSong) play.remove(menuSong); } }
];

function openSongMenu(song: Music, event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  menuSong = song;
  selected.value = song;
  menuOpened.value = false;
  nextTick(() => {
    menuOpened.value = true;
    menuEvent.value = event;
  });
}

watch(
  () => play.musicList.length,
  () => {
    if (listPage.value > queueTotalPages.value) listPage.value = queueTotalPages.value;
  }
);

watch(
  () => [play.music.id, play.music.type, listMode.value] as const,
  () => {
    if (listMode.value === 'page') jumpToCurrentPage();
    else scrollCurrentIntoView();
  }
);

</script>

<template>
  <div class="danmaku-player-page">
    <section class="danmaku-player-hero">
      <div class="danmaku-player-copy">
        <div class="danmaku-kicker">弹幕点歌姬</div>
        <h1>播放</h1>
        <p>观众点歌进入下方列表。开播前在本页打开捕获窗给 OBS 用。</p>
        <div class="danmaku-actions">
          <el-button type="primary" round @click="openPlayerDetail">
            <span class="music-icon">播</span>打开全屏播放器
          </el-button>
          <el-button round @click="play.currentListShow = true">
            <span class="music-icon">表</span>播放列表·{{ play.musicList.length }}
          </el-button>
          <el-button
            round
            :type="roomConfigured && !connected ? 'primary' : undefined"
            :loading="connectBusy || connecting"
            @click="onConnectDanmaku">
            {{ connectButtonText }}
          </el-button>
          <span v-if="roomConfigured" class="danmaku-room-pill">{{ roomCapsule }}</span>
        </div>
      </div>
    </section>

    <section class="danmaku-queue-block">
      <div class="danmaku-section-head">
        <div>
          <h2>观众点歌</h2>
          <span>当前播放列表 · {{ play.musicList.length }} 首</span>
        </div>
        <div class="danmaku-queue-tools">
          <div class="danmaku-list-mode" role="tablist" aria-label="列表显示方式">
            <button type="button" :class="{ 'is-active': listMode === 'scroll' }" @click="setListMode('scroll')">滚动</button>
            <button type="button" :class="{ 'is-active': listMode === 'page' }" @click="setListMode('page')">翻页</button>
          </div>
          <el-button text @click="play.currentListShow = true">查看全部</el-button>
        </div>
      </div>
      <div
        ref="queueListBox"
        class="danmaku-song-list"
        :class="{ 'is-scroll': listMode === 'scroll', 'is-page': listMode === 'page' }">
        <div v-if="!play.musicList.length" class="danmaku-song-empty">还没有歌曲。观众点歌后会出现在这里。</div>
        <div
          v-for="(song, index) in visibleSongs"
          :key="song.type + song.id + '-' + songIndex(index)"
          class="danmaku-song-row"
          :class="{
            'is-current': song.id === play.music.id && song.type === play.music.type,
            'is-selected': selected && song.id === selected.id && song.type === selected.type
          }"
          @click="selectSong(song)"
          @dblclick="playSong(song)"
          @contextmenu="openSongMenu(song, $event)">
          <span class="danmaku-song-index">{{ String(songIndex(index)).padStart(2, '0') }}</span>
          <img :src="song.image" :alt="song.name" @error="($event.target as HTMLImageElement).style.visibility='hidden'" />
          <div class="danmaku-song-info">
            <strong>{{ song.name }}</strong>
            <span>{{ song.singer }} · {{ song.album }}</span>
          </div>
          <span class="danmaku-song-requester">{{ song.requestedBy || song.requester || '本地点歌' }}</span>
          <span class="danmaku-song-duration">{{ song.duration }}</span>
          <span class="music-icon danmaku-song-more" title="更多" @click="openSongMenu(song, $event)">多</span>
        </div>
      </div>
      <div v-if="listMode === 'page' && play.musicList.length" class="danmaku-pager">
        <button type="button" :disabled="listPage <= 1" @click="goListPage(listPage - 1)">上一页</button>
        <button
          v-for="n in pagerPages"
          :key="n"
          type="button"
          :class="{ 'is-active': n === listPage }"
          @click="goListPage(n)">{{ n }}</button>
        <button type="button" :disabled="listPage >= queueTotalPages" @click="goListPage(listPage + 1)">下一页</button>
        <span>第 {{ listPage }} / {{ queueTotalPages }} 页 · 每页 10 条</span>
      </div>
      <Vue3Menus :menus="songMenus" :event="menuEvent" :open="menuOpened">
        <template #icon="{ menu }"><span class="music-icon">{{ menu.icon }}</span></template>
        <template #label="{ menu }">{{ menu.label }}</template>
      </Vue3Menus>
      <div class="danmaku-migration-note">
        <TipIcon />
        观众发「点歌 歌名」入队。指定平台如「点歌 QQ 海阔天空」。按 ID 需写「点歌 网易云id …」。
      </div>
    </section>

    <section class="danmaku-overlay-panel">
      <OverlayPicker>
        <template #heading>
          <h2>直播捕获窗</h2>
          <span>打开独立窗口，用于直播捕获</span>
        </template>
      </OverlayPicker>
    </section>
  </div>
</template>

<style lang="less" scoped>
.danmaku-player-page { max-width: 1120px; margin: 0 auto; padding: 34px 38px 120px; }
.danmaku-player-hero { margin-bottom: 28px; }
.danmaku-player-copy { padding: 8px 0 4px; }
.danmaku-kicker { color: var(--music-primary-color); font-size: 13px; letter-spacing: 0.12em; margin-bottom: 12px; }
h1 { font-size: clamp(32px, 5vw, 54px); line-height: 1.15; margin: 0 0 15px; }
.danmaku-player-copy p { max-width: 520px; opacity: .68; font-size: 16px; margin-bottom: 25px; }
.danmaku-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.danmaku-room-pill {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 12px;
  border-radius: 99px;
  border: 1px solid color-mix(in srgb, var(--music-primary-color) 35%, transparent);
  background: transparent;
  color: var(--el-text-color-regular);
  font-size: 13px;
}
.danmaku-queue-block { min-width: 0; display: flex; flex-direction: column; margin-bottom: 16px; }
.danmaku-section-head span { color: var(--el-text-color-placeholder); font-size: 13px; }
.danmaku-overlay-panel { min-width: 0; margin: 0 0 42px; padding: 18px 18px 16px; border-radius: 14px; background: var(--music-sub-background); border: 1px solid var(--music-side-divider-color); }
.danmaku-section-head { display: flex; align-items: end; justify-content: space-between; margin-bottom: 12px; gap: 12px; }
.danmaku-queue-tools { display: flex; align-items: center; gap: 10px; flex: none; }
.danmaku-list-mode { display: inline-flex; padding: 2px; border-radius: 99px; border: 1px solid var(--music-side-divider-color); background: var(--music-button-background-hover, color-mix(in srgb, #fff 5%, transparent)); }
.danmaku-list-mode button { height: 28px; padding: 0 12px; border: 0; border-radius: 99px; background: transparent; color: var(--el-text-color-regular); font-size: 12px; cursor: pointer; }
.danmaku-list-mode button.is-active { background: var(--music-primary-color); color: #fff; }
h2 { font-size: 22px; margin: 0 0 3px; }
.danmaku-song-list { flex: 1; border: 1px solid var(--music-side-divider-color); border-radius: 12px; background: var(--music-button-background-hover, color-mix(in srgb, #fff 4%, transparent)); }
.danmaku-song-list.is-scroll {
  max-height: min(52vh, 560px);
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
}
.danmaku-song-list.is-scroll::-webkit-scrollbar { width: 8px; }
.danmaku-song-list.is-scroll::-webkit-scrollbar-track { background: transparent; }
.danmaku-song-list.is-scroll::-webkit-scrollbar-thumb { background: #b7bec8; border-radius: 99px; }
.danmaku-song-empty { padding: 28px 16px; text-align: center; color: var(--el-text-color-placeholder); font-size: 13px; }
.danmaku-song-row { min-height: 70px; display: flex; align-items: center; gap: 15px; padding: 9px 14px; border-bottom: 1px solid var(--music-side-divider-color); cursor: pointer; transition: background .2s; }
.danmaku-song-row:last-child { border-bottom: 0; }
.danmaku-song-row:hover { background: var(--music-side-menu-color-hover); }
.danmaku-song-row.is-current { background: color-mix(in srgb, var(--music-primary-color) 12%, transparent); }
.danmaku-song-row.is-selected:not(.is-current) { background: color-mix(in srgb, var(--music-primary-color) 6%, transparent); }
.danmaku-song-index { width: 28px; text-align: center; color: var(--el-text-color-placeholder); font-size: 13px; }
.danmaku-song-row img { width: 50px; height: 50px; object-fit: cover; border-radius: var(--music-border-radius); background: var(--music-sub-background); }
.danmaku-song-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.danmaku-song-info strong, .danmaku-song-info span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.danmaku-song-info strong { font-size: 15px; font-weight: 500; }
.danmaku-song-info span, .danmaku-song-requester, .danmaku-song-duration { color: var(--el-text-color-placeholder); font-size: 13px; }
.danmaku-song-requester { width: 130px; }
.danmaku-song-duration { width: 48px; text-align: right; }
.danmaku-song-more { opacity: 0; color: var(--el-text-color-placeholder); cursor: pointer; }
.danmaku-song-row:hover .danmaku-song-more { opacity: 1; }
.danmaku-song-more:hover { color: var(--music-primary-color); }
.danmaku-pager { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.danmaku-pager button { height: 30px; min-width: 30px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--music-side-divider-color); background: var(--music-button-background-hover, color-mix(in srgb, #fff 6%, transparent)); color: inherit; font-size: 12px; cursor: pointer; }
.danmaku-pager button.is-active { border-color: var(--music-primary-color); background: color-mix(in srgb, var(--music-primary-color) 16%, transparent); color: var(--music-primary-color); }
.danmaku-pager button:disabled { opacity: .45; cursor: default; }
.danmaku-pager span { margin-left: 6px; color: var(--el-text-color-placeholder); font-size: 12px; }
.danmaku-migration-note { margin-top: 14px; padding: 13px 16px; border-radius: 8px; color: var(--el-text-color-placeholder); background: var(--music-sub-background); font-size: 12px; display: flex; align-items: flex-start; gap: 8px; }
@media (max-width: 760px) { .danmaku-player-page { padding: 20px 14px 100px; } .danmaku-song-requester { display: none; } .danmaku-section-head { flex-direction: column; align-items: stretch; } .danmaku-queue-tools { justify-content: space-between; } }
</style>
