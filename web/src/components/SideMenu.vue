<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus/es/components/message/index';
import { BrandAvatarImage } from '../utils/logo';
import { usePlayStore } from '../stores/play';
import { danmakuConfigSave } from '../utils/api/danmaku-qq';

const route = useRoute();
const router = useRouter();
const play = usePlayStore();
const liveLabel = computed(() => play.danmakuConnection?.detail || (play.danmakuConnection?.state === 'connected' ? '已连接' : '等待扫码登录'));
const acceptLabel = computed(() => play.danmakuAccepting ? '受理中' : '已关闭');
const blacklistLabel = computed(() => {
  if (!play.danmakuSongBlacklist) return '未开启';
  const n = play.danmakuSongBlacklistItems.length;
  return n ? `已启用 · ${n} 条` : '已启用 · 尚未添加规则';
});
const giftLabel = computed(() => {
  if (!play.danmakuGiftRequest) return '未开启';
  if (play.danmakuGiftRequestQualifyMode === 'threshold') {
    return play.danmakuGiftRequestThreshold > 0 ? `满 ${play.danmakuGiftRequestThreshold} 电池` : '请设定电池阈值';
  }
  return play.danmakuGift.giftName ? `需赠送 ${play.danmakuGift.giftName}` : '请先选择礼物';
});
const skipGiftLabel = computed(() => {
  if (!play.danmakuGiftSkip) return '未开启';
  const action = play.danmakuGiftSkipAction === 'credit' ? `次数 · ${play.danmakuGiftSkipExpireSec}s` : '当场切歌';
  if (play.danmakuGiftSkipQualifyMode === 'threshold') {
    return play.danmakuGiftSkipThreshold > 0 ? `${action} · 满 ${play.danmakuGiftSkipThreshold} 电池` : `${action} · 请设定阈值`;
  }
  return play.danmakuGiftSkipGift.giftName ? `${action} · ${play.danmakuGiftSkipGift.giftName}` : `${action} · 请先选择礼物`;
});
const idleLabel = computed(() => {
  if (!play.danmakuIdlePlaylistEnabled) return '未开启';
  return play.danmakuIdlePlaylist?.name || '请选择歌单';
});

async function toggleAccepting(value: string | number | boolean) {
  const next = Boolean(value);
  const prev = play.danmakuAccepting;
  play.danmakuAccepting = next;
  try {
    await danmakuConfigSave({ accepting: next });
  } catch {
    play.danmakuAccepting = prev;
  }
}

