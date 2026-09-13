<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterView } from 'vue-router';
import SideMenu from './components/SideMenu.vue';
import Header from './components/Header.vue';
import Footer from './components/Footer.vue';
import CurrentList from './components/CurrentList.vue';
import PlayDetail from './components/PlayDetail.vue';
import WindowHelper from './components/WindowHelper.vue';
import { MusicConnection } from './stores/connection';
import { usePlayStore } from './stores/play';
import { useSettingStore } from './stores/setting';
import { LogoImage } from './utils/logo';
import { fixPwaForIOS } from './utils/utils';
import { webView2Services } from './utils/files';
const play = usePlayStore();
const setting = useSettingStore();
const overlayMode = /\/overlay(\/|$)/.test(location.pathname);
document.addEventListener(
  'error',
  function (event: ErrorEvent) {
    const target = event.target as any;
    if (target.tagName !== 'IMG' || target.ignoreError) return;
    if (
      target.src?.startsWith('http://') &&
      !target.src?.startsWith(location.origin)
    ) {
      target.src = target.src.replace('http://', 'https://');
      return;
    }
    target.ignoreError = true;
    target.src = LogoImage;
  },
  true
);
const connection = overlayMode ? null : new MusicConnection();
let rootClass = connection?.config.remote ? 'webview-host' : '';
if (overlayMode) {
  document.documentElement.classList.add('is-overlay');
  document.documentElement.style.opacity = '1';
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
}
onMounted(() => {
  if (!overlayMode) fixPwaForIOS();
});
</script>

<template>
  <div v-if="overlayMode" class="overlay-shell">
    <RouterView />
  </div>
  <el-container
    v-else
    class="music-layout"
    direction="vertical"
    :class="rootClass"
    :style="
      setting.appTheme.objectURL
        ? `background: url(${setting.appTheme.objectURL}) 50% 50% / cover`
        : ''
    ">
    <link
      v-if="setting.appTheme.id === 'animal-island'"
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&amp;family=Zen+Maru+Gothic:wght@400;500;700&amp;display=swap" />
    <el-container
      class="music-layout-top"
      :class="play.musicList.length > 0 || play.music.id ? '' : 'music-layout-top-full'">
      <SideMenu />

      <el-container class="music-layout-right" direction="vertical">
        <Header />
        <el-main class="music-main">
          <RouterView />
          <CurrentList />
        </el-main>
      </el-container>
    </el-container>
    <Footer v-if="play.music.id || play.danmakuIdlePlaylistEnabled" />
    <PlayDetail />
    <WindowHelper v-if="webView2Services.specialService" />
  </el-container>
</template>

<style lang="less" scoped>
.overlay-shell {
  height: 100%;
  width: 100%;
  overflow: hidden;
  background: transparent;
}
.music-layout {
  height: 100%;
  width: 100%;
  overflow: hidden;
  .el-main {
    padding: 0;
    margin-top: 5px;
    padding-right: calc(var(--sar) / 1.5);
  }
  &-right {
    background: var(--music-sub-background);
  }
  &-top {
    overflow: hidden;
    flex: 1;
  }
  &-top {
    width: 100%;
  }
}
.music-main {
  position: relative;
  overflow-x: hidden;
  padding-bottom: 8px !important;
  :deep(.el-scrollbar > .el-scrollbar__wrap > .el-scrollbar__view) {
    position: relative;
    min-height: 100%;
  }
  :deep(.el-overlay) {
    z-index: 2001;
  }
}
</style>