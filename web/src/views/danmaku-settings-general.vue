<script setup lang="ts">
import { useSettingStore } from '../stores/setting';
import { CloseType } from '../utils/type';

const setting = useSettingStore();
const themes = [
  { id: '', name: '浅色', hint: '默认浅色界面' },
  { id: 'dark', name: '深色', hint: '深灰背景' },
  { id: 'dark pure', name: '纯黑', hint: '更适合夜间直播间' },
  { id: 'glass', name: '玻璃', hint: '半透明磨砂风格' }
];

function applyTheme(id: string) {
  setting.autoAppTheme = false;
  setting.autoAppThemeChanged(true);
  setting.setAppTheme({ id });
}

function applyAutoTheme(value: string | number | boolean) {
  setting.autoAppTheme = Boolean(value);
  setting.autoAppThemeChanged();
}

function applyCloseType(value: string) {
  setting.setCloseType(value === CloseType.Exit ? CloseType.Exit : CloseType.Hide);
}
</script>

<template>
  <div class="settings-grid">
    <section class="setting-card setting-wide">
      <div class="card-heading">
        <div>
          <h2>界面主题</h2>
          <p>只影响点歌姬窗口，不影响捕获窗和桌面歌词。</p>
        </div>
      </div>
      <div class="setting-line" style="margin-top:0; padding-top:0; border-top:0">
        <div><strong>跟随系统</strong><span>按系统浅色 / 深色自动切换</span></div>
        <el-switch :model-value="setting.autoAppTheme" @change="applyAutoTheme" />
      </div>
      <label>主题</label>
      <div class="mode-row">
        <button
          v-for="item in themes"
          :key="item.id || 'light'"
          type="button"
          class="mode-chip"
          :class="{ active: !setting.autoAppTheme && setting.appTheme.id === item.id }"
          :disabled="setting.autoAppTheme"
          @click="applyTheme(item.id)">
          {{ item.name }}
        </button>
      </div>
    </section>
    <section class="setting-card setting-wide">
      <div class="card-heading">
        <div>
          <h2>窗口行为</h2>
          <p>关闭主窗口时的处理方式。</p>
        </div>
      </div>
      <label>点击关闭时</label>
      <div class="mode-row">
        <button
          type="button"
          class="mode-chip"
          :class="{ active: setting.pageValue.closeType !== CloseType.Exit }"
          @click="applyCloseType(CloseType.Hide)">
          最小化到托盘
        </button>
        <button
          type="button"
          class="mode-chip"
          :class="{ active: setting.pageValue.closeType === CloseType.Exit }"
          @click="applyCloseType(CloseType.Exit)">
          退出程序
        </button>
      </div>
      <div class="setting-line">
        <div><strong>减少动画</strong><span>降低过渡效果，弱机器上更稳</span></div>
        <el-switch
          :model-value="setting.pageValue.disableAnimation"
          @change="setting.setDisableAnimation(Boolean($event))" />
      </div>
    </section>
  </div>
</template>