async function toggleSongBlacklist(value: string | number | boolean) {
  const next = Boolean(value);
  const prev = play.danmakuSongBlacklist;
  play.danmakuSongBlacklist = next;
  try {
    await danmakuConfigSave({ songBlacklistEnabled: next });
    if (next && !play.danmakuSongBlacklistItems.length) ElMessage.warning('请到设置 · 点歌里添加规则');
  } catch {
    play.danmakuSongBlacklist = prev;
  }
}
async function toggleGiftRequest(value: string | number | boolean) {
  const next = Boolean(value);
  const prev = play.danmakuGiftRequest;
  play.danmakuGiftRequest = next;
  try {
    await danmakuConfigSave({ giftRequestEnabled: next });
    if (next && play.danmakuGiftRequestQualifyMode !== 'threshold' && !play.danmakuGift.giftName) {
      ElMessage.warning('请到设置 · 点歌里选择指定礼物或改为电池阈值');
    }
    if (next && play.danmakuGiftRequestQualifyMode === 'threshold' && play.danmakuGiftRequestThreshold <= 0) {
      ElMessage.warning('请到设置 · 点歌里设定电池阈值');
    }
  } catch {
    play.danmakuGiftRequest = prev;
  }
}
async function toggleGiftSkip(value: string | number | boolean) {
  const next = Boolean(value);
  const prev = play.danmakuGiftSkip;
  play.danmakuGiftSkip = next;
  try {
    await danmakuConfigSave({ giftSkipEnabled: next });
    if (next && play.danmakuGiftSkipQualifyMode !== 'threshold' && !play.danmakuGiftSkipGift.giftName) {
      ElMessage.warning('请到设置 · 点歌里选择切歌礼物或改为电池阈值');
    }
    if (next && play.danmakuGiftSkipQualifyMode === 'threshold' && play.danmakuGiftSkipThreshold <= 0) {
      ElMessage.warning('请到设置 · 点歌里设定切歌电池阈值');
    }
  } catch {
    play.danmakuGiftSkip = prev;
  }
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
const menus = [
  { key: 'player', path: '/player', name: '播放', icon: '播' },
  { key: 'yours', path: '/yours', name: '我的歌单', icon: '单' },
  { key: 'history', path: '/history', name: '播放历史', icon: 'clock' },
  { key: 'logs', path: '/logs', name: '日志信息', icon: 'log' }
];
const settingMenus = [
  { key: 'setting', path: '/setting', name: '设置', icon: '设' }
];
const activeKey = computed(() => {
  if (route.meta.key === 'setting' || route.meta.settingTab) return 'setting';
  if (route.meta.key === 'playlist') return 'yours';
  return String(route.meta.key || 'player');
});
</script>

<template>
  <el-aside class="danmaku-aside">
    <div class="danmaku-brand" @click="router.push('/player')">
      <img :src="BrandAvatarImage" alt="弹幕点歌姬" />
      <div><strong>弹幕点歌姬</strong><span>by 长楠</span></div>
    </div>
    <div class="danmaku-aside-caption">音乐控制台</div>
    <el-menu class="danmaku-menu" :default-active="activeKey" :key="'main-' + activeKey">
      <el-menu-item v-for="item in menus" :key="item.key" :index="item.key" @click="router.push(item.path)">
        <span v-if="item.icon === 'clock'" class="danmaku-menu-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" focusable="false">
            <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" stroke-width="1.5" />
            <path d="M10 6.25V10.15l2.6 1.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <span v-else-if="item.icon === '单'" class="danmaku-menu-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" focusable="false">
            <rect x="3.5" y="4.2" width="13" height="11.6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5" />
            <path d="M6.4 8h7.2M6.4 11h4.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </span>
        <span v-else-if="item.icon === 'log'" class="danmaku-menu-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" focusable="false">
            <rect x="4" y="3.5" width="12" height="13" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5" />
            <path d="M7 7.2h6M7 10h6M7 12.8h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </span>
        <span v-else class="music-icon danmaku-menu-icon">{{ item.icon }}</span>
        <span>{{ item.name }}</span>
      </el-menu-item>
    </el-menu>
    <div class="danmaku-aside-caption" style="margin-top:18px">设置</div>
    <el-menu class="danmaku-menu" :default-active="activeKey" :key="'setting-' + activeKey">
      <el-menu-item v-for="item in settingMenus" :key="item.key" :index="item.key" @click="router.push(route.path.startsWith('/setting') ? route.path : item.path)">
        <span v-if="item.icon === '账'" class="danmaku-menu-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" focusable="false">
            <circle cx="10" cy="7" r="3.1" fill="none" stroke="currentColor" stroke-width="1.5" />
            <path d="M4.6 16.2c.7-2.7 2.8-4.2 5.4-4.2s4.7 1.5 5.4 4.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </span>
        <span v-else class="music-icon danmaku-menu-icon">{{ item.icon }}</span>
        <span>{{ item.name }}</span>
      </el-menu-item>
    </el-menu>
    <div class="danmaku-aside-bottom">
      <div class="danmaku-accept-group">
        <div class="danmaku-accept-row">
          <div class="danmaku-accept-copy"><strong>点歌黑名单</strong><small>{{ blacklistLabel }}</small></div>
          <el-switch :model-value="play.danmakuSongBlacklist" size="small" @change="toggleSongBlacklist" />
        </div>
        <div class="danmaku-accept-row" style="margin-top:10px">
          <div class="danmaku-accept-copy"><strong>点歌</strong><small>{{ acceptLabel }}</small></div>
          <el-switch :model-value="play.danmakuAccepting" size="small" @change="toggleAccepting" />
        </div>
        <div class="danmaku-accept-row danmaku-gift-row">
          <div class="danmaku-accept-copy"><strong>礼物点歌</strong><small>{{ giftLabel }}</small></div>
          <el-switch
            :model-value="play.danmakuGiftRequest"
            size="small"
            :disabled="!play.danmakuAccepting"
            @change="toggleGiftRequest" />
        </div>
        <div class="danmaku-accept-row danmaku-gift-row">
          <div class="danmaku-accept-copy"><strong>礼物切歌</strong><small>{{ skipGiftLabel }}</small></div>
          <el-switch :model-value="play.danmakuGiftSkip" size="small" @change="toggleGiftSkip" />
        </div>
        <div class="danmaku-accept-row" style="margin-top:10px">
          <div class="danmaku-accept-copy"><strong>闲时歌单</strong><small>{{ idleLabel }}</small></div>
          <el-switch :model-value="play.danmakuIdlePlaylistEnabled" size="small" @change="toggleIdlePlaylist" />
        </div>
      </div>
      <div class="danmaku-live-status" :class="{ connected: play.danmakuConnection.state === 'connected' }"><span></span><div><strong>B站弹幕</strong><small>{{ liveLabel }}</small></div></div>
      <div class="danmaku-version">制作人 长楠 @DaybreakCN</div>
    </div>
  </el-aside>
</template>

<style lang="less" scoped>
.danmaku-aside { width: 230px; flex: 0 0 230px; min-height: 100%; display: flex; flex-direction: column; background: var(--music-side-background); color: var(--music-side-text-color); border-right: 1px solid var(--music-side-divider-color); padding: 24px 14px 16px; }
.danmaku-brand { display: flex; gap: 11px; align-items: center; padding: 3px 9px 27px; cursor: pointer; } .danmaku-brand img { width: 43px; height: 43px; object-fit: cover; border-radius: 50%; background: var(--music-sub-background); } .danmaku-brand div { display: flex; flex-direction: column; min-width: 0; } .danmaku-brand strong { font-size: 17px; } .danmaku-brand span { font-size: 10px; opacity: .5; letter-spacing: .05em; margin-top: 1px; }
.danmaku-aside-caption { padding: 0 14px 9px; color: var(--el-text-color-placeholder); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; } .danmaku-menu { border: 0; background: transparent; } .danmaku-menu :deep(.el-menu-item) { height: 42px; line-height: 42px; margin: 3px 0; padding: 0 14px !important; border-radius: 8px; color: inherit; display: flex; align-items: center; } .danmaku-menu :deep(.el-menu-item:hover) { background: var(--music-side-menu-color-hover); } .danmaku-menu :deep(.el-menu-item.is-active) { color: white; background: var(--music-button-primary-background); } .danmaku-menu .danmaku-menu-icon { margin-right: 9px; width: 20px; height: 20px; font-size: 18px; display: inline-flex; align-items: center; justify-content: center; flex: none; line-height: 1; } .danmaku-menu .danmaku-menu-icon svg { display: block; }
.danmaku-aside-bottom { margin-top: auto; padding: 14px 10px 0; border-top: 1px solid var(--music-side-divider-color); } .danmaku-accept-group { margin-bottom: 14px; } .danmaku-accept-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; } .danmaku-gift-row { margin-top: 10px; padding-left: 12px; border-left: 2px solid var(--music-side-divider-color); } .danmaku-accept-copy { display: flex; flex-direction: column; min-width: 0; } .danmaku-accept-copy strong { font-size: 12px; font-weight: 500; } .danmaku-accept-copy small { color: var(--el-text-color-placeholder); font-size: 11px; } .danmaku-live-status { display: flex; gap: 9px; align-items: center; } .danmaku-live-status > span { width: 8px; height: 8px; flex: none; border-radius: 50%; background: #8d939b; } .danmaku-live-status.connected > span { background: var(--music-primary-color); } .danmaku-live-status div { display: flex; flex-direction: column; } .danmaku-live-status strong { font-size: 12px; font-weight: 500; } .danmaku-live-status small { color: var(--el-text-color-placeholder); font-size: 11px; } .danmaku-version { color: var(--el-text-color-placeholder); font-size: 10px; margin-top: 18px; }
@media(max-width:700px) { .danmaku-aside { width: 62px; flex-basis: 62px; padding: 15px 6px; } .danmaku-brand { justify-content: center; padding: 4px 0 22px; } .danmaku-brand img { width: 40px; height: 40px; } .danmaku-brand div, .danmaku-aside-caption, .danmaku-menu :deep(.el-menu-item span:not(.danmaku-menu-icon)), .danmaku-live-status div, .danmaku-version, .danmaku-accept-copy { display: none; } .danmaku-menu :deep(.el-menu-item) { justify-content: center; padding: 0 !important; } .danmaku-menu .danmaku-menu-icon { margin: 0; } .danmaku-live-status, .danmaku-accept-row { justify-content: center; } .danmaku-gift-row { padding-left: 0; border-left: 0; margin-top: 8px; } }
</style>
