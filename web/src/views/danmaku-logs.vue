<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus/es/components/message/index';
import { usePlayStore } from '../stores/play';
import {
  danmakuLogs,
  danmakuLogsSaveSettings,
  type DanmakuLogFile,
  type DanmakuLogItem
} from '../utils/api/danmaku-qq';
import TipIcon from '../components/TipIcon.vue';

const play = usePlayStore();
const logBox = ref<HTMLElement | null>(null);
const pinLatest = ref(true);
const loading = ref(false);
const saving = ref(false);
const selectedDate = ref('');
const archive = ref<DanmakuLogItem[]>([]);
const files = ref<DanmakuLogFile[]>([]);
const retentionDays = ref(14);
const maxMb = ref(32);
const usedBytes = ref(0);

function todayStamp(at = Date.now()) {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatLogTime(at?: number) {
  if (!at) return '--:--:--';
  return new Date(at).toLocaleTimeString('zh-CN', { hour12: false });
}

function logKey(item: DanmakuLogItem, index: number) {
  return `${item.at || 0}-${item.level || 'info'}-${item.message}-${index}`;
}

const isToday = computed(() => selectedDate.value === todayStamp());
const displayLogs = computed(() => {
  if (!isToday.value) return archive.value;
  const seen = new Set(archive.value.map(item => `${item.at}|${item.message}`));
  const extra = play.danmakuLogs.filter(item => !seen.has(`${item.at}|${item.message}`));
  return archive.value.concat(extra);
});

async function loadDate(date = selectedDate.value || todayStamp()) {
  loading.value = true;
  try {
    const data = await danmakuLogs(date);
    selectedDate.value = data.date || date;
    archive.value = data.items || [];
    files.value = data.files || [];
    retentionDays.value = data.retentionDays || 14;
    maxMb.value = data.maxMb || 32;
    usedBytes.value = data.usedBytes || 0;
    play.replaceDanmakuLogs(isToday.value ? data.items || [] : play.danmakuLogs);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '读取日志失败');
  } finally {
    loading.value = false;
    scrollToLatest();
  }
}

