<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { ElMessage } from 'element-plus/es/components/message/index';
import {
  OVERLAY_BG_PRESETS,
  SCROLL_OVERLAY_FORMATS,
  STATIC_OVERLAY_FORMATS,
  clearOverlayBackgroundImage,
  compressOverlayImage,
  openOverlayWindow,
  readOverlayAlwaysOnTop,
  readOverlayBackground,
  readOverlayBackgroundImage,
  readSavedOverlayFormat,
  saveOverlayAlwaysOnTop,
  saveOverlayBackground,
  saveOverlayBackgroundImage,
  saveOverlayFormat,
  type OverlayBackground
} from '../utils/overlay-formats';

const overlayFormat = ref(readSavedOverlayFormat());
const overlayAlwaysOnTop = ref(readOverlayAlwaysOnTop());
const overlayBg = ref<OverlayBackground>(readOverlayBackground());
const overlayImage = ref('');
const overlayFile = ref<HTMLInputElement | null>(null);
const imageBusy = ref(false);

function chooseOverlay(id: string) {
  overlayFormat.value = id;
  saveOverlayFormat(id);
}

function setOverlayAlwaysOnTop(value: string | number | boolean) {
  overlayAlwaysOnTop.value = Boolean(value);
  saveOverlayAlwaysOnTop(overlayAlwaysOnTop.value);
}

function openCaptureWindow(id?: string) {
  if (id) chooseOverlay(id);
  const opened = openOverlayWindow(overlayFormat.value, overlayAlwaysOnTop.value);
  if (!opened) ElMessage.error('浏览器拦截了弹出窗口，请允许后重试');
  else ElMessage.success('已打开捕获窗');
}

function applyOverlayBg(patch: Partial<OverlayBackground>) {
  overlayBg.value = saveOverlayBackground(patch);
}

function chooseOverlayColor(color: string) {
  applyOverlayBg({ mode: 'color', color });
}

function chooseOverlayTransparent() {
  applyOverlayBg({ mode: 'transparent' });
}

function chooseOverlayImage() {
  if (!overlayImage.value) {
    overlayFile.value?.click();
    return;
  }
  applyOverlayBg({ mode: 'image' });
}

async function onOverlayImage(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  imageBusy.value = true;
  try {
    const dataUrl = await compressOverlayImage(file);
    await saveOverlayBackgroundImage(dataUrl);
    overlayImage.value = dataUrl;
    applyOverlayBg({ mode: 'image' });
    ElMessage.success('背景图已更新');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '背景图处理失败');
  } finally {
    imageBusy.value = false;
  }
}

async function removeOverlayImage() {
  overlayImage.value = '';
  await clearOverlayBackgroundImage();
  if (overlayBg.value.mode === 'image') applyOverlayBg({ mode: 'color' });
}

onMounted(async () => {
  overlayImage.value = await readOverlayBackgroundImage();
});
onUnmounted(() => {
  overlayImage.value = '';
});

defineExpose({ openCaptureWindow });
</script>

