<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  subscribeDesktopLyric,
  type DesktopLyricMessage
} from '../utils/lyric';
import type { LyricOptionsKey } from '../utils/type';

const text = ref('');
const options = ref<Record<LyricOptionsKey, any>>({
  topmost: true,
  fontFamily: '',
  fontSize: 28,
  fontBold: true,
  effect: true,
  effectColor: '#cb7474',
  fontColor: '#ffb0b0',
  transparent: true
});

function applyMessage(message: DesktopLyricMessage) {
  if (message.type === 'hide') {
    window.close();
    return;
  }
  if (message.options && typeof message.options === 'object') {
    options.value = { ...options.value, ...message.options };
  }
  if (typeof message.text === 'string') text.value = message.text;
}

const lineStyle = computed(() => {
  const fontFamily = options.value.fontFamily || 'Microsoft YaHei, sans-serif';
  const fontSize = Number(options.value.fontSize) || 28;
  const color = options.value.fontColor || '#ffb0b0';
  const effectColor = options.value.effectColor || '#cb7474';
  const stroke = options.value.effect
    ? `0 0 4px ${effectColor}, 0 0 8px ${effectColor}, 1px 1px 0 ${effectColor}`
    : '0 1px 2px rgba(0,0,0,.45)';
  return {
    fontFamily,
    fontSize: `${fontSize}px`,
    fontWeight: options.value.fontBold ? '700' : '500',
    color,
    textShadow: stroke,
    WebkitTextStroke: options.value.effect ? `0.6px ${effectColor}` : '0'
  };
});

const panelStyle = computed(() => {
  if (options.value.transparent !== false) {
    return { background: 'transparent' };
  }
  return { background: 'rgba(8, 10, 16, 0.55)' };
});

let stop: (() => void) | null = null;

onMounted(() => {
  stop = subscribeDesktopLyric(applyMessage);
  window.addEventListener('pagehide', notifyClosed);
  window.addEventListener('beforeunload', notifyClosed);
});

onUnmounted(() => {
  stop?.();
  window.removeEventListener('pagehide', notifyClosed);
  window.removeEventListener('beforeunload', notifyClosed);
});

function notifyClosed() {
  try {
    const channel = new BroadcastChannel('danmaku-desktop-lyric');
    channel.postMessage({ type: 'closed' });
    channel.close();
  } catch {}
}
</script>

<template>
  <div class="lyric-desktop" :style="panelStyle">
    <div class="lyric-desktop-line" :style="lineStyle">{{ text || '桌面歌词' }}</div>
  </div>
</template>

<style lang="less">
html.is-overlay,
html.is-overlay body,
html.is-overlay #app {
  background: transparent !important;
}
.lyric-desktop {
  height: 100%;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 18px;
  box-sizing: border-box;
  -webkit-app-region: drag;
  user-select: none;
}
.lyric-desktop-line {
  max-width: 100%;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
  paint-order: stroke fill;
}
</style>