async function saveLimits() {
  saving.value = true;
  try {
    const data = await danmakuLogsSaveSettings({
      retentionDays: retentionDays.value,
      maxMb: maxMb.value
    });
    files.value = data.files || [];
    usedBytes.value = data.usedBytes || 0;
    retentionDays.value = data.retentionDays;
    maxMb.value = data.maxMb;
    ElMessage.success('日志保留规则已保存');
    if (selectedDate.value && !files.value.some(file => file.date === selectedDate.value)) {
      await loadDate(todayStamp());
    } else {
      await loadDate(selectedDate.value);
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function scrollToLatest() {
  if (!pinLatest.value) return;
  await nextTick();
  const box = logBox.value;
  if (box) box.scrollTop = box.scrollHeight;
}

watch(
  () => [play.danmakuLogs.length, play.danmakuLogs[play.danmakuLogs.length - 1]?.at, play.danmakuLogs[play.danmakuLogs.length - 1]?.message],
  async () => {
    if (!isToday.value) return;
    scrollToLatest();
    const today = todayStamp();
    if (!files.value.some(file => file.date === today)) {
      try {
        const data = await danmakuLogs(today);
        files.value = data.files || [];
        usedBytes.value = data.usedBytes || 0;
      } catch {}
    }
  }
);
watch(pinLatest, checked => { if (checked) scrollToLatest(); });

onMounted(() => { loadDate(todayStamp()); });
</script>

<template>
  <div class="danmaku-logs-page">
    <div class="page-heading">
      <div>
        <div class="eyebrow">SYSTEM LOGS</div>
        <h1>日志信息</h1>
        <p>本机按日期写入全部运行记录。超过保留天数或总大小时，从最旧的一天开始删。</p>
      </div>
    </div>

    <section class="logs-card">
      <div class="logs-limits">
        <label>
          <span>最大记录周期</span>
          <el-input-number v-model="retentionDays" :min="1" :max="365" :step="1" controls-position="right" />
          <em>天</em>
        </label>
        <label>
          <span>最大记录大小</span>
          <el-input-number v-model="maxMb" :min="1" :max="512" :step="1" controls-position="right" />
          <em>MB</em>
        </label>
        <el-button type="primary" :loading="saving" @click="saveLimits">保存规则</el-button>
        <span class="logs-usage">已用 {{ formatSize(usedBytes) }} / {{ maxMb }} MB</span>
      </div>
      <div class="logs-dates">
        <button
          v-for="file in files"
          :key="file.date"
          type="button"
          :class="{ 'is-active': file.date === selectedDate }"
          @click="loadDate(file.date)">
          {{ file.date }}
          <small>{{ formatSize(file.bytes) }}</small>
        </button>
        <span v-if="!files.length" class="logs-empty-dates">还没有日志文件</span>
      </div>
    </section>

    <section class="logs-card logs-board">
      <div class="logs-board-head">
        <strong>{{ selectedDate || '今天' }}</strong>
        <label class="logs-pin">
          <input v-model="pinLatest" type="checkbox" />
          总显示最新日志
        </label>
      </div>
      <div ref="logBox" class="logs-list" :class="{ 'is-loading': loading }">
        <div v-if="!displayLogs.length" class="logs-empty">这一天还没有记录。</div>
        <div
          v-for="(item, index) in displayLogs"
          :key="logKey(item, index)"
          class="logs-row"
          :class="'is-' + (item.level || 'info')">
          <time>{{ formatLogTime(item.at) }}</time>
          <span>{{ item.message }}</span>
        </div>
      </div>
    </section>

    <div class="logs-note">
      <TipIcon />
      连接、点歌、礼物、播放失败都会写进当天文件。改规则后立刻按从旧到新清理。
    </div>
  </div>
</template>

<style lang="less" scoped>
.danmaku-logs-page { max-width: 1000px; margin: 0 auto; padding: 42px 38px 120px; }
.page-heading { margin-bottom: 28px; }
.eyebrow { color: var(--music-primary-color); font-size: 12px; letter-spacing: .16em; margin-bottom: 8px; }
h1 { font-size: 34px; margin: 0 0 7px; }
p { color: var(--el-text-color-placeholder); margin: 0; max-width: 560px; }
.logs-card { padding: 18px 18px 16px; border-radius: 14px; background: var(--music-sub-background); border: 1px solid var(--music-side-divider-color); margin-bottom: 16px; }
.logs-limits { display: flex; flex-wrap: wrap; align-items: center; gap: 14px 18px; }
.logs-limits label { display: inline-flex; align-items: center; gap: 8px; color: var(--el-text-color-regular); font-size: 13px; }
.logs-limits em { font-style: normal; color: var(--el-text-color-placeholder); font-size: 12px; }
.logs-limits :deep(.el-input-number) { width: 108px; }
.logs-usage { color: var(--el-text-color-placeholder); font-size: 12px; }
.logs-dates { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.logs-dates button { height: 32px; padding: 0 10px; border-radius: 99px; border: 1px solid var(--music-side-divider-color); background: transparent; color: inherit; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.logs-dates button small { color: var(--el-text-color-placeholder); }
.logs-dates button.is-active { border-color: var(--music-primary-color); background: color-mix(in srgb, var(--music-primary-color) 16%, transparent); color: var(--music-primary-color); }
.logs-empty-dates { color: var(--el-text-color-placeholder); font-size: 12px; }
.logs-board-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.logs-pin { display: flex; align-items: center; gap: 6px; color: var(--el-text-color-regular); font-size: 12px; cursor: pointer; user-select: none; }
.logs-pin input { margin: 0; }
.logs-list {
  min-height: 360px;
  max-height: min(62vh, 640px);
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 8px 10px;
  border: 1px solid var(--music-side-divider-color);
  border-radius: 10px;
  background: var(--music-button-background-hover, color-mix(in srgb, #fff 5%, transparent));
}
.logs-list.is-loading { opacity: .7; }
.logs-empty { padding: 18px 6px; color: var(--el-text-color-placeholder); font-size: 13px; }
.logs-row { display: flex; gap: 10px; padding: 6px 2px; font-size: 13px; line-height: 1.5; }
.logs-row time { width: 72px; flex: none; color: var(--el-text-color-placeholder); font-variant-numeric: tabular-nums; }
.logs-row span { min-width: 0; overflow-wrap: anywhere; }
.logs-row.is-error span { color: #e36b7a; }
.logs-note { margin-top: 10px; padding: 13px 16px; border-radius: 8px; color: var(--el-text-color-placeholder); background: var(--music-sub-background); font-size: 12px; display: flex; align-items: flex-start; gap: 8px; }
@media (max-width: 760px) { .danmaku-logs-page { padding: 24px 14px 100px; } }
</style>