<template>
  <div class="overlay-picker">
    <div class="overlay-picker-head">
      <div v-if="$slots.heading" class="overlay-picker-heading">
        <slot name="heading" />
      </div>
      <div class="overlay-picker-toolbar">
        <el-button type="primary" @click="openCaptureWindow()">打开捕获窗</el-button>
        <el-switch v-model="overlayAlwaysOnTop" active-text="窗口置顶" @change="setOverlayAlwaysOnTop" />
      </div>
    </div>
    <div class="overlay-picker-group">
      <h3>静态窗</h3>
      <div class="overlay-picker-grid is-static">
        <el-tooltip
          v-for="item in STATIC_OVERLAY_FORMATS"
          :key="item.id"
          placement="top"
          :show-after="160"
          :hide-after="0">
          <template #content>
            <div class="overlay-picker-tip">
              <strong>{{ item.name }}</strong>
              <em>{{ item.width }} × {{ item.height }}</em>
              <p>{{ item.detail }}</p>
            </div>
          </template>
          <button
            type="button"
            class="overlay-picker-tile"
            :class="{ 'is-active': overlayFormat === item.id }"
            @click="chooseOverlay(item.id)"
            @dblclick="openCaptureWindow(item.id)">
            <strong>{{ item.name }}</strong>
            <em>{{ item.width }} × {{ item.height }}</em>
            <span>{{ item.hint }}</span>
          </button>
        </el-tooltip>
      </div>
    </div>
    <div class="overlay-picker-group">
      <h3>滚动窗</h3>
      <div class="overlay-picker-grid is-scroll">
        <el-tooltip
          v-for="item in SCROLL_OVERLAY_FORMATS"
          :key="item.id"
          placement="top"
          :show-after="160"
          :hide-after="0">
          <template #content>
            <div class="overlay-picker-tip">
              <strong>{{ item.name }}</strong>
              <em>{{ item.width }} × {{ item.height }}</em>
              <p>{{ item.detail }}</p>
            </div>
          </template>
          <button
            type="button"
            class="overlay-picker-tile"
            :class="{ 'is-active': overlayFormat === item.id }"
            @click="chooseOverlay(item.id)"
            @dblclick="openCaptureWindow(item.id)">
            <strong>{{ item.name }}</strong>
            <em>{{ item.width }} × {{ item.height }}</em>
            <span>{{ item.hint }}</span>
          </button>
        </el-tooltip>
      </div>
    </div>
    <div class="overlay-picker-group">
      <h3>背景</h3>
      <div class="overlay-picker-bg-row">
        <button
          v-for="item in OVERLAY_BG_PRESETS"
          :key="item.id"
          type="button"
          class="overlay-picker-swatch"
          :class="{ 'is-active': overlayBg.mode === 'color' && overlayBg.color === item.color }"
          :title="item.name"
          :style="{ background: item.color, color: item.color === '#ffffff' || item.color === '#00ff00' ? '#222' : '#fff' }"
          @click="chooseOverlayColor(item.color)">
          {{ item.name }}
        </button>
        <button
          type="button"
          class="overlay-picker-swatch is-clear"
          :class="{ 'is-active': overlayBg.mode === 'transparent' }"
          @click="chooseOverlayTransparent">
          透明
        </button>
        <label class="overlay-picker-swatch is-custom" title="自定义颜色">
          <input type="color" :value="overlayBg.color" @input="chooseOverlayColor(($event.target as HTMLInputElement).value)" />
          自定义
        </label>
        <input ref="overlayFile" type="file" accept="image/*" hidden @change="onOverlayImage" />
        <button
          type="button"
          class="overlay-picker-swatch is-image"
          :class="{ 'is-active': overlayBg.mode === 'image' }"
          :style="overlayImage ? { backgroundImage: `url(${overlayImage})` } : undefined"
          :disabled="imageBusy"
          @click="chooseOverlayImage">
          {{ overlayImage ? '图片' : '上传' }}
        </button>
        <button v-if="overlayImage" type="button" class="overlay-picker-swatch is-ghost" @click="removeOverlayImage">清除</button>
      </div>
      <div v-if="overlayBg.mode !== 'transparent'" class="overlay-picker-opacity">
        <span>不透明度</span>
        <el-slider v-model="overlayBg.opacity" :min="0" :max="100" :show-tooltip="false" @change="applyOverlayBg({ opacity: overlayBg.opacity })" />
        <em>{{ overlayBg.opacity }}%</em>
      </div>
    </div>
    <p class="overlay-picker-hint">双击样式也可打开。改颜色和图片会同步到已开窗口；透明背景需重新打开。</p>
  </div>
</template>

