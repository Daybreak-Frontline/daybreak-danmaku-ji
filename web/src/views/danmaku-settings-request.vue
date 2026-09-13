<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus/es/components/message/index';
import { ElMessageBox } from 'element-plus/es/components/message-box/index';
import { usePlayStore } from '../stores/play';
import { useSettingStore } from '../stores/setting';
import type { MusicQuality } from '../utils/type';
import {
  biliAccountStatus,
  biliGifts,
  danmakuConfig,
  danmakuConfigSave,
  danmakuPlayerMode,
  type DanmakuGift
} from '../utils/api/danmaku-qq';
import { getOrCreateLocalAudio } from '../utils/http';
import { listAudioOutputs, sanitizeOutputId, type AudioOutput } from '../utils/audio-devices';
import TipIcon from '../components/TipIcon.vue';

const route = useRoute();
const router = useRouter();
const play = usePlayStore();
const setting = useSettingStore();
const tab = computed(() => String(route.meta.settingTab || 'order'));
const lyricFonts = ['微软雅黑', '黑体', '宋体', '楷体', '等线', 'Arial'];
const lyricColors = [
  { color: '#ffb0b0', effect: '#cb7474', name: '红' },
  { color: '#e0c3ff', effect: '#8e76c2', name: '晖' },
  { color: '#fcbede', effect: '#be80a0', name: '粉' },
  { color: '#acd3e5', effect: '#5495b4', name: '蓝' },
  { color: '#dcf6c3', effect: '#67905c', name: '绿' },
  { color: '#ded8f8', effect: '#998dc9', name: '紫' },
  { color: '#fadda7', effect: '#d4a056', name: '黄' },
  { color: '#ffffff', effect: '#8b8b8b', name: '白' }
];
function applyLyricColor(item: { color: string; effect: string }) {
  setting.pageValue.lyric.fontColor = item.color;
  setting.pageValue.lyric.effectColor = item.effect;
  setting.setLyricOptions();
}
const biliLogin = ref(false);
const mode = ref('loop');
function savePlayQuality(value: string) {
  setting.setPlayQuality(value as MusicQuality);
}
const userCooldown = ref(30);
const globalCooldown = ref(5);
const queueLimit = ref(30);
const SOURCE_META = [
  { id: 'qq', label: 'QQ音乐', hint: '登录后按账号权限取 VIP 地址' },
  { id: 'cloud', label: '网易云音乐', hint: '登录后按账号权限取 VIP 地址' },
  { id: 'migu', label: '咪咕音乐', hint: '登录后按账号权限取 VIP 地址' },
  { id: 'bili', label: '哔哩哔哩', hint: '可用 BV 点播；开启后也能搜稿件' }
];
const sourceList = ref(SOURCE_META.map(item => ({ ...item, enabled: item.id === 'qq' })));
let sourceDragIndex = -1;
const audioOutputs = ref<AudioOutput[]>([]);
const audioOutputId = ref('');
const virtualOutputId = ref('');
const audioHint = ref('正在读取音频输出设备…');
const giftList = ref<DanmakuGift[]>([]);
const giftQuery = ref('');
const giftLoading = ref(false);
const giftError = ref('');
const giftFetchedAt = ref(0);
const giftMissing = ref(false);
const giftSyncLabel = computed(() => {
  if (!giftFetchedAt.value) return '尚未同步 B站礼物';
  const ago = Math.max(0, Math.round((Date.now() - giftFetchedAt.value) / 60000));
  if (ago < 1) return '刚刚已从 B站同步';
  return `${ago} 分钟前已从 B站同步`;
});
let giftRefreshTimer: number | null = null;
const giftSkipQuery = ref('');
const requestGiftOpen = ref(false);
const skipGiftOpen = ref(false);
function filterGiftList(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return giftList.value;
  return giftList.value.filter(item => item.name.toLowerCase().includes(q) || String(item.id).includes(q));
}
const requestGifts = computed(() => filterGiftList(giftQuery.value));
const skipGifts = computed(() => filterGiftList(giftSkipQuery.value));
function giftPriceText(item: { batteries?: number; coinType?: string; price?: number }) {
  if (Number(item.batteries) > 0) return `${item.batteries} 电池`;
  if (String(item.coinType || '') === 'silver') return '银瓜子';
  return '免费';
}
async function loadGifts() {
  if (!biliLogin.value) {
    giftError.value = '请先到「账号与直播」扫码登录 B站';
    giftList.value = [];
    return;
  }
  giftLoading.value = true;
  giftError.value = '';
  try {
    const result = await biliGifts();
    giftList.value = result.list || [];
    giftFetchedAt.value = Number(result.fetchedAt || Date.now());
    giftMissing.value = Boolean(result.missing);
    if (result.selected) play.danmakuGift = result.selected;
    if (result.skipSelected) play.danmakuGiftSkipGift = result.skipSelected;
    if (typeof result.enabled === 'boolean') play.danmakuGiftRequest = result.enabled;
    if (typeof result.skipEnabled === 'boolean') play.danmakuGiftSkip = result.skipEnabled;
    if (!giftList.value.length) giftError.value = '未获取到礼物，请先连接直播间后再刷新';
    else if (giftMissing.value) giftError.value = '当前指定礼物未出现在最新列表，请重新点选，避免和 B站改名后的礼物对不上';
  } catch (error) {
    giftError.value = error instanceof Error ? error.message : '礼物列表获取失败';
  } finally {
    giftLoading.value = false;
  }
}
async function saveGiftPatch(patch: Record<string, unknown>, success = '') {
  try {
    await danmakuConfigSave(patch);
    if (success) ElMessage.success(success);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '礼物设置保存失败');
    throw error;
  }
}
async function selectGift(item: DanmakuGift, target: 'request' | 'skip') {
  const next = {
    giftId: item.id,
    giftName: item.name,
    giftIcon: item.icon,
    giftPrice: item.price,
    coinType: item.coinType,
    batteries: item.batteries
  };
  if (target === 'skip') {
    play.danmakuGiftSkipGift = next;
    skipGiftOpen.value = false;
    await saveGiftPatch({ giftSkipGift: next }, `切歌礼物已指定「${item.name}」`);
    return;
  }
  play.danmakuGift = next;
  requestGiftOpen.value = false;
  await saveGiftPatch({ giftRequest: next }, `点歌礼物已指定「${item.name}」`);
}
async function setRequestQualifyMode(mode: 'specific' | 'threshold') {
  play.danmakuGiftRequestQualifyMode = mode;
  try { await saveGiftPatch({ giftRequestQualifyMode: mode }); }
  catch { play.danmakuGiftRequestQualifyMode = mode === 'threshold' ? 'specific' : 'threshold'; }
}
async function setSkipQualifyMode(mode: 'specific' | 'threshold') {
  play.danmakuGiftSkipQualifyMode = mode;
  try { await saveGiftPatch({ giftSkipQualifyMode: mode }); }
  catch { play.danmakuGiftSkipQualifyMode = mode === 'threshold' ? 'specific' : 'threshold'; }
}
async function saveRequestThreshold() {
  await saveGiftPatch({ giftRequestThreshold: play.danmakuGiftRequestThreshold });
}
async function saveSkipThreshold() {
  await saveGiftPatch({ giftSkipThreshold: play.danmakuGiftSkipThreshold });
}
async function setRequestCountMode(mode: 'once' | 'accumulate') {
  play.danmakuGiftRequestCountMode = mode;
  try { await saveGiftPatch({ giftRequestCountMode: mode }); }
  catch { play.danmakuGiftRequestCountMode = mode === 'accumulate' ? 'once' : 'accumulate'; }
}
async function setSkipAction(mode: 'instant' | 'credit') {
  play.danmakuGiftSkipAction = mode;
  try { await saveGiftPatch({ giftSkipAction: mode }); }
  catch { play.danmakuGiftSkipAction = mode === 'credit' ? 'instant' : 'credit'; }
}
async function saveSkipExpire() {
  await saveGiftPatch({ giftSkipExpireSec: play.danmakuGiftSkipExpireSec });
}
async function toggleGiftSetting(value: string | number | boolean) {
  const next = Boolean(value);
  play.danmakuGiftRequest = next;
  try {
    await danmakuConfigSave({ giftRequestEnabled: next });
    if (next && play.danmakuGiftRequestQualifyMode !== 'threshold' && !play.danmakuGift.giftName) {
      ElMessage.warning('请在下方选择指定礼物，或改为电池阈值');
    }
    if (next && play.danmakuGiftRequestQualifyMode === 'threshold' && play.danmakuGiftRequestThreshold <= 0) {
      ElMessage.warning('请设定电池阈值');
    }
  } catch {
    play.danmakuGiftRequest = !next;
  }
}
async function toggleSkipSetting(value: string | number | boolean) {
  const next = Boolean(value);
  play.danmakuGiftSkip = next;
  try {
    await danmakuConfigSave({ giftSkipEnabled: next });
    if (next && play.danmakuGiftSkipQualifyMode !== 'threshold' && !play.danmakuGiftSkipGift.giftName) {
      ElMessage.warning('请在下方选择切歌礼物，或改为电池阈值');
    }
    if (next && play.danmakuGiftSkipQualifyMode === 'threshold' && play.danmakuGiftSkipThreshold <= 0) {
      ElMessage.warning('请设定切歌电池阈值');
    }
  } catch {
    play.danmakuGiftSkip = !next;
  }
}
const blacklistDraft = ref('');
async function toggleBlacklistSetting(value: string | number | boolean) {
  const next = Boolean(value);
  play.danmakuSongBlacklist = next;
  try {
    await danmakuConfigSave({ songBlacklistEnabled: next });
    if (next && !play.danmakuSongBlacklistItems.length) ElMessage.warning('请在下方添加黑名单规则');
  } catch {
    play.danmakuSongBlacklist = !next;
  }
}
function isSingleBlacklistChar(value: string) {
  return [...value.trim()].length === 1;
}
async function persistBlacklist(next: string[]) {
  const prev = [...play.danmakuSongBlacklistItems];
  play.danmakuSongBlacklistItems = next;
  try {
    await danmakuConfigSave({ songBlacklist: next });
  } catch (error) {
    play.danmakuSongBlacklistItems = prev;
    ElMessage.error(error instanceof Error ? error.message : '黑名单保存失败');
    throw error;
  }
}
async function addBlacklistRule() {
  const source = blacklistDraft.value.trim();
  if (!source) {
    ElMessage.warning('请输入要拦截的歌名规则');
    return;
  }
  if (play.danmakuSongBlacklistItems.includes(source)) {
    ElMessage.warning('这条规则已经在黑名单里');
    return;
  }
  if (isSingleBlacklistChar(source)) {
    try {
      await ElMessageBox.confirm('你只输入了一个字，确认添加到黑名单吗？', '添加黑名单', {
        type: 'warning',
        confirmButtonText: '确认添加',
        cancelButtonText: '取消'
      });
    } catch {
      return;
    }
  }
  await persistBlacklist([...play.danmakuSongBlacklistItems, source]);
  blacklistDraft.value = '';
  ElMessage.success(`已添加规则「${source}」`);
}
async function removeBlacklistRule(source: string) {
  await persistBlacklist(play.danmakuSongBlacklistItems.filter(item => item !== source));
}
let deviceChangeHandler: (() => void) | null = null;
async function saveSources() {
  await nextTick();
  let enabledSources = sourceList.value.filter(item => item.enabled).map(item => item.id);
  if (!enabledSources.length) {
    const fallback = sourceList.value.find(item => item.id === 'qq') || sourceList.value[0];
    if (fallback) fallback.enabled = true;
    enabledSources = sourceList.value.filter(item => item.enabled).map(item => item.id);
    ElMessage.warning('至少需要开启一个音源，已保留 QQ音乐');
  }
  try {
    await danmakuConfigSave({ enabledSources });
    ElMessage.success('音源已保存');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '音源保存失败');
  }
}
function onSourceDragStart(index: number) { sourceDragIndex = index; }
function onSourceDrop(index: number) {
  if (sourceDragIndex < 0 || sourceDragIndex === index) { sourceDragIndex = -1; return; }
  const next = [...sourceList.value];
  const [moved] = next.splice(sourceDragIndex, 1);
  next.splice(index, 0, moved);
  sourceList.value = next;
  sourceDragIndex = -1;
  saveSources();
}
function buildSourceList(enabledIds: string[]) {
  const enabled = enabledIds.filter(id => SOURCE_META.some(item => item.id === id));
  const rest = SOURCE_META.map(item => item.id).filter(id => !enabled.includes(id));
  sourceList.value = [...enabled, ...rest].map(id => {
    const meta = SOURCE_META.find(item => item.id === id)!;
    return { ...meta, enabled: enabled.includes(id) };
  });
}
async function saveLimits() {
  await danmakuConfigSave({
    userCooldownSec: userCooldown.value,
    globalCooldownSec: globalCooldown.value,
    playlistLimit: queueLimit.value
  });
  ElMessage.success('点歌限制已保存');
}
async function refreshOutputs() {
  audioOutputs.value = await listAudioOutputs();
  audioOutputId.value = sanitizeOutputId(audioOutputId.value, audioOutputs.value);
  virtualOutputId.value = sanitizeOutputId(virtualOutputId.value, audioOutputs.value);
  const virtuals = audioOutputs.value.filter(item => item.virtual);
  if (!navigator.mediaDevices?.enumerateDevices) {
    audioHint.value = '当前环境无法枚举音频设备，将使用系统默认输出。';
  } else if (!audioOutputs.value.length) {
    audioHint.value = '未发现可路由输出。浏览器里设备名可能为空；可保持系统默认，Electron 中会列出真实声卡。';
  } else if (virtuals.length) {
    audioHint.value = `已识别虚拟声卡：${virtuals.map(item => item.label).join('、')}。选中后音乐会同时进入直播捕获设备。`;
  } else {
    audioHint.value = `已发现 ${audioOutputs.value.length} 个输出设备。将直播虚拟声卡设为 VB-Cable 后，音乐会同时进直播捕获设备。setSinkId 失败会回退系统默认，不中断播放。`;
  }
}
async function saveAudio() {
  try {
    await danmakuConfigSave({ audioOutputId: audioOutputId.value, virtualOutputId: virtualOutputId.value });
    const player = getOrCreateLocalAudio();
    const local = await player.setOutputDevice(audioOutputId.value);
    const live = await player.setLiveDevice(virtualOutputId.value);
    if (!local.ok || !live.ok) ElMessage.warning(local.error || live.error || '已回退系统默认输出');
    else ElMessage.success('声音输出已保存');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '声音输出保存失败');
  }
}
async function saveMode(value: string) {
  mode.value = value;
  try {
    await danmakuPlayerMode(value);
    ElMessage.success('播放模式已保存');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '播放模式保存失败');
  }
}
function applyFadeIn(value: string | number | boolean) {
  setting.pageValue.fadeIn = Boolean(value);
  setting.setFadeIn(Boolean(value));
  getOrCreateLocalAudio().setFadeIn(Boolean(value));
}
async function toggleIdlePlaylist(value: string | number | boolean) {
  const next = Boolean(value);
  if (next && !play.danmakuIdlePlaylist?.id) {
    ElMessage.warning('请先到「我的歌单」里选择一份闲时歌单');
    router.push('/yours');
    return;
  }
  const prev = play.danmakuIdlePlaylistEnabled;
  play.danmakuIdlePlaylistEnabled = next;
  try {
    await danmakuConfigSave({ idlePlaylistEnabled: next });
    if (next && (!play.playStatus.playing || play.playStatus.stopped) && play.musicList.length === 0) {
      await play.startIdleIfNeeded();
    }
  } catch {
    play.danmakuIdlePlaylistEnabled = prev;
  }
}
onMounted(async () => {
  try {
    const bili = await biliAccountStatus();
    biliLogin.value = bili.loggedIn;
  } catch {}
  try {
    const cfg = await danmakuConfig();
    const sources = Array.isArray(cfg.enabledSources) ? cfg.enabledSources.map(String) : ['qq'];
    buildSourceList(sources);
    if (typeof cfg.userCooldownSec === 'number') userCooldown.value = cfg.userCooldownSec;
    if (typeof cfg.globalCooldownSec === 'number') globalCooldown.value = cfg.globalCooldownSec;
    if (typeof cfg.playlistLimit === 'number') queueLimit.value = cfg.playlistLimit;
    if (typeof cfg.audioOutputId === 'string') audioOutputId.value = cfg.audioOutputId;
    if (typeof cfg.virtualOutputId === 'string') virtualOutputId.value = cfg.virtualOutputId;
    play.applyDanmakuGiftConfig(cfg);
    if (typeof cfg.songBlacklistEnabled === 'boolean') play.danmakuSongBlacklist = cfg.songBlacklistEnabled;
    if (Array.isArray(cfg.songBlacklist)) play.danmakuSongBlacklistItems = cfg.songBlacklist.map(String);
  } catch {}
  if (tab.value === 'order' && biliLogin.value) loadGifts();
  if (tab.value === 'order') {
    giftRefreshTimer = window.setInterval(() => { if (biliLogin.value) loadGifts(); }, 10 * 60 * 1000);
  }
  await refreshOutputs();
  if (navigator.mediaDevices?.addEventListener) {
    deviceChangeHandler = () => { refreshOutputs(); };
    navigator.mediaDevices.addEventListener('devicechange', deviceChangeHandler);
  }
});
watch(tab, id => {
  if (id === 'order') {
    if (biliLogin.value) loadGifts();
    if (giftRefreshTimer == null) giftRefreshTimer = window.setInterval(() => { if (biliLogin.value) loadGifts(); }, 10 * 60 * 1000);
    return;
  }
  if (giftRefreshTimer != null) {
    window.clearInterval(giftRefreshTimer);
    giftRefreshTimer = null;
  }
});
onUnmounted(() => {
  if (giftRefreshTimer != null) window.clearInterval(giftRefreshTimer);
  if (deviceChangeHandler && navigator.mediaDevices?.removeEventListener) {
    navigator.mediaDevices.removeEventListener('devicechange', deviceChangeHandler);
  }
});
</script>

