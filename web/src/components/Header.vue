<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Search } from '@element-plus/icons-vue';
import WindowControls from './WindowControls.vue';
import { isWindows } from '../utils/utils';
import { webView2Services } from '../utils/files';
import { usePlayStore } from '../stores/play';

const route = useRoute();
const router = useRouter();
const play = usePlayStore();
const searchKey = ref('');
const helpOpen = ref(false);
const pageTitle = computed(() => {
  if (route.meta.key === 'setting') {
    const name = String(route.name || '设置');
    return name.startsWith('设置') ? name : `设置 · ${name}`;
  }
  if (route.meta.key === 'yours') return '我的歌单';
  if (route.meta.key === 'playlist') return '歌单';
  if (route.meta.key === 'logs') return '日志信息';
  return String(route.name || '播放');
});
const connLabel = computed(() => {
  const s = play.danmakuConnection?.state || 'idle';
  if (s === 'connected') return 'B站已连接';
  if (s === 'failed') return 'B站连接失败';
  if (s === 'connecting' || s === 'connecting_room' || s === 'authenticating' || s === 'reconnecting') return 'B站连接中';
  return 'B站未连接';
});
watch(() => route.params.keywords, value => { if (typeof value === 'string') searchKey.value = decodeURIComponent(value); });
watch(() => route.fullPath, () => { helpOpen.value = false; });
function startSearch() {
  const keyword = searchKey.value.trim();
  if (!keyword) return;
  const path = `/search/qq/music/${encodeURIComponent(keyword)}`;
  if (route.path === path) return;
  router.push(path);
}
</script>

<template>
  <el-header class="danmaku-header">
    <div class="header-left">
      <el-button v-if="router.options.history.state.back" class="music-button-pure music-icon" @click="router.back()">左</el-button>
      <div class="page-context"><strong>{{ pageTitle }}</strong></div>
      <el-input v-model="searchKey" class="header-search" placeholder="搜索歌曲，或粘贴 BV 号" clearable @keydown.enter="startSearch">
        <template #prefix><el-icon @click="startSearch"><Search /></el-icon></template>
      </el-input>
    </div>
    <div class="header-right">
      <span class="header-credit">制作人 长楠 @DaybreakCN</span>
      <span class="header-status" :class="{ connected: play.danmakuConnection.state === 'connected' }"><i></i> {{ connLabel }}</span>
      <el-button class="music-button-pure music-icon" title="设置" @click="route.path.startsWith('/setting') || router.push('/setting')">设</el-button>
      <div class="header-help-wrap">
        <button
          type="button"
          class="header-help"
          :class="{ 'is-open': helpOpen }"
          :aria-expanded="helpOpen"
          title="按钮指引"
          @click="helpOpen = !helpOpen">
          ?
        </button>
        <div v-show="helpOpen" class="header-help-panel" role="dialog" aria-label="按钮指引">
          <strong>按钮指引</strong>
          <dl>
            <dt>空格</dt><dd>播放 / 暂停</dd>
            <dt>← →</dt><dd>快退 / 快进 5 秒</dd>
            <dt>↑ ↓</dt><dd>音量</dd>
            <dt>M</dt><dd>静音</dd>
            <dt>Shift + ← →</dt><dd>上一首 / 下一首</dd>
            <dt>打开全屏播放器</dt><dd>大窗播放当前曲</dd>
            <dt>播放列表</dt><dd>查看当前队列</dd>
            <dt>连接弹幕</dt><dd>已配置房间可连；未配置会去设置</dd>
            <dt>捕获窗</dt><dd>单击选样式，双击打开；悬停看详情</dd>
            <dt>侧栏开关</dt><dd>点歌、礼物、闲时歌单</dd>
            <dt>日志信息</dt><dd>查看并保留全部运行记录</dd>
          </dl>
        </div>
      </div>
      <WindowControls v-if="isWindows && webView2Services.specialService" />
    </div>
  </el-header>
</template>

<style lang="less" scoped>
.danmaku-header { height: 76px; display:flex; align-items:center; justify-content:space-between; padding: 0 30px; background: var(--music-background); border-bottom: 1px solid var(--music-side-divider-color); overflow: visible; }
.header-left,.header-right { display:flex; align-items:center; min-width:0; gap:14px; } .page-context { display:flex; flex-direction:column; min-width:56px; } .page-context strong { font-size:17px; } .header-search { width:300px; } .header-search :deep(.el-input__wrapper) { box-shadow:none; background:var(--music-search-background); border:1px solid var(--music-side-divider-color); } .header-search .el-icon { cursor:pointer; } .header-credit { color:var(--el-text-color-placeholder); font-size:11px; white-space:nowrap; letter-spacing:.02em; } .header-status { color:var(--el-text-color-placeholder); font-size:12px; white-space:nowrap; } .header-status i { display:inline-block; width:7px; height:7px; border-radius:50%; background:#8d939b; margin-right:5px; } .header-status.connected { color: var(--music-primary-color); } .header-status.connected i { background: var(--music-primary-color); } .music-button-pure { color:var(--music-text-color); }
.header-help-wrap { position: relative; flex: none; }
.header-help {
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--music-side-divider-color);
  background: transparent;
  color: var(--el-text-color-regular);
  font-size: 16px;
  font-weight: 600;
  line-height: 30px;
  cursor: pointer;
}
.header-help:hover,
.header-help.is-open { color: #fff; background: var(--music-button-primary-background); border-color: transparent; }
.header-help-panel {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 40;
  width: min(360px, calc(100vw - 32px));
  padding: 14px 16px 12px;
  border-radius: 12px;
  border: 1px solid var(--music-side-divider-color);
  background: var(--music-sub-background);
  box-shadow: 0 12px 32px color-mix(in srgb, #000 16%, transparent);
}
.header-help-panel strong { display: block; font-size: 14px; margin-bottom: 10px; }
.header-help-panel dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 7px 12px; align-items: start; }
.header-help-panel dt { color: var(--music-primary-color); font-size: 12px; font-weight: 600; white-space: nowrap; }
.header-help-panel dd { margin: 0; color: var(--el-text-color-regular); font-size: 12px; line-height: 1.4; }
@media(max-width:900px) { .danmaku-header { padding:0 16px; } .header-credit { display:none; } .header-search { width:min(280px,35vw); } } @media(max-width:650px) { .page-context { display:none; } .header-search { width:min(300px,60vw); } .header-status { display:none; } }
</style>