<style lang="less" scoped>
.overlay-picker-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.overlay-picker-heading {
  min-width: 0;
  flex: 1 1 220px;
}
.overlay-picker-heading :slotted(h2) { font-size: 22px; margin: 0 0 3px; line-height: 1.2; }
.overlay-picker-heading :slotted(span) { color: var(--el-text-color-placeholder); font-size: 13px; }
.overlay-picker-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 0 0 auto;
}
.overlay-picker-toolbar :deep(.el-button) {
  width: auto;
  min-width: 0;
  flex: 0 0 auto;
  padding: 0 16px;
}
.overlay-picker-toolbar :deep(.el-switch) {
  flex: 0 0 auto;
  height: auto;
}
.overlay-picker-hint { margin: 12px 0 0; color: var(--el-text-color-placeholder); font-size: 12px; line-height: 1.5; }
.overlay-picker-group + .overlay-picker-group { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--music-side-divider-color); }
.overlay-picker-group h3 { margin: 0 0 10px; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; color: var(--el-text-color-regular); }
.overlay-picker-grid {
  display: grid;
  gap: 8px;
}
.overlay-picker-grid :deep(.el-tooltip__trigger) {
  min-width: 0;
  display: flex;
}
.overlay-picker-grid.is-static { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.overlay-picker-grid.is-scroll { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.overlay-picker-tile {
  box-sizing: border-box;
  min-width: 0;
  width: 100%;
  text-align: left;
  padding: 10px 11px;
  border-radius: 10px;
  border: 1px solid var(--music-side-divider-color);
  background: var(--music-button-background-hover, color-mix(in srgb, #fff 6%, transparent));
  color: inherit;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.overlay-picker-tile strong { font-size: 14px; font-weight: 600; line-height: 1.3; }
.overlay-picker-tile em { font-style: normal; color: var(--music-primary-color); font-size: 11px; font-variant-numeric: tabular-nums; }
.overlay-picker-tile span {
  color: var(--el-text-color-placeholder);
  font-size: 12px;
  line-height: 1.4;
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.overlay-picker-tile.is-active { border-color: var(--music-primary-color); box-shadow: inset 0 0 0 1px var(--music-primary-color); }
.overlay-picker-bg-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.overlay-picker-swatch {
  box-sizing: border-box;
  flex: 0 0 auto;
  width: 58px;
  min-width: 58px;
  height: 32px;
  padding: 0;
  border-radius: 8px;
  border: 1px solid var(--music-side-divider-color);
  cursor: pointer;
  font-size: 12px;
  line-height: 30px;
  text-align: center;
}
.overlay-picker-swatch.is-active { box-shadow: 0 0 0 2px var(--music-primary-color); }
.overlay-picker-swatch.is-clear { background: repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 12px 12px; color: #222; }
.overlay-picker-swatch.is-image { background: #2a3140 center / cover no-repeat; color: #fff; }
.overlay-picker-swatch.is-ghost {
  width: auto;
  min-width: 58px;
  padding: 0 10px;
  background: transparent;
  color: inherit;
  line-height: 30px;
}
.overlay-picker-swatch.is-custom {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: auto;
  min-width: 58px;
  padding: 0 8px;
  color: var(--el-text-color-regular);
  background: var(--music-button-background-hover, color-mix(in srgb, #fff 6%, transparent));
  line-height: 1;
}
.overlay-picker-swatch.is-custom input {
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}
.overlay-picker-opacity {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(320px, 100%);
  margin-top: 12px;
  color: var(--el-text-color-placeholder);
  font-size: 12px;
}
.overlay-picker-opacity :deep(.el-slider) { flex: 1 1 auto; min-width: 96px; max-width: 220px; }
.overlay-picker-opacity em { flex: 0 0 36px; font-style: normal; text-align: right; font-variant-numeric: tabular-nums; }
@media (max-width: 880px) {
  .overlay-picker-grid.is-static { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .overlay-picker-grid.is-scroll { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 560px) {
  .overlay-picker-grid.is-static,
  .overlay-picker-grid.is-scroll { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>

<style lang="less">
.overlay-picker-tip { max-width: 240px; line-height: 1.45; }
.overlay-picker-tip strong { display: block; font-size: 13px; }
.overlay-picker-tip em { display: block; font-style: normal; opacity: .72; font-size: 11px; margin: 2px 0 6px; }
.overlay-picker-tip p { margin: 0; font-size: 12px; }
</style>
