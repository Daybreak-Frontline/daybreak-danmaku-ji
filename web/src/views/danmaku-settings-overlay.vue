<script setup lang="ts">
import OverlayPicker from '../components/OverlayPicker.vue';
</script>

<template>
  <div class="settings-grid">
    <section class="setting-card setting-wide">
      <div class="card-heading">
        <div>
          <h2>直播捕获窗</h2>
          <p>给 OBS 窗口捕获用。静态窗适合固定展示，滚动窗适合小面积循环播报。播放页也可直接打开当前样式。</p>
        </div>
      </div>
      <OverlayPicker />
    </section>
  </div>
</template>