<template>
  <div class="settings-grid">
    <section v-if="tab === 'order'" class="setting-card setting-wide">
      <div class="card-heading"><div><h2>音源与限制</h2><p>拖动调整搜索顺序。未指定平台时用第一个启用的源。</p></div></div>
      <div
        v-for="(item, index) in sourceList"
        :key="item.id"
        class="setting-line source-row"
        draggable="true"
        @dragstart="onSourceDragStart(index)"
        @dragover.prevent
        @drop="onSourceDrop(index)">
        <div class="source-main">
          <span class="source-handle" title="拖动调整顺序">⋮⋮</span>
          <div><strong>{{ item.label }}</strong><span>{{ item.hint }}</span></div>
        </div>
        <el-switch v-model="item.enabled" @change="saveSources" @mousedown.stop />
      </div>
      <label>队列上限</label><el-input-number v-model="queueLimit" :min="1" :max="999" class="full" @change="saveLimits" />
      <label>单人冷却（秒）</label><el-input-number v-model="userCooldown" :min="0" :max="3600" class="full" @change="saveLimits" />
      <label>全局冷却（秒）</label><el-input-number v-model="globalCooldown" :min="0" :max="3600" class="full" @change="saveLimits" />
    </section>
    <section v-if="tab === 'order'" class="setting-card setting-wide">
      <div class="card-heading">
        <div>
          <h2>礼物点歌</h2>
          <p>开启后观众需先获得资格再点歌。资格记在送礼人账号上，主播不受限。</p>
        </div>
        <el-switch :model-value="play.danmakuGiftRequest" :disabled="!play.danmakuAccepting" @change="toggleGiftSetting" />
      </div>
      <label>资格方式</label>
      <div class="mode-row">
        <button type="button" class="mode-chip" :class="{ active: play.danmakuGiftRequestQualifyMode !== 'threshold' }" @click="setRequestQualifyMode('specific')">指定礼物</button>
        <button type="button" class="mode-chip" :class="{ active: play.danmakuGiftRequestQualifyMode === 'threshold' }" @click="setRequestQualifyMode('threshold')">电池阈值</button>
      </div>
      <template v-if="play.danmakuGiftRequestQualifyMode === 'threshold'">
        <label>电池阈值</label>
        <el-input-number v-model="play.danmakuGiftRequestThreshold" :min="1" :max="99999" class="full" @change="saveRequestThreshold" />
        <label>超阈值计数</label>
        <div class="mode-row">
          <button type="button" class="mode-chip" :class="{ active: play.danmakuGiftRequestCountMode !== 'accumulate' }" @click="setRequestCountMode('once')">达标只记一次</button>
          <button type="button" class="mode-chip" :class="{ active: play.danmakuGiftRequestCountMode === 'accumulate' }" @click="setRequestCountMode('accumulate')">按阈值累计</button>
        </div>
        <p class="setting-tip" style="margin-top:12px">银瓜子和免费礼物不算。累计时例如阈值 5，送 12 电池记 2 次。</p>
      </template>
      <template v-else>
        <div v-if="play.danmakuGift.giftName" class="gift-selected">
          <img :src="play.danmakuGift.giftIcon" alt="" />
          <div>
            <strong>点歌指定 · {{ play.danmakuGift.giftName }}</strong>
            <span>{{ giftPriceText(play.danmakuGift) }}</span>
          </div>
        </div>
        <button type="button" class="gift-fold" :class="{ open: requestGiftOpen }" :aria-expanded="requestGiftOpen" @click="requestGiftOpen = !requestGiftOpen">
          <span>{{ requestGiftOpen ? '收起礼物列表' : (play.danmakuGift.giftName ? '更换指定礼物' : '展开选择礼物') }}</span>
          <span v-if="!requestGiftOpen && giftList.length" class="gift-fold-meta">{{ giftList.length }} 个</span>
          <span class="gift-fold-arrow" aria-hidden="true"></span>
        </button>
        <div v-if="requestGiftOpen" class="gift-fold-body">
          <div class="form-row">
            <el-input v-model="giftQuery" clearable placeholder="搜索点歌礼物名或 ID" />
            <el-button plain :loading="giftLoading" @click="loadGifts">从 B站刷新</el-button>
            <span class="gift-sync">{{ giftSyncLabel }}</span>
          </div>
          <p v-if="giftError" class="setting-tip" style="margin-top:12px">{{ giftError }}</p>
          <div class="gift-grid">
            <button
              v-for="item in requestGifts"
              :key="'request-' + item.id"
              type="button"
              class="gift-card"
              :class="{ selected: item.id === play.danmakuGift.giftId }"
              @click="selectGift(item, 'request')">
              <img :src="item.icon" :alt="item.name" />
              <strong>{{ item.name }}</strong>
              <span>{{ giftPriceText(item) }}</span>
            </button>
          </div>
        </div>
      </template>
    </section>
    <section v-if="tab === 'order'" class="setting-card setting-wide">
      <div class="card-heading">
        <div>
          <h2>礼物切歌</h2>
          <p>当场切歌立刻切当前曲；主动切歌先攒次数，再发「切歌」。一次送礼只记一次。</p>
        </div>
        <el-switch :model-value="play.danmakuGiftSkip" @change="toggleSkipSetting" />
      </div>
      <label>切歌方式</label>
      <div class="mode-row">
        <button type="button" class="mode-chip" :class="{ active: play.danmakuGiftSkipAction !== 'credit' }" @click="setSkipAction('instant')">当场切歌</button>
        <button type="button" class="mode-chip" :class="{ active: play.danmakuGiftSkipAction === 'credit' }" @click="setSkipAction('credit')">主动切歌（次数）</button>
      </div>
      <template v-if="play.danmakuGiftSkipAction === 'credit'">
        <label>次数有效时间（秒）</label>
        <el-input-number v-model="play.danmakuGiftSkipExpireSec" :min="10" :max="86400" class="full" @change="saveSkipExpire" />
      </template>
      <label>资格方式</label>
      <div class="mode-row">
        <button type="button" class="mode-chip" :class="{ active: play.danmakuGiftSkipQualifyMode !== 'threshold' }" @click="setSkipQualifyMode('specific')">指定礼物</button>
        <button type="button" class="mode-chip" :class="{ active: play.danmakuGiftSkipQualifyMode === 'threshold' }" @click="setSkipQualifyMode('threshold')">电池阈值</button>
      </div>
      <template v-if="play.danmakuGiftSkipQualifyMode === 'threshold'">
        <label>切歌电池阈值</label>
        <el-input-number v-model="play.danmakuGiftSkipThreshold" :min="1" :max="99999" class="full" @change="saveSkipThreshold" />
      </template>
      <template v-else>
        <div v-if="play.danmakuGiftSkipGift.giftName" class="gift-selected">
          <img :src="play.danmakuGiftSkipGift.giftIcon" alt="" />
          <div>
            <strong>切歌指定 · {{ play.danmakuGiftSkipGift.giftName }}</strong>
            <span>{{ giftPriceText(play.danmakuGiftSkipGift) }}</span>
          </div>
        </div>
        <button type="button" class="gift-fold" :class="{ open: skipGiftOpen }" :aria-expanded="skipGiftOpen" @click="skipGiftOpen = !skipGiftOpen">
          <span>{{ skipGiftOpen ? '收起礼物列表' : (play.danmakuGiftSkipGift.giftName ? '更换指定礼物' : '展开选择礼物') }}</span>
          <span v-if="!skipGiftOpen && giftList.length" class="gift-fold-meta">{{ giftList.length }} 个</span>
          <span class="gift-fold-arrow" aria-hidden="true"></span>
        </button>
        <div v-if="skipGiftOpen" class="gift-fold-body">
          <div class="form-row">
            <el-input v-model="giftSkipQuery" clearable placeholder="搜索切歌礼物名或 ID" />
            <el-button plain :loading="giftLoading" @click="loadGifts">从 B站刷新</el-button>
            <span class="gift-sync">{{ giftSyncLabel }}</span>
          </div>
          <p v-if="giftError" class="setting-tip" style="margin-top:12px">{{ giftError }}</p>
          <div class="gift-grid">
            <button
              v-for="item in skipGifts"
              :key="'skip-' + item.id"
              type="button"
              class="gift-card"
              :class="{ selected: item.id === play.danmakuGiftSkipGift.giftId }"
              @click="selectGift(item, 'skip')">
              <img :src="item.icon" :alt="item.name" />
              <strong>{{ item.name }}</strong>
              <span>{{ giftPriceText(item) }}</span>
            </button>
          </div>
        </div>
      </template>
    </section>
    <section v-if="tab === 'order'" class="setting-card setting-wide">
      <div class="card-heading">
        <div>
          <h2>点歌黑名单</h2>
          <p>匹配歌名或歌手则拒绝入队，支持关键词和正则。</p>
        </div>
        <el-switch :model-value="play.danmakuSongBlacklist" @change="toggleBlacklistSetting" />
      </div>
      <div class="form-row">
        <el-input v-model="blacklistDraft" clearable placeholder="输入歌名关键词或正则，回车添加" @keyup.enter="addBlacklistRule" />
        <el-button type="primary" @click="addBlacklistRule">添加</el-button>
      </div>
      <div v-if="play.danmakuSongBlacklistItems.length" class="blacklist-tags">
        <span v-for="item in play.danmakuSongBlacklistItems" :key="item" class="blacklist-tag">
          {{ item }}
          <button type="button" @click="removeBlacklistRule(item)">×</button>
        </span>
      </div>
      <p v-else class="setting-tip" style="margin-top:12px">还没有规则。只输入一个字时会先确认，避免误伤大量歌曲。</p>
    </section>
    <section v-if="tab === 'display'" class="setting-card setting-wide">
      <div class="card-heading"><div><h2>播放与声音</h2><p>模式、音质和本机出声设备。</p></div></div>
      <label>播放模式</label>
      <el-select v-model="mode" class="full" @change="saveMode">
        <el-option label="列表循环" value="loop" />
        <el-option label="顺序播放" value="order" />
        <el-option label="随机播放" value="random" />
        <el-option label="单曲循环" value="single" />
      </el-select>
      <label>播放音质</label>
      <el-select :model-value="setting.playQuality" class="full" @change="savePlayQuality">
        <el-option label="至臻无损" value="ZQ" />
        <el-option label="无损" value="SQ" />
        <el-option label="高清" value="HQ" />
        <el-option label="标准" value="PQ" />
      </el-select>
      <div class="setting-line">
        <div><strong>淡入播放</strong><span>切歌时音量从低到高，减少突兀</span></div>
        <el-switch :model-value="setting.pageValue.fadeIn" @change="applyFadeIn" />
      </div>
      <div class="setting-line">
        <div><strong>启动后自动播放</strong><span>打开软件后继续播放上次歌曲</span></div>
        <el-switch v-model="setting.pageValue.playAtRun" @change="setting.setPlayAtRun" />
      </div>
      <div class="setting-line">
        <div><strong>记住播放进度</strong><span>下次启动从上次进度继续</span></div>
        <el-switch v-model="setting.pageValue.savePlayProgress" @change="setting.setSavePlayProgress" />
      </div>
      <label>本机输出 / 虚拟声卡</label>
      <div class="form-row">
        <el-select v-model="audioOutputId" class="full" placeholder="系统默认输出设备" @change="saveAudio">
          <el-option label="系统默认输出设备" value="" />
          <el-option v-for="item in audioOutputs" :key="item.deviceId" :label="item.label" :value="item.deviceId" />
        </el-select>
        <el-select v-model="virtualOutputId" class="full" placeholder="直播虚拟声卡" @change="saveAudio">
          <el-option label="不使用虚拟声卡" value="" />
          <el-option v-for="item in audioOutputs" :key="'live-' + item.deviceId" :label="(item.virtual ? '虚拟 · ' : '') + item.label" :value="item.deviceId" />
        </el-select>
        <el-button plain @click="refreshOutputs">刷新设备</el-button>
      </div>
      <div class="setting-tip">
        <TipIcon />
        {{ audioHint }}
      </div>
    </section>
    <section v-if="tab === 'display'" class="setting-card setting-wide">
      <div class="card-heading">
        <div>
          <h2>闲时歌单</h2>
          <p>队列播完后接上，避免空场。观众点歌会优先插入。</p>
        </div>
        <el-switch :model-value="play.danmakuIdlePlaylistEnabled" @change="toggleIdlePlaylist" />
      </div>
      <div v-if="play.danmakuIdlePlaylist?.id" class="idle-selected">
        <img v-if="play.danmakuIdlePlaylist.image" :src="play.danmakuIdlePlaylist.image" alt="" />
        <div>
          <strong>{{ play.danmakuIdlePlaylist.name || '已选择歌单' }}</strong>
          <span>{{ play.danmakuIdlePlaylist.source }} · {{ play.danmakuIdlePlaylist.id }}</span>
        </div>
      </div>
      <p v-else class="setting-tip" style="margin-top:0">还没有选择闲时歌单。到「我的歌单」打开一份歌单后设为闲时播放。</p>
      <div class="form-row" style="margin-top:14px">
        <el-button type="primary" @click="router.push('/yours')">去我的歌单选择</el-button>
      </div>
    </section>
    <section v-if="tab === 'display'" class="setting-card setting-wide">
      <div class="card-heading">
        <div>
          <h2>桌面歌词</h2>
          <p>底部播放栏点「词」开关。无边框可拖动，右键显示边框后关闭。</p>
        </div>
        <el-switch :model-value="play.desktopLyricShow" @change="play.showDesktopLyric($event)" />
      </div>
      <div class="setting-line">
        <div><strong>透明背景</strong><span>默认透明，适合叠在直播画面上</span></div>
        <el-switch v-model="setting.pageValue.lyric.transparent" @change="setting.setLyricOptions" />
      </div>
      <div class="setting-line">
        <div><strong>总在最前</strong><span>打开时置顶在其他窗口之上</span></div>
        <el-switch v-model="setting.pageValue.lyric.topmost" @change="setting.setLyricOptions" />
      </div>
      <div class="setting-line">
        <div><strong>字体加粗</strong></div>
        <el-switch v-model="setting.pageValue.lyric.fontBold" @change="setting.setLyricOptions" />
      </div>
      <div class="setting-line">
        <div><strong>字体描边</strong><span>浅色或复杂背景上更容易看清</span></div>
        <el-switch v-model="setting.pageValue.lyric.effect" @change="setting.setLyricOptions" />
      </div>
      <label>字体</label>
      <el-select v-model="setting.pageValue.lyric.fontFamily" class="full" placeholder="默认" @change="setting.setLyricOptions">
        <el-option label="默认" value="" />
        <el-option v-for="item in lyricFonts" :key="item" :label="item" :value="item" :style="{ fontFamily: item }" />
      </el-select>
      <label>字号</label>
      <el-input-number v-model="setting.pageValue.lyric.fontSize" :min="16" :max="72" class="full" @change="setting.setLyricOptions" />
      <label>字体颜色</label>
      <div class="lyric-color-row">
        <button
          v-for="item in lyricColors"
          :key="item.color"
          type="button"
          class="lyric-color-chip"
          :class="{ active: setting.pageValue.lyric.fontColor === item.color }"
          :style="{ background: item.color }"
          :title="item.name"
          @click="applyLyricColor(item)" />
        <span class="lyric-color-split" aria-hidden="true"></span>
        <label class="lyric-color-pick" title="自定义字体颜色">
          <el-color-picker v-model="setting.pageValue.lyric.fontColor" @change="setting.setLyricOptions" />
          <span>自定义</span>
        </label>
        <label v-if="setting.pageValue.lyric.effect" class="lyric-color-pick" title="自定义光晕颜色">
          <el-color-picker v-model="setting.pageValue.lyric.effectColor" @change="setting.setLyricOptions" />
          <span>光晕</span>
        </label>
      </div>
      <div
        class="lyric-preview"
        :style="{
          fontFamily: setting.pageValue.lyric.fontFamily || 'Microsoft YaHei, sans-serif',
          fontSize: (setting.pageValue.lyric.fontSize || 28) + 'px',
          fontWeight: setting.pageValue.lyric.fontBold ? '700' : '500',
          color: setting.pageValue.lyric.fontColor,
          textShadow: setting.pageValue.lyric.effect
            ? `0 0 4px ${setting.pageValue.lyric.effectColor}`
            : 'none'
        }">
        歌词预览 · 海阔天空
      </div>
    </section>
  </div>
</template>
