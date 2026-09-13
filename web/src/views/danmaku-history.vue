<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus/es/components/message/index';
import { usePlayStore } from '../stores/play';
import { danmakuHistoryClear, danmakuHistoryList } from '../utils/api/danmaku-qq';
import type { Music } from '../utils/type';
import TipIcon from '../components/TipIcon.vue';

const play = usePlayStore();
const remoteHistory = ref<Music[] | null>(null);
const history = computed(() => remoteHistory.value ?? play.musicHistory);

function formatPlayedAt(song: Music) {
  const ts = Number(song.playedAt);
  if (!ts) return song.album || '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadHistory() {
  try {
    remoteHistory.value = await danmakuHistoryList();
  } catch {
    remoteHistory.value = null;
  }
}

async function clearHistory() {
  try {
    await danmakuHistoryClear();
    play.addHistory(play.musicHistory, true);
    remoteHistory.value = [];
    ElMessage.success('播放历史已清空');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '清空历史失败');
  }
}

function addToQueue(song: Music) {
  play.add([song]);
  play.showCurrentListPopover();
}

function addAsNext(song: Music) {
  play.setNextPlay(song);
}

onMounted(() => { loadHistory(); });
</script>

<template>
  <div class="danmaku-history-page">
    <div class="page-heading">
      <div>
        <div class="eyebrow">LISTENING HISTORY</div>
        <h1>播放历史</h1>
        <p>本机保存的最近播放，可按点歌人查看。</p>
      </div>
      <el-button v-if="history.length" plain @click="clearHistory">清空历史</el-button>
    </div>
    <div v-if="history.length" class="history-list">
      <div v-for="(song, index) in history" :key="(song.historyId || '') + song.type + song.id + index" class="history-row" @dblclick="play.play(song)">
        <span class="index">{{ String(index + 1).padStart(2, '0') }}</span>
        <img :src="song.image" :alt="song.name" />
        <div class="info"><strong>{{ song.name }}</strong><span>{{ song.singer }} · {{ formatPlayedAt(song) }}</span></div>
        <span class="requester">{{ song.requestedBy || song.requester || '本地点歌' }}</span>
        <span class="duration">{{ song.duration }}</span>
        <div class="history-actions" @click.stop>
          <button type="button" class="history-action" title="添加到队列底部" @click="addToQueue(song)">队列</button>
          <button type="button" class="history-action" title="添加到下一首" @click="addAsNext(song)">下一首</button>
          <span class="music-icon action" title="播放" @click="play.play(song)">播</span>
        </div>
      </div>
    </div>
    <el-empty v-else description="还没有播放记录" />
    <div class="history-note"><TipIcon />双击即可播放。</div>
  </div>
</template>

<style lang="less" scoped>
.danmaku-history-page { max-width: 1000px; margin: 0 auto; padding: 42px 38px 120px; }
.page-heading { display: flex; justify-content: space-between; align-items: end; gap: 20px; margin-bottom: 35px; }
.eyebrow { color: var(--music-primary-color); font-size: 12px; letter-spacing: .16em; margin-bottom: 8px; }
h1 { font-size: 34px; margin: 0 0 7px; } p { color: var(--el-text-color-placeholder); margin: 0; }
.history-list { border-top: 1px solid var(--music-side-divider-color); }
.history-row { min-height: 72px; display: flex; align-items: center; gap: 15px; padding: 9px 14px; border-bottom: 1px solid var(--music-side-divider-color); border-radius: 8px; cursor: pointer; }
.history-row:hover { background: var(--music-side-menu-color-hover); }
.index, .duration { width: 34px; text-align: center; color: var(--el-text-color-placeholder); font-size: 13px; }
.history-row img { width: 50px; height: 50px; object-fit: cover; border-radius: var(--music-border-radius); }
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; } .info strong, .info span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .info span { color: var(--el-text-color-placeholder); font-size: 13px; }
.requester { width: 110px; color: var(--el-text-color-placeholder); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.action { color: var(--music-primary-color); opacity: .8; cursor: pointer; }
.history-actions { display: flex; align-items: center; gap: 6px; flex: none; }
.history-action { height: 26px; padding: 0 8px; border: 1px solid var(--music-side-divider-color); border-radius: 6px; background: transparent; color: var(--el-text-color-regular); font-size: 12px; cursor: pointer; }
.history-action:hover { color: var(--music-primary-color); border-color: var(--music-primary-color); }
.history-note { margin-top: 26px; padding: 13px 16px; border-radius: 8px; color: var(--el-text-color-placeholder); background: var(--music-sub-background); font-size: 12px; display: flex; align-items: flex-start; gap: 8px; }
@media (max-width: 640px) { .danmaku-history-page { padding: 24px 14px 100px; } .page-heading { align-items: start; flex-direction: column; } .requester, .duration { display: none; } }
</style>
